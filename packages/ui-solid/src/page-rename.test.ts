import { expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import { pageRenameDraft } from "./page-rename.ts";

test("page rename trims names, ignores blank drafts, and adds one undoable edit", () => {
  const editor = new Editor();
  const id = editor.currentPageId;
  const draft = pageRenameDraft(editor, id);
  const before = editor.getSnapshot();
  expect(draft?.commit(" ")).toBe("unchanged");
  expect(draft?.commit(draft.value)).toBe("unchanged");
  expect(draft?.commit(" Mobile checkout ")).toBe("saved");
  expect(editor.store.getPage(id)?.name).toBe("Mobile checkout");
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("page rename rejects changed names, deleted pages and replaced documents", () => {
  for (const change of ["rename", "delete", "reload"] as const) {
    const editor = new Editor();
    const id = editor.currentPageId;
    const draft = pageRenameDraft(editor, id);
    if (change === "rename") editor.renamePage(id, "Peer name");
    else if (change === "delete") {
      editor.createPage({ name: "Keep" });
      editor.deletePage(id);
    } else editor.loadDocument(editor.getSnapshot());
    const before = editor.getSnapshot();
    expect(draft?.commit("Stale name")).toBe("unavailable");
    expect(editor.getSnapshot()).toEqual(before);
  }
});

test("page rename preserves unrelated ordering changes", () => {
  const editor = new Editor();
  const id = editor.currentPageId;
  editor.createPage({ name: "Other" });
  const draft = pageRenameDraft(editor, id);
  editor.reorderPage(id, 1);
  const order = editor.store.getPage(id)?.order;
  expect(draft?.commit("Reordered page")).toBe("saved");
  expect(editor.store.getPage(id)?.order).toBe(order);
  editor.undo();
  expect(editor.store.getPage(id)?.order).toBe(order);
});
