import { expect, test } from "bun:test";
import { layerSearchMatchIds, selectLayerSearchMatches } from "./layer-tree.ts";
import { makeEditor } from "./test-helpers.ts";
import { replaceSelectedNoteText } from "./replace-note-text.ts";
import { parseDocument, serializeDocument } from "@diagra/io";

test("semantic search feeds note replacement without changing matching database fields", () => {
  const editor = makeEditor();
  const note = editor.createElement("text.note", {
    semantic: { text: "Old checkout" },
  });
  const hidden = editor.createElement("text.note", {
    semantic: { text: "Old help" },
    visual: { hidden: true },
  });
  const table = editor.createElement("erd.table", {
    semantic: {
      tableName: "orders",
      columns: [{ id: "col", name: "Old_status", dataType: "text" }],
    },
  });
  const untouched = editor.createElement("text.note", {
    semantic: { text: "Keep this" },
  });
  const before = editor.getSnapshot();
  expect(selectLayerSearchMatches(editor, "Old")).toBe(true);
  expect(new Set(editor.selection.ids())).toEqual(
    new Set([note, hidden, table]),
  );
  expect(replaceSelectedNoteText(editor, "Old", "New")).toBe(2);
  expect(editor.getText(note)).toBe("New checkout");
  expect(editor.getText(hidden)).toBe("New help");
  expect(editor.store.get(hidden)?.visual.hidden).toBe(true);
  expect(editor.getText(untouched)).toBe("Keep this");
  expect(editor.store.get(table)?.semantic).toEqual(
    before.elements.find((element) => element.id === table)?.semantic,
  );
  const saved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  expect(layerSearchMatchIds(editor, "Old")).toEqual([table]);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("search selection includes matching nested content but not context-only ancestors", () => {
  const editor = makeEditor();
  const note = editor.createElement("text.note", {
    semantic: { text: "Checkout" },
  });
  const group = editor.createElement("group", {
    semantic: { memberIds: [note] },
  });
  editor.selection.set([group]);
  const before = editor.getSnapshot();
  expect(layerSearchMatchIds(editor, "checkout")).toEqual([note]);
  expect(selectLayerSearchMatches(editor, "checkout")).toBe(true);
  expect([...editor.selection.ids()]).toEqual([note]);
  expect(editor.getSnapshot()).toEqual(before);
  expect(selectLayerSearchMatches(editor, "checkout")).toBe(false);
  editor.undo();
  expect(editor.store.get(group)).toBeUndefined();
});

test("search selection respects inherited locks, preserves empty results and never switches pages", () => {
  const editor = makeEditor();
  const note = editor.createElement("text.note", {
    semantic: { text: "Match" },
    visual: { hidden: true },
  });
  const group = editor.createElement("group", {
    semantic: { memberIds: [note] },
  });
  expect(layerSearchMatchIds(editor, "Match")).toEqual([note]);
  editor.apply([{ type: "updateVisual", id: group, visual: { locked: true } }]);
  editor.selection.set([group]);
  expect(selectLayerSearchMatches(editor, "Match")).toBe(false);
  expect(selectLayerSearchMatches(editor, " ")).toBe(false);
  expect([...editor.selection.ids()]).toEqual([group]);
  const page = editor.createPage({ name: "Other" });
  expect(selectLayerSearchMatches(editor, "Match")).toBe(false);
  expect(editor.currentPageId).toBe(page);
});
