import { expect, test } from "bun:test";
import { Editor } from "@nodetto/core";
import { serializeDocument } from "@nodetto/io";
import { exportCommand } from "./export-command.ts";
import type { CommandIo } from "./commands.ts";
test("CLI HTML export writes a multi-file ZIP and resolves only the requested frame's images", async () => {
  const editor = new Editor();
  const root = editor.createElement("frame", {
    semantic: { name: "Home", platform: "web" },
    visual: { x: 0, y: 0, width: 500, height: 500 },
  });
  editor.createElement("ui.control", {
    semantic: { control: "button", label: "Submit" },
    visual: { x: 20, y: 20, width: 180, height: 44 },
  });
  editor.createElement("image.raster", {
    semantic: { src: "artifacts/missing.png", alt: "Outside" },
    visual: { x: 1000, y: 1000, width: 10, height: 10 },
  });
  let output: Uint8Array | undefined;
  const io: CommandIo = {
    readText: () => serializeDocument(editor.getSnapshot()),
    writeText: () => {
      throw new Error("binary output required");
    },
    readAttachment: () => {
      throw new Error("outside image must not be read");
    },
    writeBytes: (_path, bytes) => {
      output = bytes;
    },
  };
  const result = await exportCommand(io, [
    "design.jsonl",
    "--format",
    "html",
    "--output",
    "site.zip",
    "--element",
    root,
  ]);
  expect(result.exitCode).toBe(0);
  expect(output).toBeDefined();
  const archive = new TextDecoder().decode(output);
  expect(archive).toContain("home.html");
  expect(archive).toContain("home.css");
  expect(archive).toContain("Submit");
  expect(archive).not.toContain("missing.png");
  expect(
    (await exportCommand(io, ["design.jsonl", "--format", "html"])).stderr,
  ).toContain("requires --output");
});
