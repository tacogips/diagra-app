import { expect, test } from "bun:test";
import { helpPosition } from "./help-position.ts";

test("help opens below when it fits", () => {
  expect(
    helpPosition(
      { left: 100, top: 50, bottom: 68 },
      { width: 280, height: 60 },
      { width: 800, height: 600 },
    ),
  ).toEqual({ left: 100, top: 74 });
});

test("help flips above a bottom-edge trigger and clamps the right edge", () => {
  expect(
    helpPosition(
      { left: 300, top: 240, bottom: 258 },
      { width: 280, height: 110 },
      { width: 320, height: 280 },
    ),
  ).toEqual({ left: 32, top: 124 });
});

test("long help clamps to the viewport rather than a guessed fixed height", () => {
  expect(
    helpPosition(
      { left: -20, top: 40, bottom: 58 },
      { width: 280, height: 220 },
      { width: 320, height: 240 },
    ),
  ).toEqual({ left: 8, top: 8 });
});

test("oversized measured help keeps its origin reachable", () => {
  expect(
    helpPosition(
      { left: 100, top: 20, bottom: 38 },
      { width: 280, height: 220 },
      { width: 200, height: 100 },
    ),
  ).toEqual({ left: 8, top: 8 });
});
