import { expect, test } from "bun:test";
import {
  CANVAS_MIN_WIDTH,
  clampPaneWidth,
  paneBounds,
  paneOpenStateForWidth,
  paneWidthFromKey,
  paneWidthFromPointer,
} from "./pane.ts";

const roomy = { containerWidth: 1200, oppositeWidth: 300 };

test("pane sizing stays finite and reserves a useful canvas", () => {
  expect(paneBounds(roomy)).toEqual({ min: 180, max: 480 });
  expect(clampPaneWidth(-20, roomy)).toBe(180);
  expect(clampPaneWidth(Number.POSITIVE_INFINITY, roomy)).toBe(480);
  const constrained = { containerWidth: 760, oppositeWidth: 300 };
  expect(clampPaneWidth(450, constrained)).toBe(180);
  expect(constrained.containerWidth - constrained.oppositeWidth - 180).toBe(
    CANVAS_MIN_WIDTH,
  );
  expect(paneOpenStateForWidth(720)).toEqual({ left: true, right: true });
  expect(paneOpenStateForWidth(600)).toEqual({ left: true, right: false });
  expect(paneOpenStateForWidth(320)).toEqual({ left: false, right: false });
  expect(paneOpenStateForWidth(720, 480, 300)).toEqual({
    left: false,
    right: false,
  });
  expect(
    clampPaneWidth(480, {
      containerWidth: 413,
      oppositeWidth: 34,
      overlaysCanvas: true,
    }),
  ).toBe(379);
});

test("pointer and keyboard directions follow each pane edge", () => {
  expect(paneWidthFromPointer("left", 350, 100, 900)).toBe(250);
  expect(paneWidthFromPointer("right", 650, 100, 900)).toBe(250);
  expect(paneWidthFromKey("left", 240, "ArrowRight", roomy)).toBe(264);
  expect(paneWidthFromKey("right", 240, "ArrowRight", roomy)).toBe(216);
  expect(paneWidthFromKey("left", 240, "Home", roomy)).toBe(180);
  expect(paneWidthFromKey("right", 240, "End", roomy)).toBe(480);
});
