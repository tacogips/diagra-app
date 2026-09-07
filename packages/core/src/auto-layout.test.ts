import { expect, test } from "bun:test";
import type { FrameLayout, FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { frameParents } from "./frame-tree.ts";
import { rotateElement } from "./rotation.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

const layout: FrameLayout = {
  direction: "vertical",
  gap: 10,
  padding: 20,
  sizing: "hug",
  align: "start",
};
function fixture() {
  return makeEditor({
    document: document([
      element({
        id: "screen",
        type: "frame",
        index: "a1",
        semantic: { name: "Screen" },
        visual: { x: 0, y: 0, width: 400, height: 800 },
      }),
      element({
        id: "one",
        type: "node.generic",
        index: "a2",
        semantic: { label: "One" },
        visual: { x: 50, y: 50, width: 100, height: 30 },
      }),
      element({
        id: "two",
        type: "node.generic",
        index: "a3",
        semantic: { label: "Two" },
        visual: { x: 50, y: 150, width: 80, height: 40 },
      }),
    ]),
  });
}
for (const direction of ["horizontal", "vertical"] as const)
  test(`${direction} layout distributes free space and preserves minimum gaps`, () => {
    const editor = fixture();
    const set = (
      justify: NonNullable<FrameLayout["justify"]>,
      sizing: FrameLayout["sizing"] = "fixed",
    ) =>
      editor.apply([
        {
          type: "updateSemantic",
          id: "screen",
          semantic: {
            name: "Screen",
            memberIds: ["one", "two"],
            layout: { ...layout, direction, justify, sizing },
          },
        },
      ]);
    const position = (id: string) =>
      direction === "horizontal"
        ? editor.getBounds(id)?.x
        : editor.getBounds(id)?.y;
    const extent = direction === "horizontal" ? 400 : 800;
    const firstSize = direction === "horizontal" ? 100 : 30;
    const secondSize = direction === "horizontal" ? 80 : 40;
    const free = extent - 40 - firstSize - secondSize - 10;
    set("center");
    expect(position("one")).toBe(20 + free / 2);
    set("end");
    expect(position("one")).toBe(20 + free);
    set("space-between");
    expect(position("one")).toBe(20);
    expect(position("two")).toBe(extent - 20 - secondSize);
    const saved = serializeDocument(editor.getSnapshot());
    expect(parseDocument(saved)).toEqual(editor.getSnapshot());
    set("center", "hug");
    expect(position("one")).toBe(20);
    expect(position("two")).toBe(20 + firstSize + 10);
    editor.undo();
    expect(serializeDocument(editor.getSnapshot())).toBe(saved);
  });

test("space-between handles empty and single-child frames without invalid geometry", () => {
  const editor = fixture();
  for (const memberIds of [[], ["one"]]) {
    editor.apply([
      {
        type: "updateSemantic",
        id: "screen",
        semantic: {
          name: "Screen",
          memberIds,
          layout: {
            ...layout,
            direction: "horizontal",
            sizing: "fixed",
            justify: "space-between",
          },
        },
      },
    ]);
    expect(editor.getBounds("screen")?.width).toBe(400);
  }
  expect(editor.getBounds("one")?.x).toBe(20);
  editor.apply([
    { type: "updateVisual", id: "screen", visual: { width: 600 } },
  ]);
  expect(editor.getBounds("one")?.x).toBe(20);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});

for (const direction of ["horizontal", "vertical"] as const)
  test(`${direction} wrapping forms deterministic lines with an independent cross gap`, () => {
    const editor = fixture();
    editor.apply([
      {
        type: "updateSemantic",
        id: "screen",
        semantic: {
          name: "Screen",
          memberIds: ["one", "two"],
          layout: {
            ...layout,
            direction,
            sizing: "fixed",
            wrap: true,
            crossGap: 7,
          },
        },
      },
      {
        type: "updateVisual",
        id: "screen",
        visual:
          direction === "horizontal"
            ? { width: 170, height: 200 }
            : { width: 240, height: 119 },
      },
    ]);
    expect(editor.getBounds("one")).toMatchObject({ x: 20, y: 20 });
    expect(editor.getBounds("two")).toMatchObject(
      direction === "horizontal" ? { x: 20, y: 57 } : { x: 127, y: 20 },
    );
    const saved = serializeDocument(editor.getSnapshot());
    expect(saved).toContain('"crossGap":7');
    expect(saved).toContain('"wrap":true');
    expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  });

test("wrapping with a hugged cross axis sizes the frame to all lines", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Screen",
        memberIds: ["one", "two"],
        layout: {
          ...layout,
          direction: "horizontal",
          sizing: "fixed",
          heightSizing: "hug",
          wrap: true,
          crossGap: 7,
        },
      },
    },
    { type: "updateVisual", id: "screen", visual: { width: 170 } },
  ]);
  expect(editor.getBounds("screen")?.height).toBe(117);
  expect(editor.getBounds("two")?.y).toBe(57);
});

