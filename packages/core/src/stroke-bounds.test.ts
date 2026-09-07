import { expect, test } from "bun:test";
import { strokeBounds } from "./stroke-bounds.ts";
import { freehandGeometry } from "./shapes/freehand.ts";
import { element, makeEditor, document } from "./test-helpers.ts";
import {
  planFitStrokeBounds,
  planStrokeClosed,
  strokePagePoints,
  planStrokePoints,
} from "./stroke-edit.ts";
import { parseDocument, serializeDocument } from "@diagra/io";

test("tight frame migration preserves page-space controls and supports edits, undo and persistence", () => {
  const path = element({
    id: "curve",
    type: "draw.freehand",
    semantic: {
      points: [
        { x: 0, y: 0, controlOut: { x: 0, y: 100 } },
        { x: 100, y: 0, controlIn: { x: 100, y: 100 } },
      ],
    },
    visual: { x: 20, y: 30, width: 200, height: 200 },
  });
  const editor = makeEditor({ document: document([path]) });
  const points = strokePagePoints(path);
  const before = serializeDocument(editor.getSnapshot());
  editor.apply(planFitStrokeBounds(path));
  const fitted = editor.store.get(path.id);
  if (!fitted) throw new Error("missing curve");
  expect(strokePagePoints(fitted)).toEqual(points);
  expect(editor.getBounds(path.id)).toEqual({
    x: 20,
    y: 30,
    width: 200,
    height: 150,
  });
  expect(planFitStrokeBounds(fitted)).toEqual([]);
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  const next = points.map((point, index) =>
    index === 1 ? { ...point, x: point.x + 20 } : point,
  );
  editor.apply(planStrokePoints(fitted, next));
  const edited = editor.store.get(path.id);
  if (!edited) throw new Error("missing curve");
  expect(strokePagePoints(edited)).toEqual(next);
  expect(edited.visual.strokeBounds).toBe("curve");
  editor.undo();
  expect(serializeDocument(editor.getSnapshot())).toBe(saved);
  editor.undo();
  expect(serializeDocument(editor.getSnapshot())).toBe(before);
});

test("closing and reopening a tight path preserves page-space controls", () => {
  const path = element({
    id: "curve",
    type: "draw.freehand",
    semantic: {
      points: [
        { x: 0, y: 0, controlIn: { x: 0, y: -100 } },
        { x: 100, y: 0, controlOut: { x: 100, y: -100 } },
      ],
    },
  });
  const editor = makeEditor({ document: document([path]) });
  editor.apply(planFitStrokeBounds(path));
  const points = strokePagePoints(editor.store.get(path.id) ?? path);
  for (const closed of [true, false]) {
    const current = editor.store.get(path.id);
    if (!current) throw new Error("missing curve");
    editor.apply(planStrokeClosed(current, closed));
    expect(strokePagePoints(editor.store.get(path.id) ?? path)).toEqual(points);
    expect(editor.getBounds(path.id)?.height).toBe(closed ? 75 : 1);
  }
});

test("frame fitting rejects rotated paths and respects locked elements", () => {
  const editor = makeEditor();
  const path = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
      ],
    },
    visual: { locked: true },
  });
  editor.apply([{ type: "createElement", element: path }]);
  const before = editor.getSnapshot();
  editor.apply(planFitStrokeBounds(path));
  expect(editor.getSnapshot()).toEqual(before);
  expect(planFitStrokeBounds({ ...path, visual: { rotation: 30 } })).toEqual(
    [],
  );
});

test("cubic bounds find interior extrema rather than control-hull edges", () => {
  const points = [
    { x: 0, y: 0, controlOut: { x: 0, y: 100 } },
    { x: 100, y: 0, controlIn: { x: 100, y: 100 } },
  ];
  expect(strokeBounds(points)).toEqual({ x: 0, y: 0, width: 100, height: 75 });
});

test("unused handles do not affect open curves but closing curves are measured", () => {
  const points = [
    { x: 0, y: 0, controlIn: { x: 0, y: -100 } },
    { x: 100, y: 0, controlOut: { x: 100, y: -100 } },
  ];
  expect(strokeBounds(points)).toEqual({ x: 0, y: 0, width: 100, height: 0 });
  expect(strokeBounds(points, true)).toEqual({
    x: 0,
    y: -75,
    width: 100,
    height: 75,
  });
  expect(strokeBounds([])).toBeNull();
  expect(strokeBounds([{ x: 3, y: 4 }])).toEqual({
    x: 3,
    y: 4,
    width: 0,
    height: 0,
  });
});

test("tight export bounds preserve the stored control mapping and document", () => {
  const path = element({
    id: "curve",
    type: "draw.freehand",
    semantic: {
      points: [
        { x: 0, y: 0, controlOut: { x: 0, y: 100 } },
        { x: 100, y: 0, controlIn: { x: 100, y: 100 } },
      ],
    },
    visual: { x: 20, y: 30, width: 200, height: 200 },
  });
  const geometry = freehandGeometry(path);
  expect(geometry?.box).toEqual({ x: 20, y: 30, width: 200, height: 200 });
  expect(geometry?.curveBounds).toEqual({
    x: 20,
    y: 30,
    width: 200,
    height: 150,
  });
  expect(geometry?.points[0]?.controlOut).toEqual({ x: 0, y: 200 });
  const editor = makeEditor({ document: document([path]) });
  const before = JSON.stringify(editor.getSnapshot());
  expect(editor.exportPageSvg()).toContain('viewBox="4 14 232 182"');
  expect(JSON.stringify(editor.getSnapshot())).toBe(before);
});
