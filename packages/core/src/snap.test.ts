import { describe, expect, test } from "bun:test";
import { snapResize, snapTranslate } from "./snap.ts";

const NEIGHBOUR = { x: 100, y: 100, width: 200, height: 100 };

describe("snapTranslate", () => {
  test("pulls a near edge flush with a neighbour's edge", () => {
    const moving = { x: 305, y: 400, width: 50, height: 50 };
    const result = snapTranslate(moving, [NEIGHBOUR], { threshold: 8 });
    expect(result.dx).toBe(-5);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([{ axis: "x", at: 300, from: 100, to: 450 }]);
  });

  test("snaps centres when they are the closest match", () => {
    // Moving centre x = 203; neighbour centre x = 200.
    const moving = { x: 178, y: 400, width: 50, height: 50 };
    const result = snapTranslate(moving, [NEIGHBOUR], { threshold: 8 });
    expect(result.dx).toBe(-3);
  });

  test("prefers an edge over a centre on an exact tie", () => {
    // Left edge is 4 away from the neighbour's left; centre is 4 away from
    // the neighbour's centre if the box is 200 wide.
    const moving = { x: 104, y: 400, width: 200, height: 50 };
    const result = snapTranslate(moving, [NEIGHBOUR], { threshold: 8 });
    expect(result.dx).toBe(-4);
    expect(result.guides[0]?.at).toBe(100);
  });

  test("leaves the box alone outside the threshold", () => {
    const moving = { x: 320, y: 400, width: 50, height: 50 };
    expect(snapTranslate(moving, [NEIGHBOUR], { threshold: 8 })).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    });
  });

  test("falls back to the grid on an axis with no object match", () => {
    const moving = { x: 305, y: 413, width: 50, height: 50 };
    const result = snapTranslate(moving, [NEIGHBOUR], {
      threshold: 8,
      grid: 24,
    });
    expect(result.dx).toBe(-5);
    // 413 -> 408 (17 * 24)
    expect(result.dy).toBe(-5);
    expect(result.guides).toHaveLength(1);
  });

  test("grid snapping alone draws no guides", () => {
    const result = snapTranslate({ x: 10, y: 10, width: 20, height: 20 }, [], {
      threshold: 8,
      grid: 24,
    });
    expect(result).toEqual({ dx: -10, dy: -10, guides: [] });
  });

  test("a frame-local grid snaps relative to its page-space origin", () => {
    const result = snapTranslate(
      { x: 109, y: 223, width: 20, height: 20 },
      [],
      {
        threshold: 8,
        grid: 8,
        gridOrigin: { x: 101, y: 204 },
      },
    );
    expect(result).toEqual({ dx: 0, dy: -3, guides: [] });
  });

  test("irregular column boundaries snap the nearest moving edge", () => {
    const result = snapTranslate({ x: 117, y: 20, width: 78, height: 20 }, [], {
      threshold: 8,
      gridLinesX: [120, 200, 220],
    });
    expect(result).toEqual({ dx: 3, dy: 0, guides: [] });
  });
});

describe("snapResize", () => {
  test("moves only the owned edge", () => {
    const box = { x: 0, y: 0, width: 97, height: 50 };
    const result = snapResize(box, { right: true }, [NEIGHBOUR], {
      threshold: 8,
    });
    expect(result.box).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(result.guides[0]?.at).toBe(100);
  });

  test("an unowned edge never snaps", () => {
    const box = { x: 97, y: 0, width: 50, height: 50 };
    const result = snapResize(box, { right: true }, [NEIGHBOUR], {
      threshold: 8,
    });
    expect(result.box.x).toBe(97);
  });

  test("uses the grid when no object is close", () => {
    const box = { x: 0, y: 0, width: 50, height: 50 };
    const result = snapResize(box, { bottom: true }, [], {
      threshold: 8,
      grid: 24,
    });
    expect(result.box.height).toBe(48);
    expect(result.guides).toHaveLength(0);
  });

  test("resizes against a frame-local grid origin", () => {
    const result = snapResize(
      { x: 101, y: 204, width: 33, height: 35 },
      { right: true, bottom: true },
      [],
      { threshold: 8, grid: 8, gridOrigin: { x: 101, y: 204 } },
    );
    expect(result.box).toEqual({ x: 101, y: 204, width: 32, height: 32 });
  });

  test("resizes against irregular row boundaries", () => {
    const result = snapResize(
      { x: 0, y: 40, width: 20, height: 57 },
      { bottom: true },
      [],
      { threshold: 8, gridLinesY: [100, 140] },
    );
    expect(result.box.height).toBe(60);
  });
});