test("wrapped stretch fills each line rather than the whole frame", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Screen",
        memberIds: ["one", "two"],
        layout: {
          ...layout,
          direction: "horizontal",
          sizing: "fixed",
          wrap: true,
          align: "stretch",
        },
      },
    },
    { type: "updateVisual", id: "screen", visual: { width: 230, height: 300 } },
  ]);
  expect(editor.getBounds("one")?.height).toBe(40);
  expect(editor.getBounds("two")?.height).toBe(40);
  expect(editor.getBounds("one")?.height).not.toBe(260);
});

test("wrapping validates its optional fields", () => {
  const editor = fixture();
  const semantic = {
    name: "Screen",
    memberIds: ["one"],
    layout: { ...layout, wrap: true },
  };
  editor.apply([{ type: "updateSemantic", id: "screen", semantic }]);
  expect(() =>
    editor.apply([
      {
        type: "updateSemantic",
        id: "screen",
        semantic: { ...semantic, layout: { ...semantic.layout, crossGap: -1 } },
      },
    ]),
  ).toThrow();
  expect(() =>
    editor.apply([
      {
        type: "updateSemantic",
        id: "screen",
        semantic: { ...semantic, layout: { ...semantic.layout, wrap: "yes" } },
      },
    ]),
  ).toThrow();
});

test("absolute members stay attached but do not consume auto-layout space", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Screen",
        memberIds: ["one", "two"],
        layout,
      },
    },
    {
      type: "updateVisual",
      id: "two",
      visual: { layoutPosition: "absolute", layoutGrow: 1 },
    },
  ]);
  expect(editor.getBounds("screen")).toMatchObject({ width: 140, height: 70 });
  expect(editor.getBounds("one")).toMatchObject({ x: 20, y: 20 });
  expect(editor.getBounds("two")).toMatchObject({
    x: 50,
    y: 150,
    width: 80,
    height: 40,
  });
  const saved = serializeDocument(editor.getSnapshot());
  expect(saved).toContain('"layoutGrow":1,"layoutPosition":"absolute"');
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(() =>
    editor.apply([
      {
        type: "updateVisual",
        id: "two",
        visual: { layoutPosition: "flow" as "absolute" },
      },
    ]),
  ).toThrow();
});

test("hug and stretch sizing obey authored dimension limits", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: "screen",
      visual: { minWidth: 200, maxHeight: 90 },
    },
    { type: "updateVisual", id: "one", visual: { maxWidth: 150 } },
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Limited card",
        memberIds: ["one", "two"],
        layout,
      },
    },
  ]);
  expect(editor.getBounds("screen")).toMatchObject({ width: 200, height: 90 });

  const semantic = editor.store.get("screen")?.semantic as FrameSemantic;
  editor.apply([
    { type: "updateVisual", id: "screen", visual: { width: 400 } },
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        ...semantic,
        layout: {
          ...semantic.layout,
          sizing: "fixed",
          align: "stretch",
        },
      },
    },
  ]);
  expect(editor.getBounds("one")?.width).toBe(150);
  expect(editor.getBounds("two")?.width).toBe(360);

  expect(() =>
    editor.apply([
      { type: "updateVisual", id: "one", visual: { minWidth: 151 } },
    ]),
  ).toThrow();
  const saved = serializeDocument(editor.getSnapshot());
  expect(saved).toContain('"minWidth":200,"maxHeight":90');
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
});

