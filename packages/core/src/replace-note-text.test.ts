import { expect, test } from "bun:test";
import {
  previewNoteTextReplacement,
  replaceSelectedNoteText,
} from "./replace-note-text.ts";
import { makeEditor } from "./test-helpers.ts";
import {
  replaceMarkedTextRange,
  replaceMarkedTextRanges,
} from "./rich-text.ts";
import type { TextMark } from "@diagra/ir";

test("bulk range replacement agrees with exact sequential edits across mark boundaries", () => {
  const previous = "abc abc abc";
  const ranges = [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 11 },
  ];
  for (let start = 0; start < previous.length; start += 1) {
    for (let end = start + 1; end <= previous.length; end += 1) {
      const marks: readonly TextMark[] = [
        { kind: "bold", start, end },
        { kind: "italic", start: 4, end: 7 },
      ];
      for (const replacement of ["", "a", "abcdef"]) {
        let sequential = { text: previous, marks };
        for (const range of [...ranges].reverse())
          sequential = replaceMarkedTextRange(
            sequential.text,
            sequential.marks,
            range.start,
            range.end,
            replacement,
          );
        expect(
          replaceMarkedTextRanges(previous, marks, ranges, replacement),
        ).toEqual(sequential);
      }
    }
  }
});

test("bulk ranges reject overlaps and keep the maximum supported match batch exact", () => {
  expect(() =>
    replaceMarkedTextRanges(
      "abcd",
      [],
      [
        { start: 0, end: 2 },
        { start: 1, end: 3 },
      ],
      "x",
    ),
  ).toThrow("ranges");
  const editor = makeEditor();
  const id = editor.createElement("text.note", {
    semantic: {
      text: "a ".repeat(1000),
      marks: [{ kind: "bold", start: 0, end: 2000 }],
    },
  });
  editor.selection.set([id]);
  expect(replaceSelectedNoteText(editor, "a", "long")).toBe(1);
  expect(editor.getText(id)).toBe("long ".repeat(1000));
  expect(editor.store.get(id)?.semantic).toMatchObject({
    marks: [{ kind: "bold", start: 0, end: 5000 }],
  });
});

test("repeated-character replacements retain formatting on the exact matched occurrence", () => {
  const editor = makeEditor();
  const id = editor.createElement("text.note", {
    semantic: {
      text: "aa",
      marks: [
        { kind: "bold", start: 0, end: 1 },
        { kind: "italic", start: 1, end: 2 },
      ],
    },
  });
  editor.selection.set([id]);
  expect(replaceSelectedNoteText(editor, "a", "aa")).toBe(1);
  expect(editor.store.get(id)?.semantic).toMatchObject({
    text: "aaaa",
    marks: [
      { kind: "bold", start: 0, end: 2 },
      { kind: "italic", start: 2, end: 4 },
    ],
  });
  editor.undo();
  expect(editor.getText(id)).toBe("aa");
});

test("exact range replacement validates boundaries and removes only intersected formatting", () => {
  expect(
    replaceMarkedTextRange(
      "aaa",
      [
        { kind: "bold", start: 0, end: 1 },
        { kind: "italic", start: 2, end: 3 },
      ],
      0,
      1,
      "",
    ),
  ).toEqual({ text: "aa", marks: [{ kind: "italic", start: 1, end: 2 }] });
  for (const [start, end] of [
    [-1, 1],
    [2, 1],
    [0, 4],
    [0.5, 1],
  ])
    expect(() => replaceMarkedTextRange("aaa", [], start!, end!, "x")).toThrow(
      "range",
    );
});

