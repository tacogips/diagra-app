import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCliAsync } from "./cli.ts";
import { type CommandIo, type CommandResult, fail } from "./commands.ts";
import { COMMAND_HELP, OVERVIEW } from "./help.ts";

const inputSchema = {
  args: z
    .array(z.string())
    .describe(
      "CLI argument tokens, without shell quoting or the executable name. For a command-specific tool, omit the command name too. All CLI options are supported.",
    ),
  stdin: z
    .string()
    .optional()
    .describe(
      'Input text for commands reading stdin, such as edit with "--ops -". Never reads the MCP transport stream.',
    ),
};
const outputSchema = {
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
};

/** Use the CLI itself so new options and operations are available immediately. */
export function createMcpServer(io: CommandIo, version: string): McpServer {
  const server = new McpServer(
    { name: "nodetto-cli", version },
    {
      instructions:
        "Use nodetto_help for CLI usage. Tools operate on local files with the server process's permissions; relative paths use its working directory. Pass each argument as a separate array item. Results preserve CLI stdout, stderr and exitCode (including check/drift and strict warnings). Use stdin for edit --ops -. Export writes binary files through --output.",
    },
  );
  const execute = async (args: string[], stdin?: string) => {
    let result: CommandResult;
    try {
      if (
        args[0] === "mcp" &&
        !args.includes("--help") &&
        !args.includes("-h")
      ) {
        result = fail(
          "The MCP server is already running. Use a document command or help mcp.",
        );
      } else {
        result = await runCliAsync(
          args,
          {
            ...io,
            readStdin: () => {
              if (stdin === undefined)
                throw new Error(
                  "Supply the MCP tool's stdin field when using --ops -.",
                );
              return stdin;
            },
          },
          version,
        );
      }
    } catch (cause) {
      result = fail(
        `nodetto-cli: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    const structuredContent = { ...result };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(structuredContent) },
      ],
      structuredContent,
      isError: result.exitCode !== 0,
    };
  };

  server.registerTool(
    "nodetto_cli",
    {
      description: `Run any nodetto CLI command, including help and --version. All CLI arguments and options are passed unchanged.\n\n${OVERVIEW}`,
      inputSchema,
      outputSchema,
    },
    ({ args, stdin }) => execute(args, stdin),
  );

  for (const [command, help] of Object.entries(COMMAND_HELP)) {
    if (command === "mcp") continue;
    server.registerTool(
      `nodetto_${command}`,
      {
        description: help,
        inputSchema,
        outputSchema,
      },
      ({ args, stdin }) => execute([command, ...args], stdin),
    );
  }
  server.registerTool(
    "nodetto_help",
    {
      description:
        'Get the CLI overview, or detailed help for the command named in args. Pass [] for the overview or, for example, ["edit"].',
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
    },
    ({ args, stdin }) => execute(["help", ...args], stdin),
  );
  return server;
}

export async function serveMcp(io: CommandIo, version: string): Promise<void> {
  await createMcpServer(io, version).connect(new StdioServerTransport());
}
