import { expect, test } from "bun:test";
import {
  advancePrototypeScroll,
  prototypeDragDelta,
  prototypeKeyboardDelta,
  prototypeScrollRange,
} from "./prototype-scroll.ts";

test("prototype scroll range covers only content beyond the viewport", () => {
  const viewport = { x: 100, y: 50, width: 390, height: 844 };
  expect(
    prototypeScrollRange(viewport, [
      { x: 120, y: 80, width: 40, height: 40 },
      { x: 450, y: 1000, width: 140, height: 100 },
    ]),
  ).toEqual({ x: 100, y: 206 });
  expect(prototypeScrollRange(viewport, [])).toEqual({ x: 0, y: 0 });
});

test("scroll deltas respect enabled axes and clamp both boundaries", () => {
  const range = { x: 100, y: 200 };
  expect(
    advancePrototypeScroll(
      "vertical",
      { x: 0, y: 20 },
      { x: 40, y: 300 },
      range,
    ),
  ).toEqual({ x: 0, y: 200 });
  expect(
    advancePrototypeScroll("both", { x: 80, y: 20 }, { x: 40, y: -50 }, range),
  ).toEqual({ x: 100, y: 0 });
  expect(
    advancePrototypeScroll("none", { x: 4, y: 5 }, { x: 20, y: 20 }, range),
  ).toEqual({ x: 4, y: 5 });
});

test("a vertical mouse wheel drives a horizontal-only prototype", () => {
  expect(
    advancePrototypeScroll(
      "horizontal",
      { x: 10, y: 0 },
      { x: 0, y: 30 },
      { x: 100, y: 0 },
    ),
  ).toEqual({ x: 40, y: 0 });
});

test("pointer drags invert direction and account for preview scale", () => {
  expect(
    prototypeDragDelta({ x: 100, y: 200 }, { x: 60, y: 140 }, 0.5),
  ).toEqual({ x: 80, y: 120 });
  expect(prototypeDragDelta({ x: 10, y: 10 }, { x: 20, y: 30 }, 0)).toEqual({
    x: -10,
    y: -20,
  });
});

test("keyboard scrolling uses steps, viewport pages and absolute ends", () => {
  const viewport = { width: 390, height: 844 };
  expect(prototypeKeyboardDelta("ArrowDown", viewport)).toEqual({
    x: 0,
    y: 40,
  });
  expect(prototypeKeyboardDelta("PageDown", viewport)).toEqual({
    x: 312,
    y: 675.2,
  });
  expect(prototypeKeyboardDelta("End", viewport)).toEqual({
    x: Number.POSITIVE_INFINITY,
    y: Number.POSITIVE_INFINITY,
  });
  expect(prototypeKeyboardDelta("Enter", viewport)).toBeUndefined();
});
