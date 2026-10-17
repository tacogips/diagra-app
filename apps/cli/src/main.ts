#!/usr/bin/env bun
import packageJson from "../package.json" with { type: "json" };
import { runCliAsync } from "./cli.ts";
import { type CommandResult, EXIT_ERROR } from "./commands.ts";
import { localIo } from "./local-io.ts";

// A reader that stops early (`| head`) is not an error worth a stack trace.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const args = process.argv.slice(2);
if (args[0] === "mcp" && args.length === 1) {
  try {
    const { serveMcp } = await import("./mcp.ts");
    await serveMcp(localIo(), packageJson.version);
  } catch (cause) {
    process.stderr.write(
      `nodetto-cli mcp: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = EXIT_ERROR;
  }
} else {
  let result: CommandResult;
  try {
    result = await runCliAsync(args, localIo(), packageJson.version);
  } catch (cause) {
    // Exit 1 means drift; an unexpected failure must not look like one.
    result = {
      exitCode: EXIT_ERROR,
      stdout: "",
      stderr: `nodetto-cli: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    };
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
