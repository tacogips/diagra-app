#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import packageJson from "../package.json" with { type: "json" };
import { runCliAsync } from "./cli.ts";
import { type CommandResult, EXIT_ERROR } from "./commands.ts";
import { readLocalAttachment } from "./attachments.ts";
import { openDesktopDocument } from "./open-desktop.ts";
import { writeFileAtomic } from "./write-atomic.ts";

// A reader that stops early (`| head`) is not an error worth a stack trace.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

let result: CommandResult;
try {
  result = await runCliAsync(
    process.argv.slice(2),
    {
      readText: (path) => readFileSync(path, "utf8"),
      readAttachment: readLocalAttachment,
      openDocument: openDesktopDocument,
      readStdin: () => readFileSync(0, "utf8"),
      writeText: writeFileAtomic,
      writeBytes: writeFileAtomic,
      exists: (path) => existsSync(path),
    },
    packageJson.version,
  );
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
