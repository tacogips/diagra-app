import { expect, test } from "bun:test";
import { serializeDocument } from "@diagra/io";
import {
  normalizeTextMarks,
  rebaseTextMarks,
  richTextSegments,
  toggleTextMarkRange,
} from "./rich-text.ts";
import { makeEditor } from "./test-helpers.ts";

test("normalizes and segments overlapping portable text marks", () => {
  const marks = normalizeTextMarks("Design system", [
    { start: 7, end: 13, kind: "italic" },
    { start: 0, end: 6, kind: "bold" },
    { start: 6, end: 10, kind: "bold" },
    { start: 0, end: 6, kind: "link", href: "https://diagra.app" },
  ]);
  expect(marks).toEqual([
    { start: 0, end: 10, kind: "bold" },
    { start: 0, end: 6, kind: "link", href: "https://diagra.app" },
    { start: 7, end: 13, kind: "italic" },
  ]);
  expect(richTextSegments({ text: "Design system", marks })).toEqual([
    {
      start: 0,
      end: 6,
      text: "Design",
      marks: [
        { start: 0, end: 10, kind: "bold" },
        { start: 0, end: 6, kind: "link", href: "https://diagra.app" },
      ],
    },
    {
      start: 6,
      end: 7,
      text: " ",
      marks: [{ start: 0, end: 10, kind: "bold" }],
    },
    {
      start: 7,
      end: 10,
      text: "sys",
      marks: [
        { start: 0, end: 10, kind: "bold" },
        { start: 7, end: 13, kind: "italic" },
      ],
    },
    {
      start: 10,
      end: 13,
      text: "tem",
      marks: [{ start: 7, end: 13, kind: "italic" }],
    },
  ]);
});

test("toggle adds, merges and removes only the selected portion", () => {
  const added = toggleTextMarkRange("abcdef", [], 1, 5, "bold");
  expect(added).toEqual([{ start: 1, end: 5, kind: "bold" }]);
  expect(toggleTextMarkRange("abcdef", added, 2, 4, "bold")).toEqual([
    { start: 1, end: 2, kind: "bold" },
    { start: 4, end: 5, kind: "bold" },
  ]);
  expect(toggleTextMarkRange("abcdef", added, 4, 6, "bold")).toEqual([
    { start: 1, end: 6, kind: "bold" },
  ]);
});

test("plain text edits rebase marks around replacement text", () => {
  const marks = [
    { start: 0, end: 5, kind: "bold" as const },
    { start: 6, end: 11, kind: "italic" as const },
  ];
  expect(rebaseTextMarks("Hello world", "Hello wide world", marks)).toEqual([
    { start: 0, end: 5, kind: "bold" },
    { start: 6, end: 16, kind: "italic" },
  ]);
  expect(rebaseTextMarks("Hello world", "Hello all", marks)).toEqual([
    { start: 0, end: 5, kind: "bold" },
    { start: 6, end: 9, kind: "italic" },
  ]);
});

test("editor rich-text changes are atomic, serializable and undoable", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: { text: "Design system" },
  });
  editor.apply([{ type: "createElement", element: note }]);
  expect(editor.toggleTextMark(note.id, 0, 6, "bold")).toBe(true);
  expect(
    editor.toggleTextMark(note.id, 7, 13, "link", "https://diagra.app"),
  ).toBe(true);
  expect(serializeDocument(editor.getSnapshot())).toContain(
    '"marks":[{"start":0,"end":6,"kind":"bold"},{"start":7,"end":13,"kind":"link","href":"https://diagra.app"}]',
  );
  expect(editor.setText(note.id, "Design language system")).toBe(true);
  expect(editor.store.get(note.id)?.semantic).toEqual({
    text: "Design language system",
    marks: [
      { start: 0, end: 6, kind: "bold" },
      { start: 16, end: 22, kind: "link", href: "https://diagra.app" },
    ],
  });
  editor.undo();
  expect(editor.getText(note.id)).toBe("Design system");
});

test("shortening marked text never leaves invalid mark offsets", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: {
      text: "Long marked label",
      marks: [{ start: 5, end: 17, kind: "italic" }],
    },
  });
  editor.apply([{ type: "createElement", element: note }]);
  expect(editor.setText(note.id, "Short")).toBe(true);
  expect(editor.store.get(note.id)?.semantic).toEqual({
    text: "Short",
    marks: [{ start: 0, end: 5, kind: "italic" }],
  });
});
