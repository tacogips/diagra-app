import { expect, test } from "bun:test";
import {
  dashPolyline,
  MAX_DASH_SPLIT_STEPS,
  resolvedStrokeDashArray,
  strokeDashCss,
} from "./stroke-dash.ts";

test("custom dash arrays override presets, repeat odd arrays and preserve phase", () => {
  expect(resolvedStrokeDashArray({ dash: "dotted" })).toEqual([1, 4]);
  expect(resolvedStrokeDashArray({ strokeDashArray: [3, 2, 1] })).toEqual([
    3, 2, 1, 3, 2, 1,
  ]);
  expect(strokeDashCss({ strokeDashArray: [8, 3] })).toBe("8 3");
  const fragments = dashPolyline(
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
    [10, 5],
    5,
  );
  expect(fragments).toEqual([
    [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ],
    [
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ],
    [
      { x: 25, y: 0 },
      { x: 30, y: 0 },
    ],
  ]);
});

test("dash fragments continue through vertices and omit zero-length gaps", () => {
  const fragments = dashPolyline(
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
    ],
    [12, 4, 0, 4],
  );
  expect(fragments).toEqual([
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 4 },
    ],
  ]);
});

test("very dense patterns use one bounded solid fallback for Boolean geometry", () => {
  const points = [
    { x: 0, y: 0 },
    { x: MAX_DASH_SPLIT_STEPS + 4, y: 0 },
  ];
  expect(dashPolyline(points, [1, 1])).toEqual([points]);
});
