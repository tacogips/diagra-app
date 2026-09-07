import { expect, test } from "bun:test";
import { CollabBinding } from "@diagra/collab";
import { Editor } from "@diagra/core";
import * as Y from "yjs";
import { textEditDraft } from "../../../packages/ui-solid/src/text-edit-draft.ts";
import { layerRenameDraft } from "../../../packages/ui-solid/src/layer-rename.ts";
import { pageRenameDraft } from "../../../packages/ui-solid/src/page-rename.ts";

test("remote page changes do not invalidate untouched-field drafts", () => {
  const editor = new Editor();
  const page = editor.currentPageId;
  const note = editor.createElement("text.note", {
    semantic: { text: "Original" },
  });
  const other = editor.createPage({ name: "Other" });
  const firstDoc = new Y.Doc();
  const first = new CollabBinding({ editor, doc: firstDoc, captureTimeout: 0 });
  first.attach();
  const secondDoc = new Y.Doc();
  Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc));
  const remote = new Editor();
  const second = new CollabBinding({
    editor: remote,
    doc: secondDoc,
    captureTimeout: 0,
  });
  second.attach();
  try {
    const text = textEditDraft(editor, note);
    const layer = layerRenameDraft(editor, note);
    const name = pageRenameDraft(editor, page);
    remote.renamePage(other, "Peer page name");
    Y.applyUpdate(firstDoc, Y.encodeStateAsUpdate(secondDoc));
    expect(editor.store.getPage(other)?.name).toBe("Peer page name");
    expect(name?.commit("Design notes")).toBe("saved");
    // Layer display names can fall back to text, so rename before text changes.
    expect(layer?.commit("Heading")).toBe("saved");
    expect(text?.commit("Local note")).toBe("saved");
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc));
    expect(remote.getText(note)).toBe("Local note");
    expect(remote.store.getPage(page)?.name).toBe("Design notes");
    expect(first.undo()).toBe(true);
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc));
    expect(remote.getText(note)).toBe("Original");
    expect(remote.store.getPage(other)?.name).toBe("Peer page name");

    const conflicting = textEditDraft(editor, note);
    remote.setText(note, "Peer note");
    Y.applyUpdate(firstDoc, Y.encodeStateAsUpdate(secondDoc));
    expect(conflicting?.commit("Stale local note")).toBe("unavailable");
    expect(conflicting?.commit("Original")).toBe("unchanged");
    expect(editor.getText(note)).toBe("Peer note");
  } finally {
    first.detach();
    second.detach();
    firstDoc.destroy();
    secondDoc.destroy();
  }
});
