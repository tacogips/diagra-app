import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { document, element, makeEditor } from "./test-helpers.ts";
import { rotateElement } from "./rotation.ts";

function fixture(direction: "horizontal" | "vertical" = "horizontal") {
  const editor = makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        index: "a0",
        semantic: {
          name: "Row",
          memberIds: ["a", "b"],
          layout: {
            direction,
            sizing: "fixed",
            gap: 10,
            padding: 20,
            align: "start",
          },
        },
        visual: { x: 0, y: 0, width: 400, height: 400 },
      }),
      element({
        id: "a",
        type: "shape.geo",
        index: "a1",
        semantic: { geo: "rect" },
        visual: { x: 0, y: 0, width: 100, height: 100 },
      }),
      element({
        id: "b",
        type: "shape.geo",
        index: "a2",
        semantic: { geo: "rect" },
        visual: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]),
  });
  return editor;
}

for (const direction of ["horizontal", "vertical"] as const)
  test(`${direction} fill shares remaining space proportionally and persists atomically`, () => {
    const editor = fixture(direction);
    const before = serializeDocument(editor.getSnapshot());
    editor.apply([
      { type: "updateVisual", id: "a", visual: { layoutGrow: 1 } },
      { type: "updateVisual", id: "b", visual: { layoutGrow: 2 } },
    ]);
    const axis = direction === "horizontal" ? "width" : "height";
    expect(editor.getBounds("a")?.[axis]).toBeCloseTo(350 / 3);
    expect(editor.getBounds("b")?.[axis]).toBeCloseTo(700 / 3);
    const saved = serializeDocument(editor.getSnapshot());
    expect(serializeDocument(parseDocument(saved))).toBe(saved);
    editor.undo();
    expect(serializeDocument(editor.getSnapshot())).toBe(before);
    editor.redo();
    editor.apply([
      { type: "updateVisual", id: "frame", visual: { [axis]: 700 } },
    ]);
    expect(editor.getBounds("a")?.[axis]).toBeCloseTo(650 / 3);
  });

test("fill reserves fixed and locked siblings and clamps overflow to positive sizes", () => {
  const editor = fixture();
  editor.apply([{ type: "updateVisual", id: "b", visual: { layoutGrow: 1 } }]);
  expect(editor.getBounds("b")?.width).toBe(250);
  editor.apply([
    { type: "updateVisual", id: "a", visual: { locked: true, layoutGrow: 2 } },
  ]);
  expect(editor.getBounds("a")?.width).toBe(100);
  expect(editor.getBounds("b")?.width).toBe(250);
  editor.apply([{ type: "updateVisual", id: "frame", visual: { width: 50 } }]);
  expect(editor.getBounds("b")?.width).toBe(1);
  expect(() =>
    editor.apply([
      { type: "updateVisual", id: "b", visual: { layoutGrow: -1 } },
    ]),
  ).toThrow();
});

test("extreme finite weights retain a one-pixel minimum without overflowing allocation", () => {
  const editor = fixture();
  editor.apply([
    { type: "updateVisual", id: "a", visual: { layoutGrow: Number.MIN_VALUE } },
    { type: "updateVisual", id: "b", visual: { layoutGrow: Number.MAX_VALUE } },
  ]);
  expect(editor.getBounds("a")?.width).toBe(1);
  expect(editor.getBounds("b")?.width).toBe(349);
});

test("fill redistributes around minimum and maximum child sizes", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: "a",
      visual: { layoutGrow: 1, maxWidth: 100 },
    },
    { type: "updateVisual", id: "b", visual: { layoutGrow: 1 } },
  ]);
  expect(editor.getBounds("a")?.width).toBe(100);
  expect(editor.getBounds("b")?.width).toBe(250);

  editor.apply([
    { type: "updateVisual", id: "frame", visual: { width: 250 } },
    { type: "updateVisual", id: "b", visual: { minWidth: 300 } },
  ]);
  expect(editor.getBounds("a")?.width).toBe(1);
  expect(editor.getBounds("b")?.width).toBe(300);
});

test("wrapped fill uses minimum sizes for stable line membership", () => {
  const editor = fixture();
  const frame = editor.store.get("frame");
  editor.apply([
    {
      type: "updateSemantic",
      id: "frame",
      semantic: {
        ...(frame?.semantic as object),
        layout: {
          ...(frame?.semantic as { layout: object }).layout,
          wrap: true,
        },
      },
    },
    { type: "updateVisual", id: "frame", visual: { width: 220 } },
    {
      type: "updateVisual",
      id: "a",
      visual: { layoutGrow: 1, minWidth: 100 },
    },
    {
      type: "updateVisual",
      id: "b",
      visual: { layoutGrow: 1, minWidth: 100 },
    },
  ]);
  expect(editor.getBounds("a")).toMatchObject({ x: 20, y: 20, width: 180 });
  expect(editor.getBounds("b")).toMatchObject({ x: 20, y: 130, width: 180 });
});

