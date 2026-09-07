import { expect, test } from "bun:test";
import {
  strokeWorldPoints,
  planFitStrokeWorldBounds,
  planStrokeWorldClosed,
  planStrokeWorldPoints,
} from "./stroke-world.ts";
import { splitStrokeSegment } from "./stroke-path.ts";
import { parseDocument, serializeDocument } from "@diagra/io";
import { StrokeAnchorDrag } from "./stroke-drag.ts";
import { makeEditor } from "./test-helpers.ts";

function fixture() {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 0, y: 0, controlOut: { x: 20, y: -20 } },
        { x: 100, y: 50, controlIn: { x: 80, y: 60 } },
      ],
    },
    visual: {
      x: 100,
      y: 100,
      width: 200,
      height: 80,
      rotation: 37,
      strokeBounds: "curve",
    },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  const drag = new StrokeAnchorDrag(editor, () => {});
  return { editor, stroke, drag };
}

test("numeric rotated point insertion and removal preserve requested world coordinates", () => {
  const { editor, stroke, drag } = fixture();
  const before = editor.getSnapshot();
  const points = strokeWorldPoints(stroke);
  const split = splitStrokeSegment(points, 0, false);
  if (!split) throw new Error("expected split");
  editor.apply(planStrokeWorldPoints(stroke, split));
  const current = () => {
    const value = editor.store.get(stroke.id);
    if (!value) throw new Error("missing stroke");
    return value;
  };
  const actual = strokeWorldPoints(current());
  expect(actual).toHaveLength(3);
  for (const [index, point] of split.entries()) {
    expect(actual[index]?.x).toBeCloseTo(point.x);
    expect(actual[index]?.y).toBeCloseTo(point.y);
    if (point.controlOut) {
      expect(actual[index]?.controlOut?.x).toBeCloseTo(point.controlOut.x);
      expect(actual[index]?.controlOut?.y).toBeCloseTo(point.controlOut.y);
    }
  }
  const remaining = actual.filter((_, index) => index !== 1);
  editor.apply(planStrokeWorldPoints(current(), remaining));
  const removed = strokeWorldPoints(current());
  expect(removed).toHaveLength(2);
  expect(removed[0]?.x).toBeCloseTo(points[0]?.x ?? 0);
  expect(removed[1]?.y).toBeCloseTo(points[1]?.y ?? 0);
  expect(current().visual.rotation).toBe(37);
  editor.undo();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  drag.dispose();
});

test("fitting and closing a rotated legacy path preserve world anchors and controls", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        {
          x: 0,
          y: 0,
          controlOut: { x: 0, y: 100 },
          controlIn: { x: 0, y: -100 },
        },
        {
          x: 100,
          y: 0,
          controlIn: { x: 100, y: 100 },
          controlOut: { x: 100, y: -100 },
        },
      ],
    },
    visual: { x: 50, y: 60, width: 200, height: 200, rotation: -45 },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  const before = editor.getSnapshot();
  const original = strokeWorldPoints(stroke);
  const current = () => {
    const value = editor.store.get(stroke.id);
    if (!value) throw new Error("missing stroke");
    return value;
  };
  const unchanged = () => {
    const points = strokeWorldPoints(current());
    for (let i = 0; i < original.length; i++) {
      const a = original[i];
      const b = points[i];
      if (!a || !b) throw new Error("missing point");
      for (const [left, right] of [
        [a, b],
        [a.controlIn, b.controlIn],
        [a.controlOut, b.controlOut],
      ]) {
        expect(right?.x).toBeCloseTo(left?.x ?? 0);
        expect(right?.y).toBeCloseTo(left?.y ?? 0);
      }
    }
  };
  editor.apply(planFitStrokeWorldBounds(current()));
  expect(current().visual.strokeBounds).toBe("curve");
  unchanged();
  expect(planFitStrokeWorldBounds(current())).toEqual([]);
  editor.apply(planStrokeWorldClosed(current(), true));
  unchanged();
  const saved = editor.getSnapshot();
  const reopened = parseDocument(serializeDocument(saved));
  expect(serializeDocument(reopened)).toBe(serializeDocument(saved));
  const reopenedStroke = reopened.elements[0];
  if (!reopenedStroke) throw new Error("missing saved stroke");
  const reopenedPoints = strokeWorldPoints(reopenedStroke);
  // JSONL intentionally rounds coordinates to two decimal places.
  for (const [i, point] of original.entries()) {
    expect(Math.abs((reopenedPoints[i]?.x ?? 0) - point.x)).toBeLessThan(0.02);
    expect(Math.abs((reopenedPoints[i]?.y ?? 0) - point.y)).toBeLessThan(0.02);
  }
  editor.apply(planStrokeWorldClosed(current(), false));
  unchanged();
  editor.undo();
  editor.undo();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("rotated anchor dragging preserves other world coordinates and undo", () => {
  const { editor, stroke, drag } = fixture();
  const before = editor.getSnapshot();
  const points = strokeWorldPoints(stroke);
  const untouched = points[1];
  if (!untouched) throw new Error("missing anchor");
  expect(drag.start(1, stroke.id, 0)).toBe(true);
  drag.finish(1, { x: 50, y: 75 });
  const changed = editor.store.get(stroke.id);
  if (!changed) throw new Error("missing stroke");
  const after = strokeWorldPoints(changed);
  expect(after[0]?.x).toBeCloseTo(50);
  expect(after[0]?.y).toBeCloseTo(75);
  expect(after[1]?.x).toBeCloseTo(untouched.x);
  expect(after[1]?.y).toBeCloseTo(untouched.y);
  expect(after[1]?.controlIn?.x).toBeCloseTo(untouched.controlIn?.x ?? 0);
  expect(changed.visual.rotation).toBe(37);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  drag.dispose();
});

test("rotated control dragging changes only the requested world-space control", () => {
  const { editor, stroke, drag } = fixture();
  const original = strokeWorldPoints(stroke);
  expect(drag.start(3, stroke.id, 0, "controlOut")).toBe(true);
  drag.finish(3, { x: 400, y: 0 });
  const changed = editor.store.get(stroke.id);
  if (!changed) throw new Error("missing stroke");
  const points = strokeWorldPoints(changed);
  expect(points[0]?.controlOut?.x).toBeCloseTo(400);
  expect(points[0]?.controlOut?.y).toBeCloseTo(0);
  for (const index of [0, 1]) {
    expect(points[index]?.x).toBeCloseTo(original[index]?.x ?? 0);
    expect(points[index]?.y).toBeCloseTo(original[index]?.y ?? 0);
  }
  drag.dispose();
});