test("distribution keeps overflowing children start-aligned and rejects invalid modes", () => {
  const editor = fixture();
  editor.apply([
    { type: "updateVisual", id: "screen", visual: { width: 100 } },
  ]);
  const semantic = {
    name: "Screen",
    memberIds: ["one", "two"],
    layout: {
      ...layout,
      direction: "horizontal",
      sizing: "fixed",
      justify: "space-between",
    },
  };
  editor.apply([{ type: "updateSemantic", id: "screen", semantic }]);
  expect(editor.getBounds("one")?.x).toBe(20);
  expect(editor.getBounds("two")?.x).toBe(130);
  expect(() =>
    editor.apply([
      {
        type: "updateSemantic",
        id: "screen",
        semantic: {
          ...semantic,
          layout: { ...semantic.layout, justify: "invalid" },
        },
      },
    ]),
  ).toThrow();
});

for (const direction of ["horizontal", "vertical"] as const)
  test(`${direction} layout respects per-side padding for hug and distribution`, () => {
    const editor = fixture();
    const custom = {
      ...layout,
      direction,
      paddingTop: 5,
      paddingRight: 15,
      paddingBottom: 25,
      paddingLeft: 35,
    };
    editor.apply([
      {
        type: "updateSemantic",
        id: "screen",
        semantic: { name: "Screen", memberIds: ["one", "two"], layout: custom },
      },
    ]);
    expect(editor.getBounds("screen")).toMatchObject(
      direction === "horizontal"
        ? { width: 240, height: 70 }
        : { width: 150, height: 110 },
    );
    expect(editor.getBounds("one")).toMatchObject({ x: 35, y: 5 });
    const saved = serializeDocument(editor.getSnapshot());
    expect(parseDocument(saved)).toEqual(editor.getSnapshot());
    editor.apply([
      {
        type: "updateVisual",
        id: "screen",
        visual: { width: 400, height: 800 },
      },
      {
        type: "updateSemantic",
        id: "screen",
        semantic: {
          name: "Screen",
          memberIds: ["one", "two"],
          layout: {
            ...custom,
            sizing: "fixed",
            justify: "space-between",
            align: "end",
          },
        },
      },
    ]);
    expect(editor.getBounds("two")).toMatchObject({ x: 305, y: 735 });
    editor.undo();
    expect(serializeDocument(editor.getSnapshot())).toBe(saved);
  });

test("padding overrides accept zero and reject negative values", () => {
  const editor = fixture();
  const semantic = {
    name: "Screen",
    memberIds: ["one"],
    layout: { ...layout, paddingLeft: 0 },
  };
  editor.apply([{ type: "updateSemantic", id: "screen", semantic }]);
  expect(editor.getBounds("one")?.x).toBe(0);
  expect(editor.getBounds("screen")?.width).toBe(120);
  for (const side of [
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
  ])
    expect(() =>
      editor.apply([
        {
          type: "updateSemantic",
          id: "screen",
          semantic: { ...semantic, layout: { ...semantic.layout, [side]: -1 } },
        },
      ]),
    ).toThrow();
});

