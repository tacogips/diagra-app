import { expect, test } from "bun:test";
import { frameParents, expandContainers } from "./frame-tree.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

test("explicit memberships and leaf expansion avoid geometric hierarchy scans", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        semantic: { name: "Screen", memberIds: ["leaf"] },
      }),
      element({ id: "leaf", type: "shape.geo", semantic: { geo: "rect" } }),
    ]),
  });
  const context = {
    ...editor.createShapeContext(),
    boundsOf: () => {
      throw new Error("unexpected geometry scan");
    },
  };
  expect([
    ...frameParents(editor.store, editor.currentPageId, context),
  ]).toEqual([["leaf", "frame"]]);
  expect(
    expandContainers(editor.store, ["leaf", "missing", "leaf"], context),
  ).toEqual(["leaf"]);
});

function screenEditor() {
  return makeEditor({
    document: document([
      element({
        id: "screen",
        index: "a1",
        type: "frame",
        semantic: { name: "Checkout" },
        visual: { x: 0, y: 0, width: 390, height: 844 },
      }),
      element({
        id: "card",
        index: "a2",
        type: "frame",
        semantic: { name: "Card" },
        visual: { x: 20, y: 50, width: 300, height: 250 },
      }),
      element({
        id: "label",
        index: "a3",
        type: "text.note",
        semantic: { text: "Pay" },
        visual: { x: 40, y: 70, width: 100, height: 40 },
      }),
      element({
        id: "outside",
        index: "a4",
        type: "node.generic",
        semantic: { label: "Outside" },
        visual: { x: 500, y: 70, width: 100, height: 40 },
      }),
    ]),
  });
}

test("smallest enclosing artboard owns a layer; nested movement is applied once", () => {
  const editor = screenEditor();
  const parents = frameParents(
    editor.store,
    editor.currentPageId,
    editor.createShapeContext(),
  );
  expect(parents.get("card")).toBe("screen");
  expect(parents.get("label")).toBe("card");
  expect(parents.has("outside")).toBe(false);
  editor.selection.set(["screen", "card", "label"]);
  editor.nudgeSelection(10, 15);
  expect(editor.store.get("label")?.visual.x).toBe(50);
  expect(editor.store.get("card")?.visual.x).toBe(30);
  expect(editor.store.get("outside")?.visual.x).toBe(500);
  editor.undo();
  expect(editor.store.get("label")?.visual.x).toBe(40);
});

test("duplicate and delete act on the complete screen with undo", () => {
  const editor = screenEditor();
  editor.selection.set(["screen"]);
  const copies = editor.duplicateSelection();
  expect(copies).toHaveLength(3);
  editor.undo();
  editor.selection.set(["screen"]);
  editor.deleteSelection();
  expect(editor.store.has("screen")).toBe(false);
  expect(editor.store.has("card")).toBe(false);
  expect(editor.store.has("label")).toBe(false);
  expect(editor.store.has("outside")).toBe(true);
  editor.undo();
  expect(editor.store.has("label")).toBe(true);
});

test("copy includes nested screen contents but not unrelated elements", () => {
  const editor = screenEditor();
  editor.selection.set(["screen"]);
  expect(editor.copySelection()).toBe(true);
  expect(editor.paste()).toHaveLength(3);
});

test("overlapping frames cannot own each other or capture lower layers", () => {
  const editor = screenEditor();
  const overlay = editor.buildElement("frame", {
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  editor.apply([{ type: "createElement", element: overlay }]);
  const parents = frameParents(
    editor.store,
    editor.currentPageId,
    editor.createShapeContext(),
  );
  expect(parents.has("screen")).toBe(false);
  expect(parents.get("label")).toBe("card");
});
