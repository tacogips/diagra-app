import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Editor } from "@nodetto/core";
import { serializeDocument } from "@nodetto/io";
import { decodeRasterDataUrl } from "@nodetto/ir";
import { readLocalAttachment } from "./attachments.ts";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
test("CLI export resolves raster attachments beside the input document from another working directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodetto-cli-assets-"));
  try {
    mkdirSync(join(directory, "project/artifacts"), { recursive: true });
    mkdirSync(join(directory, "elsewhere"));
    const document = join(directory, "project/design.jsonl");
    const editor = new Editor();
    editor.createElement("image.raster", {
      semantic: { src: "artifacts/logo.png", alt: "Logo" },
      visual: { width: 50, height: 50 },
    });
    writeFileSync(document, serializeDocument(editor.getSnapshot()));
    writeFileSync(
      join(directory, "project/artifacts/logo.png"),
      decodeRasterDataUrl(PNG).bytes,
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        join(import.meta.dir, "main.ts"),
        "export",
        document,
        "--format",
        "svg",
      ],
      { cwd: join(directory, "elsewhere") },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(PNG);
    expect(result.stdout.toString()).not.toContain('href="artifacts/');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("CLI attachment reads reject traversal and symlinks outside the document folder", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodetto-cli-asset-paths-"));
  try {
    mkdirSync(join(directory, "project"));
    writeFileSync(
      join(directory, "private.png"),
      decodeRasterDataUrl(PNG).bytes,
    );
    const document = join(directory, "project/design.jsonl");
    expect(() => readLocalAttachment(document, "../private.png")).toThrow(
      "Invalid",
    );
    if (process.platform !== "win32") {
      symlinkSync(
        join(directory, "private.png"),
        join(directory, "project/link.png"),
      );
      expect(() => readLocalAttachment(document, "link.png")).toThrow(
        "escapes",
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
