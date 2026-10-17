mod access;
mod engine;
mod files;
mod mcp;
mod render;

use std::io::{self, Write};
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let _access = access::restore();
    #[cfg(target_os = "macos")]
    if std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some() {
        if let Some(pwd) = std::env::var_os("PWD") {
            let _ = std::env::set_current_dir(pwd);
        }
    }
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    // libsecinit may reset a Store executable's cwd to its container. An
    // explicit startup directory restores predictable relative CLI/MCP paths.
    if args.first().is_some_and(|arg| arg == "--cwd") && args.get(2).is_some_and(|arg| arg == "mcp")
    {
        if let Err(error) = std::env::set_current_dir(&args[1]) {
            eprintln!("nodetto-cli: Cannot use project directory: {error}. Run nodetto-cli authorize first.");
            std::process::exit(2);
        }
        args.drain(..2);
    }
    if args == ["mcp"] {
        if let Err(error) = mcp::serve().await {
            eprintln!("nodetto-cli mcp: {error}");
            std::process::exit(2);
        }
        return;
    }
    let result =
        access::command(&args).unwrap_or_else(|| engine::run(args, engine::Input::Terminal));
    let output = io::stdout()
        .write_all(result.stdout.as_bytes())
        .and_then(|_| io::stderr().write_all(result.stderr.as_bytes()));
    if let Err(error) = output {
        if error.kind() == io::ErrorKind::BrokenPipe {
            return;
        }
        eprintln!("nodetto-cli: {error}");
        std::process::exit(2);
    }
    std::process::exit(result.exit_code);
}
