import { expect, test } from "bun:test";
import { Editor } from "./editor.ts";

test("read-only blocks document commands and undo while preserving navigation and export", () => {
  const editor = new Editor();
  const page = editor.currentPageId;
  const note = editor.createElement("text.note", {
    semantic: { text: "Review me" },
  });
  const other = editor.createPage({ name: "Other" });
  const before = editor.getSnapshot();
  editor.setReadOnly(true);
  expect(
    editor.apply([{ type: "updateVisual", id: note, visual: { x: 99 } }]),
  ).toEqual({ undo: [], redo: [] });
  editor.apply([
    { type: "deleteElements", ids: [note] },
    { type: "deletePage", id: other },
  ]);
  editor.createElement("shape.geo", { semantic: { geo: "rect" } });
  editor.createPage({ name: "Rejected page" });
  expect(editor.setText(note, "Rejected text")).toBe(false);
  expect(editor.undo()).toBe(false);
  expect(editor.redo()).toBe(false);
  expect(editor.canUndo()).toBe(false);
  expect(editor.canRedo()).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
  editor.setCurrentPage(page);
  editor.selection.set([note]);
  editor.camera.set({ x: 40, y: 50, z: 2 });
  editor.copySelection();
  expect(editor.exportSelectionSvg()).toContain("Review me");
  expect(editor.currentPageId).toBe(page);
  expect(editor.getSnapshot()).toEqual(before);
  editor.setReadOnly(false);
  expect(editor.setText(note, "Editable again")).toBe(true);
});

test("read-only is local session state and does not reject incoming document refreshes", () => {
  const editor = new Editor();
  const note = editor.createElement("text.note", {
    semantic: { text: "Before" },
  });
  const remote = new Editor({ document: editor.getSnapshot() });
  editor.setReadOnly(true);
  remote.setText(note, "Remote text");
  editor.loadDocument(remote.getSnapshot(), { preserveView: true });
  expect(editor.readOnly).toBe(true);
  expect(editor.getText(note)).toBe("Remote text");
  expect(editor.getSnapshot()).toEqual(remote.getSnapshot());
  expect(new Editor({ document: editor.getSnapshot() }).readOnly).toBe(false);
});
