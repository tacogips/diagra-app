import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { type Document, validateDocument } from "@diagra/ir";
import { hitTestPoint } from "./hit-test.ts";
import { createDefaultRegistry } from "./shapes/index.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

function fixture() {
  return makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        index: "a1",
        semantic: { name: "Screen" },
        visual: { x: 0, y: 0, width: 400, height: 800 },
      }),
      element({
        id: "child",
        type: "node.generic",
        index: "a2",
        semantic: { label: "Button" },
        visual: { x: 50, y: 50, width: 120, height: 50 },
      }),
    ]),
  });
}

test("hidden containers omit descendants from picking and SVG without losing data", () => {
  const editor = fixture();
  editor.apply([
    { type: "updateVisual", id: "frame", visual: { hidden: true } },
  ]);
  expect(editor.createShapeContext().isHidden?.("child")).toBe(true);
  expect(editor.exportPageSvg()).toBeNull();
  expect(
    hitTestPoint(editor.store, createDefaultRegistry(), editor.currentPageId, {
      x: 60,
      y: 60,
    }),
  ).toBeNull();
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.undo();
  expect(editor.exportPageSvg()).toContain("Button");
});

test("showing a container preserves a child's own hidden state", () => {
  const editor = fixture();
  editor.apply([
    { type: "updateVisual", id: "child", visual: { hidden: true } },
  ]);
  editor.apply([
    { type: "updateVisual", id: "frame", visual: { hidden: true } },
  ]);
  editor.apply([
    { type: "updateVisual", id: "frame", visual: { hidden: false } },
  ]);
  expect(editor.exportPageSvg()).toContain("Screen");
  expect(editor.exportPageSvg()).not.toContain("Button");
});

test("locked containers prevent descendant edits and can be unlocked with undo", () => {
  const editor = fixture();
  editor.apply([
    { type: "updateVisual", id: "frame", visual: { locked: true } },
  ]);
  editor.selection.set(["child"]);
  editor.nudgeSelection(20, 20);
  editor.apply([
    { type: "updateSemantic", id: "child", semantic: { label: "Changed" } },
  ]);
  editor.deleteSelection();
  expect(editor.store.get("child")?.visual.x).toBe(50);
  expect(editor.store.get("child")?.semantic).toEqual({ label: "Button" });
  expect(editor.exportPageSvg()).toContain("Button");
  expect(
    hitTestPoint(editor.store, createDefaultRegistry(), editor.currentPageId, {
      x: 60,
      y: 60,
    }),
  ).toBeNull();
  editor.apply([
    { type: "updateVisual", id: "frame", visual: { locked: false } },
  ]);
  editor.nudgeSelection(20, 20);
  expect(editor.store.get("child")?.visual.x).toBe(70);
  editor.undo();
  expect(editor.store.get("child")?.visual.x).toBe(50);
});

test("layer flags reject non-booleans", () => {
  const editor = fixture();
  const doc = editor.getSnapshot();
  const invalid = {
    ...doc,
    elements: doc.elements.map((item) => ({
      ...item,
      visual: { ...item.visual, locked: "yes" },
    })),
  };
  expect(
    validateDocument(invalid as unknown as Document).some(
      (issue) => issue.severity === "error",
    ),
  ).toBe(true);
});
