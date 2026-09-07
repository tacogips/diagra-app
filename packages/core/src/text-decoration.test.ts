import { expect, test } from "bun:test";
import { assertValidDocument } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { inspectDesign } from "./handoff.ts";
import { makeEditor } from "./test-helpers.ts";

test("text decorations persist, export, hand off and undo", () => {
  for (const textDecoration of [
    "none",
    "underline",
    "line-through",
    "underline line-through",
  ] as const) {
    const editor = makeEditor();
    const note = editor.buildElement("text.note", {
      semantic: { text: "Label" },
    });
    editor.apply([{ type: "createElement", element: note }]);
    editor.selection.set([note.id]);
    const before = editor.getSnapshot();
    editor.setSelectionStyle({ textDecoration });
    expect(editor.exportPageSvg()).toContain(
      `text-decoration="${textDecoration}"`,
    );
    expect(inspectDesign(editor, note.id)?.css).toContain(
      `text-decoration: ${textDecoration};`,
    );
    expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
      editor.getSnapshot(),
    );
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
  }
});

test("unsupported decoration values are rejected", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note");
  expect(() =>
    assertValidDocument({
      ...editor.getSnapshot(),
      elements: [
        { ...note, visual: { style: { textDecoration: "blink" as never } } },
      ],
    }),
  ).toThrow();
});
