import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  addLayoutGrid,
  layoutGridBands,
  MAX_LAYOUT_GRIDS,
  removeLayoutGrid,
  updateLayoutGrid,
} from "./layout-grid.ts";
import { makeEditor } from "./test-helpers.ts";

test("layout grids persist, edit, remove and undo as frame semantics", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", {
    semantic: { name: "Mobile" },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  editor.apply([{ type: "createElement", element: frame }]);
  expect(addLayoutGrid(editor, frame.id, "columns", "columns-1")).toBe(true);
  expect(
    updateLayoutGrid(editor, frame.id, 0, {
      kind: "columns",
      id: "columns-1",
      count: 4,
      gutter: 16,
      margin: 24,
      color: "#ff00ff",
      opacity: 0.15,
    }),
  ).toBe(true);
  expect(
    (editor.store.get(frame.id)?.semantic as FrameSemantic).layoutGrids,
  ).toEqual([
    {
      kind: "columns",
      id: "columns-1",
      count: 4,
      gutter: 16,
      margin: 24,
      color: "#ff00ff",
      opacity: 0.15,
    },
  ]);
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(editor.exportPageSvg()).not.toContain("#ff00ff");

  expect(removeLayoutGrid(editor, frame.id, 0)).toBe(true);
  expect(
    (editor.store.get(frame.id)?.semantic as FrameSemantic).layoutGrids,
  ).toBeUndefined();
  editor.undo();
  expect(
    (editor.store.get(frame.id)?.semantic as FrameSemantic).layoutGrids,
  ).toHaveLength(1);
});

test("layout grid editing rejects invalid, locked and excessive changes", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", { semantic: { name: "Web" } });
  editor.apply([{ type: "createElement", element: frame }]);
  for (let index = 0; index < MAX_LAYOUT_GRIDS; index += 1)
    expect(addLayoutGrid(editor, frame.id, "grid", `grid-${index}`)).toBe(true);
  expect(addLayoutGrid(editor, frame.id, "rows")).toBe(false);
  expect(
    updateLayoutGrid(editor, frame.id, 0, {
      kind: "grid",
      id: "grid-0",
      size: 0,
      color: "#123456",
      opacity: 0.2,
    }),
  ).toBe(false);
  expect(
    updateLayoutGrid(editor, frame.id, 1, {
      id: "grid-0",
      kind: "grid",
      size: 8,
      color: "#123456",
      opacity: 0.2,
    }),
  ).toBe(false);
  editor.apply([
    { type: "updateVisual", id: frame.id, visual: { locked: true } },
  ]);
  expect(removeLayoutGrid(editor, frame.id, 0)).toBe(false);
});

test("column and row bands stretch inside margins and gutters", () => {
  expect(
    layoutGridBands(
      {
        kind: "columns",
        id: "columns",
        count: 4,
        gutter: 10,
        margin: 20,
        color: "#ff0000",
        opacity: 0.1,
      },
      390,
      800,
    ),
  ).toEqual([
    { x: 20, y: 0, width: 80, height: 800 },
    { x: 110, y: 0, width: 80, height: 800 },
    { x: 200, y: 0, width: 80, height: 800 },
    { x: 290, y: 0, width: 80, height: 800 },
  ]);
  expect(
    layoutGridBands(
      {
        kind: "rows",
        id: "rows",
        count: 2,
        gutter: 20,
        margin: 10,
        color: "#0000ff",
        opacity: 0.1,
      },
      100,
      200,
    ),
  ).toEqual([
    { x: 0, y: 10, width: 100, height: 80 },
    { x: 0, y: 110, width: 100, height: 80 },
  ]);
});
