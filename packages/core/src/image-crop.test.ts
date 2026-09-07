import { expect, test } from "bun:test";
import {
  composeImageCrop,
  croppedImageBox,
  cropFromCorners,
} from "./image-crop.ts";

test("composes repeated non-destructive trims in normalized source space", () => {
  const crop = composeImageCrop(
    { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
    { x: 0.25, y: 0.1, width: 0.5, height: 0.75 },
  );
  expect(crop.x).toBeCloseTo(0.3);
  expect(crop.y).toBeCloseTo(0.26);
  expect(crop.width).toBeCloseTo(0.4);
  expect(crop.height).toBeCloseTo(0.45);
});

test("places the uncropped source behind the fixed viewport", () => {
  expect(
    croppedImageBox(
      { x: 0.25, y: 0.1, width: 0.5, height: 0.5 },
      { x: 20, y: 30, width: 200, height: 100 },
    ),
  ).toEqual({ x: -80, y: 10, width: 400, height: 200 });
});

test("creates a clamped crop from canvas corners", () => {
  expect(
    cropFromCorners(
      { x: 25, y: 20 },
      { x: 90, y: 70 },
      { x: 10, y: 10, width: 100, height: 100 },
    ),
  ).toEqual({ x: 0.15, y: 0.1, width: 0.65, height: 0.5 });
});
