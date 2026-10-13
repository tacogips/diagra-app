import { expect, test } from "bun:test";
import type { Box } from "./geometry.ts";
import { makeEditor } from "./test-helpers.ts";
import type { Editor } from "./editor.ts";

function table(editor: Editor, id: string, x: number, y: number): void {
  editor.createElement("erd.table", {
    id,
    semantic: {
      tableName: id,
      columns: [
        { id: "id", name: "id", dataType: "uuid", pk: true },
        { id: "ref", name: "ref_id", dataType: "uuid" },
      ],
    },
    visual: { x, y, width: 200 },
  });
}

function relate(
  editor: Editor,
  id: string,
  child: string,
  parent: string,
): void {
  editor.createElement("erd.relation", {
    id,
    semantic: {
      from: { table: child, column: "ref" },
      to: { table: parent, column: "id" },
      cardinality: "*:1",
      logical: true,
    },
  });
}

function boxes(editor: Editor, ids: readonly string[]): Box[] {
  const context = editor.createShapeContext();
  return ids.map((id) => context.boundsOf(id) as Box);
}

function anyOverlap(list: readonly Box[]): boolean {
  return list.some((a, i) =>
    list.some(
      (b, j) =>
        i < j &&
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height,
    ),
  );
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

test("tidy layout untangles stacked tables and orders them by reference", () => {
  const editor = makeEditor();
  for (const id of ["orders", "users", "items", "notes"])
    table(editor, id, 0, 0);
  relate(editor, "r1", "orders", "users");
  relate(editor, "r2", "items", "orders");
  expect(anyOverlap(boxes(editor, ["orders", "users", "items", "notes"]))).toBe(
    true,
  );

  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(true);
  const [orders, users, items, notes] = boxes(editor, [
    "orders",
    "users",
    "items",
    "notes",
  ]) as [Box, Box, Box, Box];
  expect(anyOverlap([orders, users, items, notes])).toBe(false);
  expect(users.x).toBeLessThan(orders.x);
  expect(orders.x).toBeLessThan(items.x);
  // Stays anchored where the content was.
  expect(Math.min(orders.x, users.x, items.x, notes.x)).toBe(0);
  expect(Math.min(orders.y, users.y, items.y, notes.y)).toBe(0);

  // Tidy is a fixed point: a second run moves nothing.
  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(false);

  // One undo step restores the pile.
  editor.undo();
  expect(boxes(editor, ["orders", "users"]).map((box) => box.x)).toEqual([
    0, 0,
  ]);
});

test("tidy layout arranges frame contents and fits the frame around them", () => {
  const editor = makeEditor();
  editor.createElement("frame", {
    id: "domain",
    semantic: { name: "Domain" },
    visual: { x: 1000, y: 1000, width: 900, height: 900 },
  });
  table(editor, "a", 1100, 1100);
  table(editor, "b", 1120, 1120);
  table(editor, "outside", 1050, 1050);
  // "outside" was created after the frame and lies inside it, so move it out
  // to make it a page-level sibling of the frame that overlaps it.
  editor.apply([
    { type: "updateVisual", id: "outside", visual: { x: 980, y: 980 } },
  ]);
  relate(editor, "r", "b", "a");

  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(true);
  const [frame, a, b, outside] = boxes(editor, [
    "domain",
    "a",
    "b",
    "outside",
  ]) as [Box, Box, Box, Box];
  expect(contains(frame, a)).toBe(true);
  expect(contains(frame, b)).toBe(true);
  expect(a.x).toBeLessThan(b.x);
  expect(anyOverlap([frame, outside])).toBe(false);
  // Fitted, not left at the authored 900 x 900.
  expect(frame.width).toBeLessThan(900);
  expect(frame.height).toBeLessThan(900);
});

test("remove overlaps keeps locked layers and non-overlapping layers in place", () => {
  const editor = makeEditor();
  table(editor, "locked", 0, 0);
  table(editor, "loose", 20, 20);
  table(editor, "far", 2000, 2000);
  editor.apply([
    { type: "updateVisual", id: "locked", visual: { locked: true } },
  ]);
  expect(editor.arrangeLayout({ mode: "overlaps" })).toBe(true);
  const [locked, loose, far] = boxes(editor, ["locked", "loose", "far"]) as [
    Box,
    Box,
    Box,
  ];
  expect([locked.x, locked.y]).toEqual([0, 0]);
  expect([far.x, far.y]).toEqual([2000, 2000]);
  expect(anyOverlap([locked, loose])).toBe(false);
  expect(editor.arrangeLayout({ mode: "overlaps" })).toBe(false);
});

test("a multi-layer selection limits arranging to the selected layers", () => {
  const editor = makeEditor();
  table(editor, "x", 0, 0);
  table(editor, "y", 10, 10);
  table(editor, "z", 15, 15);
  editor.selection.set(["x", "y"]);
  editor.arrangeLayout({ mode: "overlaps" });
  const [x, y, z] = boxes(editor, ["x", "y", "z"]) as [Box, Box, Box];
  expect(anyOverlap([x, y])).toBe(false);
  expect([z.x, z.y]).toEqual([15, 15]);
});

test("refitting a frame leaves an already placed child where it is", () => {
  const editor = makeEditor();
  editor.createElement("frame", {
    id: "frame",
    semantic: { name: "Frame" },
    visual: { x: 100, y: 100, width: 400, height: 300 },
  });
  editor.createElement("node.generic", {
    id: "node",
    semantic: { label: "n" },
    visual: { x: 150, y: 160, width: 50, height: 50 },
  });
  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(true);
  const [frame, node] = boxes(editor, ["frame", "node"]) as [Box, Box];
  expect([node.x, node.y]).toEqual([150, 160]);
  expect(contains(frame, node)).toBe(true);
  // Fixed point: the refit must not drift the frame and child every run.
  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(false);
});

test("a frame holding a locked layer stays put and keeps that layer inside", () => {
  const editor = makeEditor();
  editor.createElement("frame", {
    id: "frame",
    semantic: { name: "Frame" },
    visual: { x: 100, y: 100, width: 400, height: 300 },
  });
  editor.createElement("node.generic", {
    id: "pinned",
    semantic: { label: "p" },
    visual: { x: 150, y: 160, width: 50, height: 50, locked: true },
  });
  table(editor, "loose", 0, 0);
  editor.arrangeLayout({ mode: "tidy" });
  const [frame, pinned, loose] = boxes(editor, [
    "frame",
    "pinned",
    "loose",
  ]) as [Box, Box, Box];
  expect([pinned.x, pinned.y]).toEqual([150, 160]);
  expect(contains(frame, pinned)).toBe(true);
  expect(anyOverlap([frame, loose])).toBe(false);
});

test("tidy positions layers whose coordinates were omitted", () => {
  const editor = makeEditor();
  for (const id of ["a", "b"])
    editor.createElement("erd.table", {
      id,
      semantic: {
        tableName: id,
        columns: [{ id: "id", name: "id", dataType: "uuid", pk: true }],
      },
      visual: { width: 200 },
    });
  editor.apply([
    { type: "replaceVisual", id: "a", visual: { width: 200 } },
    { type: "replaceVisual", id: "b", visual: { width: 200 } },
  ]);
  expect(anyOverlap(boxes(editor, ["a", "b"]))).toBe(true);
  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(true);
  expect(anyOverlap(boxes(editor, ["a", "b"]))).toBe(false);
  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(false);
});

test("content of a grouped frame moves with the frame", () => {
  const editor = makeEditor();
  editor.createElement("frame", {
    id: "frame",
    semantic: { name: "Frame" },
    visual: { x: 1000, y: 1000, width: 300, height: 300 },
  });
  editor.createElement("node.generic", {
    id: "child",
    semantic: { label: "c" },
    visual: { x: 1050, y: 1060, width: 50, height: 50 },
  });
  editor.createElement("node.generic", {
    id: "label",
    semantic: { label: "l" },
    visual: { x: 1000, y: 1320, width: 80, height: 30 },
  });
  editor.selection.set(["frame", "label"]);
  expect(editor.groupSelection()).not.toBeNull();
  editor.selection.set([]);
  table(editor, "other", 0, 0);

  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(true);
  const [frame, child] = boxes(editor, ["frame", "child"]) as [Box, Box];
  expect(contains(frame, child)).toBe(true);
  expect([child.x - frame.x, child.y - frame.y]).toEqual([50, 60]);
  expect(editor.arrangeLayout({ mode: "tidy" })).toBe(false);
});
