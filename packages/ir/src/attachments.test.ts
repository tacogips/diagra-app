import { expect, test } from "bun:test";
import { isRelativeAttachmentPath } from "./attachments.ts";

const paths = (await Bun.file(
  new URL("../../../test-fixtures/attachment-paths.json", import.meta.url),
).json()) as { valid: string[]; invalid: string[] };

test("portable attachment paths match the native filesystem contract", () => {
  for (const path of paths.valid)
    expect(isRelativeAttachmentPath(path)).toBe(true);
  for (const path of paths.invalid)
    expect(isRelativeAttachmentPath(path)).toBe(false);
});

test("portable attachment path limits count UTF-8 bytes", () => {
  expect(isRelativeAttachmentPath("a".repeat(1024))).toBe(true);
  expect(isRelativeAttachmentPath("a".repeat(1025))).toBe(false);
  expect(isRelativeAttachmentPath("図".repeat(341))).toBe(true);
  expect(isRelativeAttachmentPath("図".repeat(342))).toBe(false);
});
