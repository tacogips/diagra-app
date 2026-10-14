import { expect, test } from "bun:test";
import type { Element, FreehandSemantic, Visual } from "@nodetto/ir";
import { makeEditor } from "./test-helpers.ts";
import { freehandGeometry, freehandShapeUtil } from "./shapes/freehand.ts";

function stroke() {
  return makeEditor().buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 10, y: 20, pressure: 0.2, controlOut: { x: 30, y: 90 } },
        { x: 90, y: 30, pressure: 0.8, controlIn: { x: 70, y: 80 } },
      ],
    },
    visual: { x: 50, y: 60, width: 200, height: 100 },
  });
}

// A new point array bypasses the cache, providing a freshly derived reference.
function fresh(element: Element) {
  const semantic = element.semantic as FreehandSemantic;
  return freehandGeometry({
    ...element,
    semantic: {
      ...semantic,
      points: structuredClone(semantic.points),
    },
  });
}

test("translation and rotation reuse local stroke geometry while world bounds follow", () => {
  const original = stroke();
  const before = freehandGeometry(original)!;
  const moved = {
    ...original,
    visual: { ...original.visual, x: -75, y: 200, rotation: 45 },
  };
  const after = freehandGeometry(moved)!;
  expect(after).toEqual(fresh(moved)!);
  expect(after.points).toBe(before.points);
  expect(after.pressureOutline).toBe(before.pressureOutline);
  expect(after.box).toEqual({ x: -75, y: 200, width: 200, height: 100 });
  expect(freehandGeometry(original)).toEqual(before);
});

for (const visual of [
  { width: 300 },
  { height: 150 },
  { strokeBounds: "curve" },
  { style: { strokeWidth: 12 } },
  { style: { dash: "dashed" } },
  { style: { strokeDashArray: [2, 3] } },
] satisfies Partial<Visual>[]) {
  test(`geometry invalidates on ${JSON.stringify(visual)} and restores on undo`, () => {
    const original = stroke();
    const before = freehandGeometry(original)!;
    const changed = { ...original, visual: { ...original.visual, ...visual } };
    const after = freehandGeometry(changed)!;
    expect(after).toEqual(fresh(changed)!);
    expect(after.points).not.toBe(before.points);
    expect(freehandGeometry(original)).toEqual(before);
  });
}

test("closed curves and edited pressure/control points invalidate geometry", () => {
  const original = stroke();
  const before = freehandGeometry(original)!;
  const semantic = original.semantic as FreehandSemantic;
  for (const next of [
    { ...semantic, closed: true },
    {
      ...semantic,
      points: semantic.points.map((point, i) =>
        i ? point : { ...point, pressure: 1, controlOut: { x: 40, y: 120 } },
      ),
    },
  ]) {
    const changed = { ...original, semantic: next };
    expect(freehandGeometry(changed)).toEqual(fresh(changed));
    expect(freehandGeometry(changed)).not.toEqual(before);
  }
});

test("bounds match rendered geometry for inferred, explicit, tight and empty strokes", () => {
  const original = stroke();
  for (const visual of [
    {},
    original.visual,
    { strokeBounds: "curve" as const },
  ]) {
    const element = { ...original, visual };
    expect(
      freehandShapeUtil.getBounds(element, makeEditor().createShapeContext()),
    ).toEqual(freehandGeometry(element)?.box ?? null);
  }
  const empty = { ...original, semantic: { points: [] } };
  expect(freehandGeometry(empty)).toBeNull();
  expect(
    freehandShapeUtil.getBounds(empty, makeEditor().createShapeContext()),
  ).toBeNull();
});
