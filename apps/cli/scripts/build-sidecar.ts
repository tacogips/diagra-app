/** Build the native Rust CLI and stage the target-suffixed Tauri sidecar. */
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const rustc = Bun.spawnSync(["rustc", "-vV"], { stdout: "pipe" });
const host = /^host: (\S+)$/m.exec(rustc.stdout.toString())?.[1];
if (rustc.exitCode !== 0 || !host)
  throw new Error("Cannot determine the Rust host target triple.");
const triple = process.env.NODETTO_SIDECAR_TARGET ?? host;
const build = Bun.spawnSync(
  [
    "cargo",
    "build",
    "--locked",
    "--release",
    "-p",
    "nodetto-cli",
    "--target",
    triple,
  ],
  {
    cwd: root,
    env: { ...process.env, CARGO_TERM_QUIET: "true" },
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
const executable = `nodetto-cli${triple.includes("windows") ? ".exe" : ""}`;
const target = resolve(root, process.env.CARGO_TARGET_DIR ?? "target");
const outfile = resolve(
  root,
  "apps/desktop/src-tauri/binaries",
  `nodetto-cli-${triple}${triple.includes("windows") ? ".exe" : ""}`,
);
mkdirSync(dirname(outfile), { recursive: true });
copyFileSync(resolve(target, triple, "release", executable), outfile);
chmodSync(outfile, 0o755);
console.log(`Built native Rust CLI: ${outfile}`);
