import { expect, test } from "bun:test";
import { makeEditor } from "./test-helpers.ts";
import { hitTestPoint } from "./hit-test.ts";
import { createDefaultRegistry } from "./shapes/index.ts";
import { Store } from "./store.ts";

function rotatedShape(rotation = 90, geo = "rect") {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo },
    visual: { x: 100, y: 100, width: 200, height: 40, rotation },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  return { editor, shape };
}

test("connector picking ignores rotation metadata, as the canvas renderer does", () => {
  const editor = makeEditor();
  const from = editor.buildElement("node.generic", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const to = editor.buildElement("node.generic", {
    visual: { x: 300, y: 0, width: 100, height: 100 },
  });
  const edge = editor.buildElement("edge.generic", {
    semantic: { from: from.id, to: to.id },
    visual: { rotation: 90 },
  });
  editor.apply(
    [from, to, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(editor.hitTest({ x: 140, y: 50 })).toBe(edge.id);
  expect(editor.hitTest({ x: 200, y: 100 })).toBeNull();
});

test("rotated rectangles pick their drawn area, not the old box", () => {
  for (const angle of [90, -90, 450]) {
    const { editor, shape } = rotatedShape(angle);
    expect(editor.hitTest({ x: 200, y: 40 })).toBe(shape.id);
    expect(editor.hitTest({ x: 120, y: 120 })).toBeNull();
    expect(editor.getBounds(shape.id)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 40,
    });
  }
});

test("rotated ellipses still reject transparent corners", () => {
  const { editor, shape } = rotatedShape(90, "ellipse");
  expect(editor.hitTest({ x: 200, y: 40 })).toBe(shape.id);
  expect(editor.hitTest({ x: 218, y: 30 })).toBeNull();
});

test("ancestor clips are checked before inverse rotation", () => {
  const { editor, shape } = rotatedShape();
  const frame = editor.buildElement("frame", {
    semantic: { name: "Clip", clipContent: true, memberIds: [shape.id] },
    visual: { x: 0, y: 0, width: 400, height: 80 },
  });
  editor.apply([{ type: "createElement", element: frame }]);
  // Exclude the frame itself from picking so only the child's geometry is tested.
  const context = editor.createShapeContext();
  const pick = (point: { x: number; y: number }) =>
    hitTestPoint(
      new Store(editor.getSnapshot()),
      createDefaultRegistry(),
      shape.page,
      point,
      { context: { ...context, isLocked: (id) => id === frame.id } },
    );
  expect(context.clipOf?.(shape.id)?.height).toBe(80);
  expect(pick({ x: 200, y: 40 })).toBe(shape.id);
  expect(pick({ x: 200, y: 190 })).toBeNull();
});

test("rotated freehand picking preserves screen-space stroke tolerance", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    },
    visual: { x: 0, y: 0, width: 100, height: 1, rotation: 90 },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  const store = new Store(editor.getSnapshot());
  const registry = createDefaultRegistry();
  expect(
    hitTestPoint(store, registry, stroke.page, { x: 53, y: 30 }, { zoom: 1 }),
  ).toBe(stroke.id);
  expect(
    hitTestPoint(store, registry, stroke.page, { x: 53, y: 30 }, { zoom: 4 }),
  ).toBeNull();
  expect(
    hitTestPoint(store, registry, stroke.page, { x: 50.5, y: 30 }, { zoom: 4 }),
  ).toBe(stroke.id);
});
