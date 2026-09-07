import { expect, test } from "bun:test";
import { createDefaultRegistry, Editor, renameLayer } from "@diagra/core";
import { layerRenameDraft } from "./layer-rename.ts";

function fixture() {
  const editor = new Editor({ registry: createDefaultRegistry() });
  const id = editor.createElement("text.note", {
    semantic: { text: "Checkout" },
  });
  return { editor, id };
}

test("inline rename leaves untouched semantic labels implicit and commits one undoable name", () => {
  const { editor, id } = fixture();
  const draft = layerRenameDraft(editor, id);
  expect(draft?.value).toBe("Checkout");
  expect(draft?.commit("Checkout")).toBe("unchanged");
  expect(editor.store.get(id)?.visual.layerName).toBeUndefined();
  expect(draft?.commit(" Primary action ")).toBe("saved");
  expect(editor.store.get(id)?.visual.layerName).toBe("Primary action");
  expect(editor.store.get(id)?.semantic).toEqual({ text: "Checkout" });
  editor.undo();
  expect(editor.store.get(id)?.visual.layerName).toBeUndefined();
  editor.redo();
  expect(editor.store.get(id)?.visual.layerName).toBe("Primary action");
  expect(layerRenameDraft(editor, id)?.commit(" ")).toBe("saved");
  expect(editor.store.get(id)?.visual.layerName).toBeUndefined();
});

test("inline rename preserves geometry and unrelated edits made during typing", () => {
  const { editor, id } = fixture();
  const draft = layerRenameDraft(editor, id);
  editor.apply([
    { type: "updateVisual", id, visual: { x: 250, rotation: 0.5 } },
  ]);
  expect(draft?.commit("New label")).toBe("saved");
  expect(editor.store.get(id)?.visual.x).toBe(250);
  expect(editor.store.get(id)?.visual.rotation).toBe(0.5);
  editor.undo();
  expect(editor.store.get(id)?.visual.x).toBe(250);
});

test("inline rename refuses concurrent labels and deleted or newly locked targets", () => {
  for (const change of ["rename", "delete", "lock"] as const) {
    const { editor, id } = fixture();
    const draft = layerRenameDraft(editor, id);
    if (change === "rename") renameLayer(editor, id, "Peer label");
    else if (change === "delete") editor.deleteElements([id]);
    else editor.apply([{ type: "updateVisual", id, visual: { locked: true } }]);
    const before = editor.getSnapshot();
    expect(draft?.commit("My label")).toBe("unavailable");
    expect(editor.getSnapshot()).toEqual(before);
    if (change !== "rename")
      expect(layerRenameDraft(editor, id)).toBeUndefined();
  }
});

test("inline rename cannot apply to a reloaded document even with identical IDs", () => {
  const { editor, id } = fixture();
  const draft = layerRenameDraft(editor, id);
  editor.loadDocument(editor.getSnapshot());
  expect(draft?.commit("Wrong document")).toBe("unavailable");
  expect(editor.store.get(id)?.visual.layerName).toBeUndefined();
});
