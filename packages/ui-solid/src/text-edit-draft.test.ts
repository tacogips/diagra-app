import { expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import { textEditDraft } from "./text-edit-draft.ts";

test("untouched text drafts preserve newer peer text without an undo entry", () => {
  const editor = new Editor();
  const id = editor.createElement("text.note", {
    semantic: { text: "Original" },
  });
  const draft = textEditDraft(editor, id);
  editor.setText(id, "Peer text");
  const before = editor.getSnapshot();
  expect(draft?.commit("Original")).toBe("unchanged");
  expect(editor.getSnapshot()).toEqual(before);
  expect(draft?.commit("Local text")).toBe("unavailable");
  expect(editor.getSnapshot()).toEqual(before);
  expect(draft?.commit("Peer text")).toBe("unchanged");
  editor.undo();
  expect(editor.getText(id)).toBe("Original");
});

test("draft commits preserve unrelated geometry and semantic edits with one undo", () => {
  const editor = new Editor();
  const id = editor.createElement("erd.table", {
    semantic: { tableName: "users", columns: [] },
  });
  const draft = textEditDraft(editor, id);
  editor.moveElements([{ id, x: 300, y: 200 }]);
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        tableName: "users",
        columns: [{ id: "id", name: "id", dataType: "uuid" }],
      },
    },
  ]);
  const before = editor.getSnapshot();
  expect(draft?.commit("customers")).toBe("saved");
  expect(editor.getText(id)).toBe("customers");
  expect(editor.store.get(id)?.visual.x).toBe(300);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("changed drafts cannot write to deleted, locked, or replaced documents", () => {
  for (const change of ["delete", "lock", "reload"] as const) {
    const editor = new Editor();
    const id = editor.createElement("text.note", {
      semantic: { text: "Original" },
    });
    const draft = textEditDraft(editor, id);
    if (change === "delete")
      editor.apply([{ type: "deleteElements", ids: [id] }]);
    if (change === "lock")
      editor.apply([{ type: "updateVisual", id, visual: { locked: true } }]);
    if (change === "reload") editor.loadDocument(editor.getSnapshot());
    const before = editor.getSnapshot();
    expect(draft?.commit("Local text")).toBe("unavailable");
    expect(editor.getSnapshot()).toEqual(before);
  }
});

test("multiline Unicode and empty note drafts remain valid edits", () => {
  const editor = new Editor();
  const id = editor.createElement("text.note", {
    semantic: { text: "Original" },
  });
  expect(textEditDraft(editor, id)?.commit("日本語\né")).toBe("saved");
  expect(editor.getText(id)).toBe("日本語\né");
  expect(textEditDraft(editor, id)?.commit("")).toBe("saved");
  expect(editor.getText(id)).toBe("");
});

test("preserveView does not retain draft authority across different documents", () => {
  const editor = new Editor();
  const id = editor.createElement("text.note", {
    semantic: { text: "Original" },
  });
  const draft = textEditDraft(editor, id);
  const revision = editor.documentOpenRevision;
  editor.loadDocument(
    { ...editor.getSnapshot(), id: "different-document" },
    { preserveView: true },
  );
  expect(editor.documentOpenRevision).toBe(revision + 1);
  expect(draft?.commit("Stale draft")).toBe("unavailable");
  expect(editor.getText(id)).toBe("Original");
});
