#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import packageJson from "../package.json" with { type: "json" };
import { runCli } from "./commands.ts";

const result = runCli(
  process.argv.slice(2),
  {
    readText: (path) => readFileSync(path, "utf8"),
    writeText: (path, text) => writeFileSync(path, text, "utf8"),
  },
  packageJson.version,
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
