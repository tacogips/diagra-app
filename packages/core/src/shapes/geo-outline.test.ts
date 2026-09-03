// The eight geo primitives, pinned at one size.
//
// These numbers are what the canvas draws and what the SVG exporter writes,
// so a change here is a change to every rendered document.

import { describe, expect, test } from "bun:test";
import { GEO_KINDS } from "@diagra/ir";
import { geoOutline } from "./geo-outline.ts";

const WIDTH = 160;
const HEIGHT = 100;

describe("geoOutline at 160x100", () => {
  test("rect is inset by one unit and rounded", () => {
    expect(geoOutline("rect", WIDTH, HEIGHT)).toEqual({
      kind: "rect",
      x: 1,
      y: 1,
      width: 158,
      height: 98,
      rx: 4,
    });
  });

  test("ellipse fills the box with a one-unit inset radius", () => {
    expect(geoOutline("ellipse", WIDTH, HEIGHT)).toEqual({
      kind: "ellipse",
      cx: 80,
      cy: 50,
      rx: 79,
      ry: 49,
    });
  });

  test("diamond, triangle, hexagon and parallelogram are polygons", () => {
    expect(geoOutline("diamond", WIDTH, HEIGHT)).toEqual({
      kind: "polygon",
      points: "80,1 159,50 80,99 1,50",
    });
    expect(geoOutline("triangle", WIDTH, HEIGHT)).toEqual({
      kind: "polygon",
      points: "80,1 159,99 1,99",
    });
    expect(geoOutline("hexagon", WIDTH, HEIGHT)).toEqual({
      kind: "polygon",
      points: "40,1 120,1 159,50 120,99 40,99 1,50",
    });
    expect(geoOutline("parallelogram", WIDTH, HEIGHT)).toEqual({
      kind: "polygon",
      points: "40,1 159,1 120,99 1,99",
    });
  });

  test("cylinder carries a body path and a rim ellipse", () => {
    expect(geoOutline("cylinder", WIDTH, HEIGHT)).toEqual({
      kind: "cylinder",
      path: "M 1 15 A 79 15 0 0 1 159 15 L 159 85 A 79 15 0 0 1 1 85 Z",
      cap: { cx: 80, cy: 15, rx: 79, ry: 15 },
    });
  });

  test("a tall cylinder's rim stops growing at 18", () => {
    const outline = geoOutline("cylinder", 100, 400);
    expect(outline.kind).toBe("cylinder");
    if (outline.kind === "cylinder") {
      expect(outline.cap.ry).toBe(18);
    }
  });

  test("star has ten alternating points", () => {
    const outline = geoOutline("star", WIDTH, HEIGHT);
    expect(outline.kind).toBe("polygon");
    if (outline.kind === "polygon") {
      expect(outline.points.split(" ")).toHaveLength(10);
      expect(outline.points.startsWith("80,1")).toBe(true);
    }
  });

  test("every registered kind produces an outline", () => {
    for (const kind of GEO_KINDS) {
      expect(geoOutline(kind, WIDTH, HEIGHT).kind).toBeString();
    }
  });

  test("an unknown kind falls back to the rectangle", () => {
    expect(geoOutline("hypercube", WIDTH, HEIGHT)).toEqual(
      geoOutline("rect", WIDTH, HEIGHT),
    );
  });

  test("a degenerate box never produces a negative dimension", () => {
    expect(geoOutline("rect", 0, 0)).toMatchObject({ width: 0, height: 0 });
    expect(geoOutline("ellipse", 1, 1)).toMatchObject({ rx: 0, ry: 0 });
  });
});
