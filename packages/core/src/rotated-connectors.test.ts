import { expect, test } from "bun:test";
import {
  connectorEndpoints,
  resolveConnector,
  readDirectEndpoints,
} from "./shapes/connector.ts";
import { makeEditor } from "./test-helpers.ts";
import { rotatePoint, boxCenter } from "./geometry.ts";

test("connector endpoints meet rotated rectangular borders", () => {
  const from = { x: 0, y: 0, width: 200, height: 40 };
  const to = { x: 400, y: 0, width: 200, height: 40 };
  const result = connectorEndpoints(from, to, 90, -90);
  expect(result.start.x).toBeCloseTo(120);
  expect(result.start.y).toBeCloseTo(20);
  expect(result.end.x).toBeCloseTo(480);
  expect(result.end.y).toBeCloseTo(20);
});

test("diagonal endpoints lie on a local box border and the center-to-center line", () => {
  const from = { x: 0, y: 0, width: 200, height: 40 };
  const to = { x: 400, y: 200, width: 100, height: 100 };
  const result = connectorEndpoints(from, to, 37, 0);
  const center = boxCenter(from);
  const target = boxCenter(to);
  const local = rotatePoint(result.start, center, -37);
  expect(
    Math.min(
      Math.abs(local.x - from.x),
      Math.abs(local.x - from.x - from.width),
      Math.abs(local.y - from.y),
      Math.abs(local.y - from.y - from.height),
    ),
  ).toBeLessThan(1e-8);
  expect(
    (result.start.x - center.x) * (target.y - center.y) -
      (result.start.y - center.y) * (target.x - center.x),
  ).toBeCloseTo(0);
});

test("editing endpoint rotation updates shared connector geometry and undo", () => {
  const editor = makeEditor();
  const from = editor.buildElement("node.generic", {
    visual: { x: 0, y: 0, width: 200, height: 40 },
  });
  const to = editor.buildElement("node.generic", {
    visual: { x: 400, y: 0, width: 200, height: 40 },
  });
  const edge = editor.buildElement("edge.generic", {
    semantic: { from: from.id, to: to.id },
  });
  editor.apply(
    [from, to, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const resolve = () =>
    resolveConnector(edge, editor.createShapeContext(), readDirectEndpoints);
  expect(resolve()?.start.x).toBe(200);
  editor.apply([
    { type: "updateVisual", id: from.id, visual: { rotation: 90 } },
  ]);
  expect(resolve()?.start.x).toBeCloseTo(120);
  expect(editor.hitTest({ x: 140, y: 20 })).toBe(edge.id);
  expect(editor.exportPageSvg()).toContain('x1="120"');
  editor.undo();
  expect(resolve()?.start.x).toBe(200);
});
