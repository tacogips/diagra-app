use crate::engine::{self, CommandResult, Input};
use rmcp::{model::*, service::RequestContext, ErrorData, RoleServer, ServerHandler, ServiceExt};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
struct Server {
    tools: Vec<Tool>,
    gate: Arc<tokio::sync::Mutex<()>>,
}
#[derive(Deserialize)]
struct Arguments {
    args: Vec<String>,
    stdin: Option<String>,
}
fn tool(name: String, description: String) -> Tool {
    serde_json::from_value(json!({
        "name": name, "description": description,
        "inputSchema": { "type": "object", "required": ["args"], "properties": {
            "args": { "type": "array", "items": { "type": "string" }, "description": "CLI argument tokens. Omit the executable and, for a command-specific tool, the command name. All CLI options are supported." },
            "stdin": { "type": "string", "description": "Explicit input text for edit --ops -. Never reads the MCP protocol stream." }
        } },
        "outputSchema": { "type": "object", "required": ["exitCode", "stdout", "stderr"], "properties": { "exitCode": { "type": "integer" }, "stdout": { "type": "string" }, "stderr": { "type": "string" } } }
    })).expect("static tool schema is valid")
}
fn result(value: CommandResult) -> CallToolResult {
    let failed = value.exit_code != 0;
    let value = serde_json::to_value(value).expect("command results serialize");
    if failed {
        CallToolResult::structured_error(value)
    } else {
        CallToolResult::structured(value)
    }
}
impl ServerHandler for Server {
    fn get_info(&self) -> ServerConfig {
        let mut config = ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Nodetto native CLI. All local file commands and options are available. Use nodetto_help with args [] for usage. Relative paths use the server working directory. Export binaries with --output. Tool results preserve exitCode, stdout and stderr; nonzero exit codes set isError.");
        config.server_info.name = "nodetto-cli".into();
        config.server_info.version = env!("CARGO_PKG_VERSION").into();
        config
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools.iter().find(|tool| tool.name == name).cloned()
    }
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult {
            tools: self.tools.clone(),
            ..Default::default()
        })
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if self.get_tool(&request.name).is_none() {
            return Ok(result(CommandResult::error(format!(
                "Unknown tool: {}",
                request.name
            )))
            .into());
        }
        let Arguments { mut args, stdin } = match serde_json::from_value(serde_json::Value::Object(
            request.arguments.unwrap_or_default(),
        )) {
            Ok(input) => input,
            Err(error) => return Ok(result(CommandResult::error(error)).into()),
        };
        if request.name != "nodetto_cli" {
            args.insert(0, request.name.trim_start_matches("nodetto_").into());
        }
        if args.first().is_some_and(|arg| arg == "mcp")
            && !args.iter().any(|arg| arg == "--help" || arg == "-h")
        {
            return Ok(result(CommandResult::error(
                "The MCP server is already running. Use a document command or help mcp.",
            ))
            .into());
        }
        let _guard = self.gate.lock().await;
        if let Some(output) = crate::access::command(&args) {
            return Ok(result(output).into());
        }
        let output = tokio::task::spawn_blocking(move || engine::run(args, Input::Mcp(stdin)))
            .await
            .unwrap_or_else(CommandResult::error);
        Ok(result(output).into())
    }
}

pub async fn serve() -> Result<(), Box<dyn std::error::Error>> {
    let help = engine::help()?;
    let mut tools = vec![
        tool(
            "nodetto_cli".into(),
            format!(
                "Run any CLI command, including help and --version.\n{}",
                help["overview"].as_str().unwrap_or_default()
            ),
        ),
        tool(
            "nodetto_help".into(),
            "Get usage. Pass args [] for the overview or [\"edit\"] for command help.".into(),
        ),
    ];
    for (name, description) in help["commands"].as_object().ok_or("Missing command help")? {
        if name != "mcp" {
            tools.push(tool(
                format!("nodetto_{name}"),
                description.as_str().unwrap_or_default().into(),
            ));
        }
    }
    let server = Server {
        tools,
        gate: Arc::new(tokio::sync::Mutex::new(())),
    };
    server
        .serve(rmcp::transport::stdio())
        .await?
        .waiting()
        .await?;
    Ok(())
}
