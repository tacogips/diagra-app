#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import packageJson from "../package.json" with { type: "json" };
import { EXIT_ERROR, runCli } from "./commands.ts";
import { writeFileAtomic } from "./write-atomic.ts";

let result: ReturnType<typeof runCli>;
try {
  result = runCli(
    process.argv.slice(2),
    {
      readText: (path) => readFileSync(path, "utf8"),
      writeText: writeFileAtomic,
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