for (const direction of ["horizontal", "vertical"] as const)
  test(`${direction} stretch fills the cross axis with padding and atomic undo`, () => {
    const editor = fixture();
    const before = serializeDocument(editor.getSnapshot());
    editor.apply([
      {
        type: "updateSemantic",
        id: "screen",
        semantic: {
          name: "Screen",
          memberIds: ["one", "two"],
          layout: { ...layout, direction, sizing: "fixed", align: "stretch" },
        },
      },
    ]);
    for (const id of ["one", "two"])
      expect(
        editor.getBounds(id)?.[direction === "horizontal" ? "height" : "width"],
      ).toBe(direction === "horizontal" ? 760 : 360);
    const saved = serializeDocument(editor.getSnapshot());
    expect(parseDocument(saved)).toEqual(editor.getSnapshot());
    editor.undo();
    expect(serializeDocument(editor.getSnapshot())).toBe(before);
  });

test("stretch skips locked children and does not expand a hug-sized parent axis", () => {
  const editor = fixture();
  editor.apply([{ type: "updateVisual", id: "one", visual: { locked: true } }]);
  const semantic = {
    name: "Screen",
    memberIds: ["one", "two"],
    layout: { ...layout, sizing: "fixed", align: "stretch" },
  };
  editor.apply([{ type: "updateSemantic", id: "screen", semantic }]);
  expect(editor.getBounds("one")?.width).toBe(100);
  expect(editor.getBounds("two")?.width).toBe(360);
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        ...semantic,
        layout: { ...semantic.layout, widthSizing: "hug" },
      },
    },
    { type: "updateVisual", id: "two", visual: { width: 80 } },
  ]);
  expect(editor.getBounds("screen")?.width).toBe(140);
  expect(editor.getBounds("two")?.width).toBe(80);
});

test("stretch resizes nested rows before distribution regardless of document order", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "row",
        type: "frame",
        index: "a1",
        semantic: {
          name: "Row",
          memberIds: ["left", "right"],
          layout: {
            ...layout,
            direction: "horizontal",
            sizing: "fixed",
            padding: 10,
            justify: "space-between",
          },
        },
        visual: { x: 0, y: 0, width: 100, height: 100 },
      }),
      element({
        id: "left",
        type: "shape.geo",
        index: "a2",
        semantic: { kind: "rectangle" },
        visual: { x: 0, y: 0, width: 50, height: 30 },
      }),
      element({
        id: "right",
        type: "shape.geo",
        index: "a3",
        semantic: { kind: "rectangle" },
        visual: { x: 0, y: 0, width: 50, height: 30 },
      }),
      element({
        id: "screen",
        type: "frame",
        index: "a0",
        semantic: { name: "Screen", memberIds: ["row"] },
        visual: { x: 0, y: 0, width: 400, height: 800 },
      }),
    ]),
  });
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Screen",
        memberIds: ["row"],
        layout: { ...layout, sizing: "fixed", align: "stretch" },
      },
    },
  ]);
  expect(editor.getBounds("row")).toMatchObject({ x: 20, y: 20, width: 360 });
  expect(editor.getBounds("left")?.x).toBe(30);
  expect(editor.getBounds("right")?.x).toBe(320);
  editor.apply([
    { type: "updateVisual", id: "screen", visual: { width: 600 } },
  ]);
  expect(editor.getBounds("row")?.width).toBe(560);
  expect(editor.getBounds("right")?.x).toBe(520);
  const row = editor.store.get("row")?.semantic as FrameSemantic;
  editor.apply([
    {
      type: "updateSemantic",
      id: "row",
      semantic: { ...row, layout: { ...row.layout, widthSizing: "hug" } },
    },
  ]);
  expect(editor.getBounds("row")?.width).toBe(130);
  expect(editor.getBounds("right")?.x).toBe(90);
});

test("fixed-width cards hug height and reflow when children grow", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Card",
        memberIds: ["one", "two"],
        layout: { ...layout, widthSizing: "fixed", heightSizing: "hug" },
      },
    },
  ]);
  expect(editor.getBounds("screen")).toMatchObject({ width: 400, height: 120 });
  const before = serializeDocument(editor.getSnapshot());
  editor.resizeElement("one", { x: 20, y: 20, width: 100, height: 100 });
  expect(editor.getBounds("screen")).toMatchObject({ width: 400, height: 190 });
  editor.undo();
  expect(serializeDocument(editor.getSnapshot())).toBe(before);
  expect(parseDocument(before)).toEqual(editor.getSnapshot());
});

