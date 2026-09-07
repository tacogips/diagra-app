import { expect, test } from "bun:test";
import {
  pressureStrokeContains,
  pressureStrokeOutline,
} from "./pressure-stroke.ts";

test("unpressured paths retain the legacy centerline renderer", () => {
  expect(
    pressureStrokeOutline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
      10,
    ),
  ).toBeNull();
});

test("pressure produces a tapered round-capped outline and matching picking", () => {
  const outline = pressureStrokeOutline(
    [
      { x: 0, y: 0, pressure: 0 },
      { x: 100, y: 0, pressure: 1 },
    ],
    false,
    10,
  );
  expect(outline?.bounds).toEqual({ x: -1, y: -9, width: 110, height: 18 });
  expect(outline?.path).toContain("A9 9");
  if (!outline) throw new Error("expected pressure outline");
  expect(pressureStrokeContains({ x: 0, y: 2 }, outline)).toBe(false);
  expect(pressureStrokeContains({ x: 100, y: 8 }, outline)).toBe(true);
  expect(pressureStrokeContains({ x: 100, y: 10 }, outline)).toBe(false);
});

test("Bezier pressure is subdivided and closed outlines form an even-odd band", () => {
  const curved = pressureStrokeOutline(
    [
      { x: 0, y: 0, pressure: 0.2, controlOut: { x: 0, y: 100 } },
      { x: 100, y: 0, pressure: 0.8, controlIn: { x: 100, y: 100 } },
    ],
    false,
    12,
    0.25,
  );
  expect(curved?.samples.length).toBeGreaterThan(8);
  expect(curved?.bounds.height).toBeGreaterThan(75);

  const closed = pressureStrokeOutline(
    [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 100, y: 0, pressure: 0.5 },
      { x: 50, y: 100, pressure: 0.5 },
    ],
    true,
    10,
  );
  expect(closed?.closed).toBe(true);
  expect(closed?.path.match(/ M/g)).toHaveLength(1);
  if (!closed) throw new Error("expected closed pressure outline");
  expect(pressureStrokeContains({ x: 50, y: 2 }, closed)).toBe(true);
  expect(pressureStrokeContains({ x: 50, y: 40 }, closed)).toBe(false);
});