test("literal replacement preserves intervening rich text and is one undoable transaction", () => {
  const editor = makeEditor();
  const a = editor.createElement("text.note", {
    semantic: {
      text: "Old middle Old",
      marks: [{ kind: "bold", start: 4, end: 10 }],
    },
  });
  const b = editor.createElement("text.note", {
    semantic: { text: "Old.* old" },
  });
  editor.selection.set([a, b]);
  const before = editor.getSnapshot();
  expect(previewNoteTextReplacement(editor, "Old", "$&")).toHaveLength(2);
  expect(editor.getSnapshot()).toEqual(before);
  expect(replaceSelectedNoteText(editor, "Old", "$&")).toBe(2);
  expect(editor.getText(a)).toBe("$& middle $&");
  expect(editor.store.get(a)?.semantic).toMatchObject({
    marks: [{ kind: "bold", start: 3, end: 9 }],
  });
  expect(editor.getText(b)).toBe("$&.* old");
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("replacement skips locked notes and non-note semantics and rechecks current selection", () => {
  const editor = makeEditor();
  const note = editor.createElement("text.note", {
    semantic: { text: "users" },
    visual: { locked: true },
  });
  const table = editor.createElement("erd.table", {
    semantic: { tableName: "users", columns: [] },
  });
  editor.selection.set([note, table]);
  const before = editor.getSnapshot();
  expect(replaceSelectedNoteText(editor, "users", "accounts")).toBe(0);
  expect(editor.getSnapshot()).toEqual(before);
  expect(replaceSelectedNoteText(editor, "", "x")).toBe(0);
});

test("excessive replacement fails before mutating any selected note", () => {
  const editor = makeEditor();
  const a = editor.createElement("text.note", { semantic: { text: "a" } });
  const b = editor.createElement("text.note", {
    semantic: { text: "a".repeat(1001) },
  });
  editor.selection.set([a, b]);
  const before = editor.getSnapshot();
  expect(() => replaceSelectedNoteText(editor, "a", "b")).toThrow("1,000");
  expect(editor.getSnapshot()).toEqual(before);
});

test("replacement preview identifies named notes and reports all occurrences beyond the opening excerpt", () => {
  const editor = makeEditor();
  const text = `${"Introduction ".repeat(20)}Old Old`;
  const id = editor.createElement("text.note", {
    semantic: { text },
    visual: { layerName: "Checkout copy" },
  });
  editor.selection.set([id]);
  const before = editor.getSnapshot();
  const [row] = previewNoteTextReplacement(editor, "Old", "New");
  expect(row).toMatchObject({
    id,
    name: "Checkout copy",
    matches: 2,
    previous: text,
    text: text.replaceAll("Old", "New"),
  });
  expect(editor.getSnapshot()).toEqual(before);
});

test("replacement recomputes after preview and respects inherited locks and page changes", () => {
  const editor = makeEditor();
  const id = editor.createElement("text.note", { semantic: { text: "Old" } });
  const group = editor.createElement("group", {
    semantic: { memberIds: [id] },
  });
  editor.selection.set([id]);
  expect(previewNoteTextReplacement(editor, "Old", "New")).toHaveLength(1);
  editor.setText(id, "Peer value");
  expect(replaceSelectedNoteText(editor, "Old", "New")).toBe(0);
  editor.setText(id, "Old");
  editor.apply([{ type: "updateVisual", id: group, visual: { locked: true } }]);
  expect(replaceSelectedNoteText(editor, "Old", "New")).toBe(0);
  editor.undo();
  editor.selection.set([group]);
  expect(replaceSelectedNoteText(editor, "Old", "New")).toBe(0);
  editor.createPage({ name: "Other" });
  editor.selection.set([id]);
  expect(replaceSelectedNoteText(editor, "Old", "New")).toBe(0);
  expect(editor.getText(id)).toBe("Old");
});

test("replacement supports removal and validates oversized inputs and generated output atomically", () => {
  const editor = makeEditor();
  const id = editor.createElement("text.note", {
    semantic: { text: "x".repeat(500) },
  });
  editor.selection.set([id]);
  const before = editor.getSnapshot();
  for (const [find, replacement] of [
    ["x".repeat(257), "y"],
    ["x", "y".repeat(257)],
    ["x", "y".repeat(256)],
  ])
    expect(() =>
      replaceSelectedNoteText(editor, find!, replacement!),
    ).toThrow();
  expect(editor.getSnapshot()).toEqual(before);
  expect(replaceSelectedNoteText(editor, "x", "")).toBe(1);
  expect(editor.getText(id)).toBe("");
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});
