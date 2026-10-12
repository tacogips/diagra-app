/**
 * Compile diagra-cli into a standalone executable that the desktop bundle
 * ships as a Tauri sidecar (`bundle.externalBin`). Tauri expects the file at
 * `binaries/diagra-cli-<rust target triple>` under src-tauri.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BUN_TARGETS: Readonly<Record<string, string>> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
};

function hostTriple(): string {
  const rustc = Bun.spawnSync(["rustc", "-vV"], { stdout: "pipe" });
  const host = /^host: (\S+)$/m.exec(rustc.stdout.toString())?.[1];
  if (rustc.exitCode !== 0 || !host)
    throw new Error("Cannot determine the Rust host target triple.");
  return host;
}

const triple = process.env.DIAGRA_SIDECAR_TARGET ?? hostTriple();
const bunTarget = BUN_TARGETS[triple];
if (!bunTarget) throw new Error(`No Bun compile target for ${triple}.`);
const root = resolve(import.meta.dir, "..");
const extension = triple.includes("windows") ? ".exe" : "";
const outfile = resolve(
  root,
  "../desktop/src-tauri/binaries",
  `diagra-cli-${triple}${extension}`,
);
mkdirSync(dirname(outfile), { recursive: true });
const build = Bun.spawnSync(
  [
    process.execPath,
    "build",
    "--compile",
    "--minify",
    `--target=${bunTarget}`,
    resolve(root, "src/main.ts"),
    "--outfile",
    outfile,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
console.log(`Built ${outfile}`);