for (const direction of ["horizontal", "vertical"] as const)
  test(`${direction} wrapped fill allocates remaining space independently per line`, () => {
    const horizontal = direction === "horizontal";
    const visual = (main: number, cross: number, layoutGrow?: number) => ({
      x: 0,
      y: 0,
      width: horizontal ? main : cross,
      height: horizontal ? cross : main,
      ...(layoutGrow ? { layoutGrow } : {}),
    });
    const editor = makeEditor({
      document: document([
        element({
          id: "frame",
          type: "frame",
          index: "a0",
          semantic: {
            name: "Wrapped fill",
            memberIds: ["fixed-a", "fill-a", "fixed-b", "fill-b"],
            layout: {
              direction,
              sizing: "fixed",
              gap: 10,
              crossGap: 5,
              wrap: true,
              padding: 10,
              align: "start",
            },
          },
          visual: { x: 0, y: 0, width: 200, height: 200 },
        }),
        element({
          id: "fixed-a",
          type: "shape.geo",
          index: "a1",
          semantic: { geo: "rect" },
          visual: visual(120, 20),
        }),
        element({
          id: "fill-a",
          type: "shape.geo",
          index: "a2",
          semantic: { geo: "rect" },
          visual: visual(40, 20),
        }),
        element({
          id: "fixed-b",
          type: "shape.geo",
          index: "a3",
          semantic: { geo: "rect" },
          visual: visual(80, 30),
        }),
        element({
          id: "fill-b",
          type: "shape.geo",
          index: "a4",
          semantic: { geo: "rect" },
          visual: visual(40, 30),
        }),
      ]),
    });
    editor.apply([
      { type: "updateVisual", id: "fill-a", visual: { layoutGrow: 1 } },
      { type: "updateVisual", id: "fill-b", visual: { layoutGrow: 2 } },
    ]);
    const axis = horizontal ? "width" : "height";
    expect(editor.getBounds("fill-a")?.[axis]).toBe(50);
    expect(editor.getBounds("fill-b")?.[axis]).toBe(90);
    expect(editor.getBounds("fixed-b")).toMatchObject(
      horizontal ? { x: 10, y: 35 } : { x: 35, y: 10 },
    );
    expect(editor.getBounds("fill-b")).toMatchObject(
      horizontal ? { x: 100, y: 35 } : { x: 35, y: 100 },
    );
    editor.apply([
      {
        type: "updateVisual",
        id: "frame",
        visual: { [axis]: 250 },
      },
    ]);
    expect(editor.getBounds("fill-a")?.[axis]).toBe(10);
    expect(editor.getBounds("fill-b")?.[axis]).toBe(230);
    editor.undo();
    expect(editor.getBounds("fill-a")?.[axis]).toBe(50);
    expect(editor.getBounds("fill-b")?.[axis]).toBe(90);
  });

test("filled nested rows reflow their children after allocation", () => {
  const editor = fixture();
  const label = editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 50, height: 30 },
  });
  const row = editor.buildElement("frame", {
    semantic: {
      name: "Nested",
      memberIds: [label.id],
      layout: {
        direction: "horizontal",
        sizing: "fixed",
        gap: 0,
        padding: 0,
        align: "start",
        justify: "end",
      },
    },
    visual: { x: 0, y: 0, width: 100, height: 50, layoutGrow: 1 },
  });
  const parent = editor.store.get("frame");
  editor.apply([
    { type: "createElement", element: row },
    { type: "createElement", element: label },
    {
      type: "updateSemantic",
      id: "frame",
      semantic: { ...(parent?.semantic as object), memberIds: [row.id, "b"] },
    },
  ]);
  expect(editor.getBounds(row.id)?.width).toBe(250);
  expect(editor.getBounds(label.id)?.x).toBe(220);
  editor.apply([{ type: "updateVisual", id: "frame", visual: { width: 600 } }]);
  expect(editor.getBounds(row.id)?.width).toBe(450);
  expect(editor.getBounds(label.id)?.x).toBe(420);
});

test("rotated layout children remain eligible for local-axis fill", () => {
  const editor = fixture();
  expect(rotateElement(editor, "frame", 90)).toBe(true);
  editor.apply([
    { type: "updateVisual", id: "a", visual: { layoutGrow: 1 } },
    { type: "updateVisual", id: "b", visual: { layoutGrow: 1 } },
  ]);
  expect(editor.getBounds("a")?.width).toBe(175);
  expect(editor.getBounds("b")?.width).toBe(175);
  expect(editor.store.get("a")?.visual.rotation).toBe(90);
  expect(editor.store.get("b")?.visual.rotation).toBe(90);
});