test("horizontal controls hug width independently of fixed height", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Row",
        memberIds: ["one", "two"],
        layout: {
          ...layout,
          direction: "horizontal",
          sizing: "fixed",
          widthSizing: "hug",
          heightSizing: "fixed",
          align: "center",
        },
      },
    },
  ]);
  expect(editor.getBounds("screen")).toMatchObject({ width: 230, height: 800 });
  expect(editor.getBounds("one")?.y).toBe(385);
  expect(editor.getBounds("two")?.y).toBe(380);
  const current = editor.store.get("screen")?.semantic as FrameSemantic;
  expect(() =>
    editor.apply([
      {
        type: "updateSemantic",
        id: "screen",
        semantic: {
          ...current,
          layout: { ...current.layout, widthSizing: "fill" },
        },
      },
    ]),
  ).toThrow();
});

test("vertical hug layout, child resize reflow, and undo commit atomically", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: { name: "Screen", memberIds: ["one", "two"], layout },
    },
  ]);
  expect(editor.getBounds("screen")).toEqual({
    x: 0,
    y: 0,
    width: 140,
    height: 120,
  });
  expect(editor.getBounds("two")?.y).toBe(60);
  editor.resizeElement("one", { x: 20, y: 20, width: 100, height: 60 });
  expect(editor.getBounds("two")?.y).toBe(90);
  expect(editor.getBounds("screen")?.height).toBe(150);
  editor.undo();
  expect(editor.getBounds("two")?.y).toBe(60);
  editor.undo();
  expect(editor.getBounds("two")?.y).toBe(150);
  expect(editor.getBounds("screen")?.height).toBe(800);
});
test("horizontal fixed layout aligns children and keeps overflowing members attached", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Screen",
        memberIds: ["one", "two"],
        layout: {
          ...layout,
          direction: "horizontal",
          sizing: "fixed",
          align: "center",
          gap: 500,
        },
      },
    },
  ]);
  expect(editor.getBounds("one")?.y).toBe(385);
  expect(editor.getBounds("two")?.x).toBe(620);
  expect(
    frameParents(
      editor.store,
      editor.currentPageId,
      editor.createShapeContext(),
    ).get("two"),
  ).toBe("screen");
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});
test("copy remaps explicit membership and deleting a child repairs the frame", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: { name: "Screen", memberIds: ["one", "two"], layout },
    },
  ]);
  editor.selection.set(["screen"]);
  const ids = editor.duplicateSelection();
  const frame = ids
    .map((id) => editor.store.get(id))
    .find((item) => item?.type === "frame");
  const members = (frame?.semantic as FrameSemantic).memberIds ?? [];
  expect(members).toHaveLength(2);
  expect(members.every((id) => ids.includes(id))).toBe(true);
  editor.deleteElements(["one"]);
  expect(
    (editor.store.get("screen")?.semantic as FrameSemantic).memberIds,
  ).toEqual(["two"]);
  expect(editor.getBounds("two")?.y).toBe(20);
});
test("nested frames lay out inside-out and cycles do not hang", () => {
  const editor = fixture();
  const inner = editor.buildElement("frame", {
    semantic: { name: "Inner", memberIds: ["one"], layout },
    visual: { x: 200, y: 200 },
  });
  editor.apply([
    { type: "createElement", element: inner },
    {
      type: "updateSemantic",
      id: "screen",
      semantic: { name: "Screen", memberIds: [inner.id, "two"], layout },
    },
  ]);
  expect(editor.getBounds(inner.id)?.x).toBe(20);
  expect(editor.getBounds("one")?.x).toBe(40);
  expect(editor.getBounds("two")?.y).toBe(100);
  editor.apply([
    {
      type: "updateSemantic",
      id: inner.id,
      semantic: { name: "Inner", memberIds: ["screen"], layout },
    },
  ]);
  expect(editor.getSnapshot().elements).toHaveLength(4);
});

