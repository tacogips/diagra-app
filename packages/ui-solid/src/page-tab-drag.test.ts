import { expect, test } from "bun:test";
import { Editor } from "@nodetto/core";
import { parseDocument, serializeDocument } from "@nodetto/io";
import {
  PageTabDrag,
  pageTabDropAt,
  type PageTabBox,
} from "./page-tab-drag.ts";

function fixture() {
  const editor = new Editor({
    document: {
      schemaVersion: 1,
      id: "doc",
      title: "Tabs",
      pages: ["a", "b", "c", "d"].map((id) => ({
        id,
        name: id,
        kind: "freeform" as const,
      })),
      elements: [],
    },
  });
  const boxes: PageTabBox[] = ["a", "b", "c", "d"].map((id, index) => ({
    id,
    x: index * 100,
    y: 0,
    width: 100,
    height: 30,
  }));
  const drag = new PageTabDrag(editor);
  return {
    editor,
    boxes,
    drag,
    ids: () => editor.store.listPages().map((page) => page.id),
  };
}

test("dragging a tab anywhere in the strip is one undoable persisted reorder and keeps the active view", () => {
  const { editor, boxes, drag, ids } = fixture();
  editor.setCurrentPage("b");
  const element = editor.createElement("node.generic");
  editor.selection.set([element]);
  editor.camera.set({ x: 25, y: 80, z: 2 });
  const before = editor.getSnapshot();
  const undo = editor.history.undoSize;
  expect(drag.start("a", 1, { x: 50, y: 15 })).toBe(true);
  expect(drag.move(1, { x: 390, y: 15 }, boxes)).toEqual({
    id: "d",
    side: "after",
  });
  expect(ids()).toEqual(["a", "b", "c", "d"]); // preview writes nothing
  expect(drag.finish(1)).toEqual({ dragged: true, reordered: true });
  expect(ids()).toEqual(["b", "c", "d", "a"]);
  expect(editor.currentPageId).toBe("b");
  expect(editor.camera.get()).toEqual({ x: 25, y: 80, z: 2 });
  expect([...editor.selection.ids()]).toEqual([element]);
  expect(editor.history.undoSize).toBe(undo + 1);
  const reopened = new Editor({
    document: parseDocument(serializeDocument(editor.getSnapshot())),
  });
  expect(reopened.store.listPages().map((p) => p.id)).toEqual(ids());
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.redo();
  expect(ids()).toEqual(["b", "c", "d", "a"]);
});

test("a click, a cancelled drag and a drop outside the tabs do not change page order", () => {
  const { editor, boxes, drag } = fixture();
  const before = editor.getSnapshot();
  for (const cancel of [false, true]) {
    drag.start("a", 1, { x: 50, y: 15 });
    if (cancel) {
      drag.move(1, { x: 390, y: 15 }, boxes);
      drag.cancel();
    }
    expect(drag.finish(1).reordered).toBe(false);
  }
  drag.start("a", 1, { x: 50, y: 15 });
  drag.move(1, { x: 390, y: 200 }, boxes);
  expect(drag.finish(1)).toEqual({ dragged: true, reordered: false });
  expect(editor.getSnapshot()).toEqual(before);
});

test("moving back to the first position and onto an adjacent gap avoids extra writes", () => {
  const { editor, boxes, drag, ids } = fixture();
  drag.start("d", 1, { x: 350, y: 15 });
  drag.move(1, { x: 0, y: 15 }, boxes);
  expect(drag.finish(1).reordered).toBe(true);
  expect(ids()).toEqual(["d", "a", "b", "c"]);
  const snapshot = editor.getSnapshot();
  expect(editor.reorderPageTo("d", 0)).toBe(false);
  expect(editor.reorderPageTo("d", -1)).toBe(false);
  expect(editor.reorderPageTo("d", 4)).toBe(false);
  expect(editor.reorderPageTo("d", Number.NaN)).toBe(false);
  expect(editor.reorderPageTo("d", 0.5)).toBe(false);
  expect(editor.getSnapshot()).toEqual(snapshot);
});

test("wrapped rows produce before/after anchors and invalid coordinates produce no target", () => {
  const boxes = [
    { id: "a", x: 0, y: 0, width: 100, height: 30 },
    { id: "b", x: 100, y: 0, width: 100, height: 30 },
    { id: "c", x: 0, y: 32, width: 100, height: 30 },
  ];
  expect(pageTabDropAt({ x: 40, y: 45 }, boxes)).toEqual({
    id: "c",
    side: "before",
  });
  expect(pageTabDropAt({ x: 95, y: 45 }, boxes)).toEqual({
    id: "c",
    side: "after",
  });
  expect(pageTabDropAt({ x: 300, y: 45 }, boxes)).toBeNull();
  expect(pageTabDropAt({ x: 0, y: 80 }, boxes)).toBeNull();
});

test("a peer rename or reorder is retained, while deleted tabs, replaced documents and viewers invalidate a drag", () => {
  for (const change of [
    "rename",
    "reorder",
    "source-delete",
    "target-delete",
    "reload",
    "viewer",
  ] as const) {
    const { editor, boxes, drag, ids } = fixture();
    drag.start("a", 1, { x: 50, y: 15 });
    drag.move(1, { x: 390, y: 15 }, boxes);
    if (change === "rename") editor.renamePage("d", "Peer name");
    if (change === "reorder") editor.reorderPage("b", 1);
    if (change === "source-delete") editor.deletePage("a");
    if (change === "target-delete") editor.deletePage("d");
    if (change === "reload") editor.loadDocument(editor.getSnapshot());
    if (change === "viewer") editor.setReadOnly(true);
    const before = editor.getSnapshot();
    expect(drag.finish(1).reordered).toBe(
      change === "rename" || change === "reorder",
    );
    if (change === "rename")
      expect(editor.store.getPage("d")?.name).toBe("Peer name");
    if (change === "reorder") expect(ids()).toEqual(["c", "b", "d", "a"]);
    if (change !== "rename" && change !== "reorder")
      expect(editor.getSnapshot()).toEqual(before);
  }
});

test("another pointer cannot take ownership or finish the drag", () => {
  const { boxes, drag, ids } = fixture();
  drag.start("a", 1, { x: 50, y: 15 });
  expect(drag.start("b", 2, { x: 150, y: 15 })).toBe(false);
  drag.move(1, { x: 390, y: 15 }, boxes);
  expect(drag.finish(2)).toEqual({ dragged: false, reordered: false });
  expect(drag.finish(1).reordered).toBe(true);
  expect(ids()).toEqual(["b", "c", "d", "a"]);
});
