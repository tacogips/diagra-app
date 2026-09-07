import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { type Document, validateDocument } from "@diagra/ir";
import { document, element, makeEditor } from "./test-helpers.ts";
import { wrapTextLines } from "./svg-export.ts";

test("typography persists, exports safely, and supports undo", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "text",
        type: "text.note",
        semantic: { text: "Heading\nSubtitle" },
        visual: { x: 0, y: 0, width: 600, height: 200 },
      }),
    ]),
  });
  const before = editor.getSnapshot();
  editor.selection.set(["text"]);
  editor.setSelectionStyle({
    fontFamily: 'Example "Font"',
    fontSize: 32,
    fontWeight: 700,
    fontStyle: "italic",
    lineHeight: 1.5,
    letterSpacing: 2,
  });
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  const svg = editor.exportPageSvg();
  expect(svg).toContain('font-family="Example &quot;Font&quot;"');
  expect(svg).toContain('font-weight="700"');
  expect(svg).toContain('font-style="italic"');
  expect(svg).toContain('letter-spacing="2"');
  expect(svg).toContain("Subtitle");
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("tracking participates in deterministic line wrapping", () => {
  const normal = wrapTextLines("one two three four five six", 120, 16);
  const tracked = wrapTextLines("one two three four five six", 120, 16, 8);
  expect(tracked.length).toBeGreaterThan(normal.length);
});

test("invalid typography is rejected", () => {
  for (const style of [
    { fontWeight: 1001 },
    { lineHeight: 0 },
    { fontStyle: "oblique" },
    { fontFamily: 32 },
    { letterSpacing: "wide" },
  ]) {
    const invalid = document([
      element({
        id: "text",
        type: "text.note",
        semantic: { text: "Test" },
        visual: {},
      }),
    ]);
    const raw = {
      ...invalid,
      elements: invalid.elements.map((item) => ({
        ...item,
        visual: { style },
      })),
    };
    expect(
      validateDocument(raw as unknown as Document).some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
  }
});
