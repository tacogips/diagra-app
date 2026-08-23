// DOM-free unit tests for the geometry and tool mapping the interaction
// layer is built on. The gestures themselves need a real pointer and are
// covered by the manual canvas checklist instead.

import { describe, expect, test } from "bun:test";
import { MIN_SHAPE_SIZE, resizeBox } from "./interaction.ts";
import { creationFor, GEO_TOOLS, TOOLS } from "./tools.ts";

const START = { x: 100, y: 100, width: 200, height: 100 };

describe("resizeBox", () => {
  test("moves only the edges the handle owns", () => {
    expect(resizeBox(START, "e", 50, 999)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 100,
    });
    expect(resizeBox(START, "n", 999, -20)).toEqual({
      x: 100,
      y: 80,
      width: 200,
      height: 120,
    });
  });

  test("a corner handle moves both of its edges", () => {
    expect(resizeBox(START, "se", 20, 30)).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 130,
    });
    expect(resizeBox(START, "nw", 20, 30)).toEqual({
      x: 120,
      y: 130,
      width: 180,
      height: 70,
    });
  });

  test("normalizes a drag past the opposite edge", () => {
    const flipped = resizeBox(START, "e", -300, 0);
    expect(flipped.x).toBeLessThan(START.x);
    expect(flipped.width).toBeGreaterThan(0);
    expect(flipped.height).toBe(100);
  });

  test("never goes below the minimum size", () => {
    const tiny = resizeBox(START, "se", -1000, -1000);
    expect(tiny.width).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
    expect(tiny.height).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
  });
});

describe("creationFor", () => {
  test("gesture tools place nothing", () => {
    expect(creationFor("select")).toBeNull();
    expect(creationFor("hand")).toBeNull();
    expect(creationFor("edge")).toBeNull();
  });

  test("every geo tool maps onto shape.geo with its kind", () => {
    for (const tool of GEO_TOOLS) {
      const creation = creationFor(tool);
      expect(creation?.type).toBe("shape.geo");
      expect(creation?.semantic).toEqual({
        geo: tool.slice("geo:".length),
        label: "",
      });
    }
  });

  test("element tools place their own type with registry defaults", () => {
    expect(creationFor("erd.table")).toEqual({ type: "erd.table" });
    expect(creationFor("uml.class")).toEqual({ type: "uml.class" });
    expect(creationFor("node.generic")).toEqual({ type: "node.generic" });
  });

  test("every tool is either a gesture or a creation", () => {
    const gestures = new Set(["select", "hand", "edge"]);
    for (const tool of TOOLS) {
      expect(creationFor(tool) === null).toBe(gestures.has(tool));
    }
  });
});