test("rotated frames continue auto layout in their local axes", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Screen",
        memberIds: ["one", "two"],
        layout: {
          ...layout,
          direction: "horizontal",
          sizing: "fixed",
        },
      },
    },
  ]);
  expect(rotateElement(editor, "screen", 90)).toBe(true);
  expect(editor.store.get("one")?.visual).toMatchObject({
    x: 515,
    y: 255,
    rotation: 90,
  });
  expect(editor.store.get("two")?.visual).toMatchObject({
    x: 520,
    y: 350,
    rotation: 90,
  });

  const semantic = editor.store.get("screen")?.semantic as FrameSemantic;
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        ...semantic,
        layout: { ...semantic.layout, gap: 30 },
      },
    },
  ]);
  expect(editor.store.get("one")?.visual).toMatchObject({ x: 515, y: 255 });
  expect(editor.store.get("two")?.visual).toMatchObject({ x: 520, y: 370 });
  editor.undo();
  expect(editor.store.get("two")?.visual).toMatchObject({ x: 520, y: 350 });

  const restored = editor.store.get("screen")?.semantic as FrameSemantic;
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        ...restored,
        layout: { ...restored.layout, gap: 30, align: "stretch" },
      },
    },
  ]);
  expect(editor.store.get("one")?.visual).toMatchObject({
    x: 150,
    y: -110,
    height: 760,
  });
  expect(editor.store.get("two")?.visual).toMatchObject({
    x: 160,
    y: 10,
    height: 760,
  });
});

test("rotated hug frames reflow around their resized local bounds", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Screen",
        memberIds: ["one", "two"],
        layout: { ...layout, direction: "horizontal" },
      },
    },
  ]);
  expect(rotateElement(editor, "screen", 90)).toBe(true);
  const one = editor.getBounds("one");
  if (!one) throw new Error("missing child bounds");
  editor.resizeElement("one", { ...one, width: 200 });

  expect(editor.getBounds("screen")).toEqual({
    x: 0,
    y: 0,
    width: 330,
    height: 80,
  });
  expect(editor.store.get("one")?.visual).toMatchObject({
    x: 70,
    y: -20,
    width: 200,
    rotation: 90,
  });
  expect(editor.store.get("two")?.visual).toMatchObject({
    x: 125,
    y: 125,
    rotation: 90,
  });
});

test("horizontal fill drives a locked aspect ratio and cross stretch yields", () => {
  const editor = makeEditor();
  const child = editor.buildElement("shape.geo", {
    id: "ratio-child",
    visual: {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      aspectRatio: 2,
      layoutGrow: 1,
    },
  });
  const frame = editor.buildElement("frame", {
    id: "ratio-frame",
    semantic: {
      name: "Ratio row",
      memberIds: [child.id],
      layout: {
        direction: "horizontal",
        gap: 0,
        padding: 20,
        sizing: "fixed",
        align: "stretch",
      },
    },
    visual: { x: 0, y: 0, width: 400, height: 300 },
  });
  editor.apply(
    [child, frame].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(editor.getBounds(child.id)).toEqual({
    x: 20,
    y: 20,
    width: 360,
    height: 180,
  });
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});

test("a locked auto-layout frame derives its cross axis from the main axis", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: "screen",
      visual: { aspectRatio: 2 },
    },
    {
      type: "updateSemantic",
      id: "screen",
      semantic: {
        name: "Screen",
        memberIds: ["one"],
        layout: { ...layout, direction: "horizontal", sizing: "hug" },
      },
    },
  ]);
  expect(editor.getBounds("screen")).toEqual({
    x: 0,
    y: 0,
    width: 140,
    height: 70,
  });
});
