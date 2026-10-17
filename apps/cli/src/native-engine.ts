// Build-time entry point for the shared diagram engine embedded in the Rust
// executable. It imports no Node/Bun APIs; OS operations belong to Rust.
import { runCli } from "./commands.ts";
import { exportCommand } from "./export-command.ts";
import { openCommand } from "./open-command.ts";
import { pdfLayout } from "@nodetto/core";
import { COMMAND_HELP, OVERVIEW } from "./help.ts";

declare const native: {
  path(path: string): string;
  readText(path: string): string;
  writeBytes(path: string, data: Uint8Array): void;
  exists(path: string): boolean;
  readStdin(): string;
  attachment(document: string, path: string): Uint8Array;
  open(path: string, app: string | undefined): void;
  png(svg: string, scale: number, fontDir: string | undefined): Uint8Array;
  pdf(png: Uint8Array, layout: string): Uint8Array;
};

const io = {
  readText: (path: string) => native.readText(native.path(path)),
  writeText: (path: string, text: string) =>
    native.writeBytes(native.path(path), new TextEncoder().encode(text)),
  writeBytes: (path: string, bytes: Uint8Array) =>
    native.writeBytes(native.path(path), bytes),
  exists: (path: string) => native.exists(native.path(path)),
  readStdin: native.readStdin,
  readAttachment: (document: string, path: string) =>
    new Uint8Array(native.attachment(native.path(document), path)),
  openDocument: async (path: string, app?: string) =>
    native.open(native.path(path), app),
};

// JSON at this boundary keeps interpreter handles local to each Rust invocation.
Object.assign(globalThis, {
  nodettoHelp: JSON.stringify({ overview: OVERVIEW, commands: COMMAND_HELP }),
  nodettoRun: async (input: string, version: string) => {
    const args = JSON.parse(input) as string[];
    const [command, ...rest] = args;
    const help = rest.includes("--help") || rest.includes("-h");
    const result =
      command === "export" && !help
        ? await exportCommand(io, rest, {
            rasterize: async (svg, scale, fontDir) =>
              new Uint8Array(
                native.png(
                  svg,
                  scale,
                  fontDir === undefined ? undefined : native.path(fontDir),
                ),
              ),
            pngToPdf: async (png, width, height, options) =>
              new Uint8Array(
                native.pdf(
                  png,
                  JSON.stringify(pdfLayout(width, height, options)),
                ),
              ),
          })
        : command === "open" && !help
          ? await openCommand(io, rest)
          : runCli(args, io, version);
    return JSON.stringify(result);
  },
});
