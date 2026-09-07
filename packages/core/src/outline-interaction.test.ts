import { expect, test } from "bun:test";
import type { GeoKind } from "@diagra/ir";
import { clipCss } from "./clipping.ts";
import { overlapsVisibleElement } from "./selection-geometry.ts";
import { makeEditor } from "./test-helpers.ts";
import { prototypeScreen } from "./prototype.ts";

test("primitive picking rejects transparent polygon and cylinder corners", () => {
  for (const kind of ["triangle", "hexagon", "star", "cylinder"] as GeoKind[]) {
    const editor = makeEditor();
    const shape = editor.buildElement("shape.geo", {
      semantic: { geo: kind },
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    editor.apply([{ type: "createElement", element: shape }]);
    expect(editor.hitTest({ x: 2, y: 2 })).toBeNull();
    expect(editor.hitTest({ x: 50, y: 50 })).toBe(shape.id);
  }
});

test("rotated point and marquee picking use the visible primitive outline", () => {
  const editor = makeEditor();
  const triangle = editor.buildElement("shape.geo", {
    semantic: { geo: "triangle" },
    visual: { x: 100, y: 100, width: 100, height: 100, rotation: 90 },
  });
  editor.apply([{ type: "createElement", element: triangle }]);
  const context = editor.createShapeContext();
  expect(editor.hitTest({ x: 198, y: 102 })).toBeNull();
  expect(editor.hitTest({ x: 150, y: 150 })).toBe(triangle.id);
  expect(
    overlapsVisibleElement(
      triangle,
      { x: 198, y: 102, width: 1, height: 1 },
      context,
    ),
  ).toBe(false);
  expect(
    overlapsVisibleElement(
      triangle,
      { x: 149, y: 149, width: 2, height: 2 },
      context,
    ),
  ).toBe(true);
});

test("prototype hotspots carry local outline geometry without mutating the document", () => {
  const editor = makeEditor();
  const source = editor.buildElement("shape.geo", {
    id: "round-action",
    semantic: { geo: "ellipse", label: "Continue" },
    visual: { x: 20, y: 30, width: 100, height: 60, rotation: 15 },
  });
  const start = editor.buildElement("frame", {
    id: "start",
    semantic: { name: "Start", memberIds: [source.id] },
    visual: { x: 0, y: 0, width: 200, height: 160 },
  });
  const target = editor.buildElement("frame", {
    id: "target",
    semantic: { name: "Target", memberIds: [] },
    visual: { x: 300, y: 0, width: 200, height: 160 },
  });
  const link = editor.buildElement("edge.generic", {
    semantic: { from: source.id, to: target.id, prototype: true },
  });
  editor.apply(
    [start, target, source, link].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();
  const hotspot = prototypeScreen(editor, start.id)?.links[0];
  expect(hotspot?.hitPolygon).toHaveLength(32);
  expect(hotspot?.hitPolygon?.[0]).toEqual({ x: 99, y: 30 });
  expect(clipCss(hotspot?.hitPolygon)).toStartWith("polygon(");
  expect(hotspot?.rotation).toBe(15);
  expect(editor.getSnapshot()).toEqual(before);
});
