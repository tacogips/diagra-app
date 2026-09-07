import { expect, test } from "bun:test";
import { assertValidDocument } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { makeEditor } from "./test-helpers.ts";

test("text vertical alignment exports, persists and undoes", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: { text: "Hello" },
    visual: {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      style: { fontSize: 20, lineHeight: 1 },
    },
  });
  editor.apply([{ type: "createElement", element: note }]);
  editor.selection.set([note.id]);
  const before = editor.getSnapshot();
  expect(editor.exportPageSvg()).toContain('y="16"');
  editor.setSelectionStyle({ verticalAlign: "middle" });
  expect(editor.exportPageSvg()).toContain('y="50"');
  const saved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  editor.setSelectionStyle({ verticalAlign: "bottom" });
  expect(editor.exportPageSvg()).toContain('y="84"');
  editor.undo();
  expect(editor.getSnapshot()).toEqual(saved);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("overflowing aligned text retains its start and invalid alignment is rejected", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: { text: "One\nTwo\nThree" },
    visual: {
      width: 200,
      height: 30,
      style: { fontSize: 20, lineHeight: 1, verticalAlign: "bottom" },
    },
  });
  editor.apply([{ type: "createElement", element: note }]);
  expect(editor.exportPageSvg()).toContain('y="16"');
  expect(editor.exportPageSvg()).toContain("One</text>");
  const snapshot = editor.getSnapshot();
  expect(() =>
    assertValidDocument({
      ...snapshot,
      elements: [
        {
          ...note,
          visual: {
            ...note.visual,
            style: { verticalAlign: "sideways" as never },
          },
        },
      ],
    }),
  ).toThrow();
});
