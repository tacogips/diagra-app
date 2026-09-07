import { expect, test } from "bun:test";
import { makeEditor } from "./test-helpers.ts";
import { freehandGeometry } from "./shapes/freehand.ts";

test("freehand bounds, path picking, resizing and SVG export", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 10, y: 20, pressure: 0.4 },
        { x: 30, y: 40, pressure: 0.8 },
      ],
    },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  expect(editor.getBounds(stroke.id)).toEqual({
    x: 10,
    y: 20,
    width: 20,
    height: 20,
  });
  const util = editor.getShapeUtil("draw.freehand");
  expect(
    util.hitTest(stroke, { x: 20, y: 30 }, editor.createShapeContext()),
  ).toBe(true);
  expect(
    util.hitTest(stroke, { x: 30, y: 20 }, editor.createShapeContext()),
  ).toBe(false);
  editor.resizeElement(stroke.id, { x: 50, y: 60, width: 100, height: 80 });
  const resized = editor.store.get(stroke.id);
  if (!resized) throw new Error("missing stroke");
  expect(freehandGeometry(resized)?.path).toBe("M0 0 L100 80");
  expect(freehandGeometry(resized)?.pressureOutline).not.toBeNull();
  expect(editor.exportPageSvg()).toContain('fill-rule="evenodd"');
  expect(editor.exportPageSvg()).not.toContain("unsupported");
  editor.undo();
  expect(editor.getBounds(stroke.id)?.width).toBe(20);
});

test("pressure width drives freehand picking and exported visual bounds", () => {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 0, y: 0, pressure: 0 },
        { x: 100, y: 0, pressure: 1 },
      ],
    },
    visual: { style: { stroke: "#123456", strokeWidth: 20 } },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  const util = editor.getShapeUtil("draw.freehand");
  const context = editor.createShapeContext();
  expect(util.hitTest(stroke, { x: 0, y: 7 }, context)).toBe(false);
  expect(util.hitTest(stroke, { x: 100, y: 17 }, context)).toBe(true);
  const geometry = freehandGeometry(stroke);
  expect(geometry?.curveBounds).toEqual({
    x: -2,
    y: -18,
    width: 120,
    height: 36,
  });
  const svg = editor.exportPageSvg();
  expect(svg).toContain('fill="#123456"');
  expect(svg).toContain('fill-rule="evenodd"');
});
