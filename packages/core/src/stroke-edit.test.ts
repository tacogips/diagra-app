import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { freehandGeometry } from "./shapes/freehand.ts";
import { planStrokePoints, strokePagePoints } from "./stroke-edit.ts";
import { makeEditor } from "./test-helpers.ts";

test("editing a resized stroke rebases points without shifting untouched anchors", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 0, y: 0, pressure: 0.4 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ],
    },
    visual: { x: 100, y: 200, width: 100, height: 50 },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  const points = strokePagePoints(stroke);
  expect(points).toEqual([
    { x: 100, y: 200, pressure: 0.4 },
    { x: 150, y: 250 },
    { x: 200, y: 200 },
  ]);
  const changed = points.map((point, index) =>
    index === 1 ? { ...point, y: 300 } : point,
  );
  editor.apply(planStrokePoints(stroke, changed));
  const updated = editor.store.get(stroke.id);
  if (!updated) throw new Error("missing stroke");
  expect(strokePagePoints(updated)).toEqual(changed);
  expect(editor.getBounds(stroke.id)?.height).toBe(100);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.undo();
  expect(editor.store.get(stroke.id)).toEqual(stroke);
});

test("closed strokes export a closed path and pick the closing edge and filled interior", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      closed: true,
    },
    visual: { style: { fill: "#abcdef" } },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  expect(freehandGeometry(stroke)?.path).toEndWith(" Z");
  expect(editor.exportPageSvg()).toContain('d="M0 0 L100 0 L100 100 Z"');
  expect(editor.hitTest({ x: 70, y: 30 })).toBe(stroke.id);
  expect(editor.hitTest({ x: 50, y: 50 })).toBe(stroke.id);
  expect(editor.hitTest({ x: 20, y: 80 })).toBeNull();
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});

test("invalid anchor edits leave the stroke unchanged", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    },
  });
  expect(planStrokePoints(stroke, [])).toEqual([]);
  expect(
    planStrokePoints(stroke, [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 1 },
    ]),
  ).toEqual([]);
  expect(
    planStrokePoints(
      { ...stroke, visual: { rotation: 45 } },
      strokePagePoints(stroke),
    ),
  ).toEqual([]);
});
