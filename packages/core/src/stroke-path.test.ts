import { expect, test } from "bun:test";
import { assertValidDocument, type FreehandPoint } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  flattenStroke,
  splitStrokeSegment,
  strokePath,
} from "./stroke-path.ts";
import {
  moveStrokeAnchor,
  planStrokePoints,
  strokePagePoints,
} from "./stroke-edit.ts";
import { makeEditor } from "./test-helpers.ts";

const points: FreehandPoint[] = [
  { x: 0, y: 0, controlOut: { x: 0, y: 100 } },
  { x: 100, y: 0, controlIn: { x: 100, y: 100 } },
];

function sample(a: FreehandPoint, b: FreehandPoint, t: number) {
  const c = a.controlOut ?? a;
  const d = b.controlIn ?? b;
  const s = 1 - t;
  return {
    x:
      s ** 3 * a.x + 3 * s ** 2 * t * c.x + 3 * s * t ** 2 * d.x + t ** 3 * b.x,
    y:
      s ** 3 * a.y + 3 * s ** 2 * t * c.y + 3 * s * t ** 2 * d.y + t ** 3 * b.y,
  };
}

test("splitting a cubic preserves sampled geometry on both resulting segments", () => {
  const a = points[0];
  const b = points[1];
  if (!a || !b) throw new Error("missing fixture");
  const split = splitStrokeSegment(points, 0, false, 0.3);
  const left = split?.[0];
  const center = split?.[1];
  const right = split?.[2];
  if (!left || !center || !right) throw new Error("missing split");
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const original = sample(a, b, t);
    const actual =
      t <= 0.3
        ? sample(left, center, t / 0.3)
        : sample(center, right, (t - 0.3) / 0.7);
    expect(actual.x).toBeCloseTo(original.x, 8);
    expect(actual.y).toBeCloseTo(original.y, 8);
  }
  expect(points).toEqual([a, b]);
});

test("closing-segment split updates first incoming control and interpolates pressure", () => {
  const closed: FreehandPoint[] = [
    { x: 0, y: 0, pressure: 0.2, controlIn: { x: -20, y: 40 } },
    { x: 100, y: 0, pressure: 0.8, controlOut: { x: 120, y: 40 } },
  ];
  const split = splitStrokeSegment(closed, 1, true);
  expect(split).toHaveLength(3);
  expect(split?.[2]?.pressure).toBeCloseTo(0.5);
  expect(split?.[0]?.controlIn).toEqual({ x: -10, y: 20 });
  expect(strokePath(split ?? [], true)).toEndWith("Z");
  expect(splitStrokeSegment(closed, 1, false)).toBeNull();
  expect(splitStrokeSegment(closed, 0, false, 0)).toBeNull();
});

test("cubic strokes retain editable controls in JSONL and SVG and pick the curve", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", { semantic: { points } });
  editor.apply([{ type: "createElement", element: stroke }]);
  expect(strokePath(points)).toBe("M0 0 C0 100 100 100 100 0");
  expect(editor.exportPageSvg()).toContain('d="M0 0 C0 100 100 100 100 0"');
  expect(editor.hitTest({ x: 50, y: 75 })).toBe(stroke.id);
  expect(editor.hitTest({ x: 50, y: 0 })).toBeNull();
  expect(flattenStroke(points, false, 0.5).length).toBeGreaterThan(3);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});

test("resized curve anchors and controls rebase together and edits undo", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: { points },
    visual: { x: 10, y: 20, width: 200, height: 200 },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  const mapped = strokePagePoints(stroke);
  expect(mapped[0]?.controlOut).toEqual({ x: 10, y: 220 });
  const first = mapped[0];
  if (!first) throw new Error("missing anchor");
  const moved = moveStrokeAnchor(first, { x: 30, y: 40 });
  expect(moved.controlOut).toEqual({ x: 30, y: 240 });
  const edited = [moved, ...mapped.slice(1)];
  editor.apply(planStrokePoints(stroke, edited));
  const updated = editor.store.get(stroke.id);
  if (!updated) throw new Error("missing stroke");
  expect(strokePagePoints(updated)).toEqual(edited);
  editor.undo();
  expect(editor.store.get(stroke.id)).toEqual(stroke);
});

test("closing cubic segment is explicit and malformed controls are rejected", () => {
  const editor = makeEditor();
  const closed = [
    { x: 0, y: 0, controlIn: { x: -20, y: 20 } },
    { x: 100, y: 0, controlOut: { x: 120, y: 20 } },
  ];
  expect(strokePath(closed, true)).toBe("M0 0 L100 0 C120 20 -20 20 0 0 Z");
  const stroke = editor.buildElement("draw.freehand", {
    semantic: { points: [{ x: 0, y: 0, controlOut: { x: "bad", y: 2 } }] },
  });
  expect(() =>
    assertValidDocument({ ...editor.getSnapshot(), elements: [stroke] }),
  ).toThrow();
});
