import { expect, test } from "bun:test";
import { makeEditor } from "./test-helpers.ts";
import { layerRows } from "./layer-tree.ts";
import {
  addPageGuide,
  DEFAULT_GUIDE_COLOR,
  pageGuides,
  removePageGuide,
  updatePageGuide,
} from "./page-guides.ts";

test("persistent page guides create, edit, lock and undo as document resources", () => {
  const editor = makeEditor();
  const page = editor.currentPageId;
  expect(addPageGuide(editor, page, "x", 320, "guide-x")).toBe("guide-x");
  expect(pageGuides(editor, page)).toEqual([
    {
      id: "guide-x",
      page,
      axis: "x",
      position: 320,
      color: DEFAULT_GUIDE_COLOR,
      hidden: false,
      locked: false,
    },
  ]);
  expect(
    updatePageGuide(editor, "guide-x", {
      axis: "y",
      position: -48.5,
      color: "#2563eb",
      hidden: true,
      locked: true,
    }),
  ).toBe(true);
  expect(pageGuides(editor, page)[0]).toMatchObject({
    axis: "y",
    position: -48.5,
    color: "#2563eb",
    hidden: true,
    locked: true,
  });
  expect(updatePageGuide(editor, "guide-x", { position: 10 })).toBe(false);
  expect(removePageGuide(editor, "guide-x")).toBe(false);
  expect(updatePageGuide(editor, "guide-x", { locked: false })).toBe(true);
  expect(removePageGuide(editor, "guide-x")).toBe(true);
  expect(pageGuides(editor, page)).toEqual([]);
  expect(editor.undo()).toBe(true);
  expect(pageGuides(editor, page)[0]?.locked).toBe(false);
});

test("guide helpers reject invalid pages, coordinates, colors and ids", () => {
  const editor = makeEditor();
  expect(addPageGuide(editor, "missing", "x", 1)).toBeNull();
  expect(
    addPageGuide(editor, editor.currentPageId, "x", Number.NaN),
  ).toBeNull();
  expect(updatePageGuide(editor, "missing", { position: 1 })).toBe(false);
  const id = addPageGuide(editor, editor.currentPageId, "x", 10, "guide");
  expect(id).toBe("guide");
  expect(
    updatePageGuide(editor, "guide", { position: Number.POSITIVE_INFINITY }),
  ).toBe(false);
  expect(updatePageGuide(editor, "guide", { color: "red" })).toBe(false);
});

test("guides stay out of layers, picking and exported artwork", () => {
  const editor = makeEditor();
  editor.createElement("shape.geo", {
    id: "shape",
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  addPageGuide(editor, editor.currentPageId, "x", 50, "guide");
  expect(layerRows(editor).map((row) => row.element.id)).toEqual(["shape"]);
  expect(editor.getBounds("guide")).toBeNull();
  expect(editor.hitTest({ x: 50, y: 50 })).toBe("shape");
  const svg = editor.exportPageSvg();
  expect(svg).not.toContain("guide");
  expect(svg).not.toContain("#ec4899");
});
