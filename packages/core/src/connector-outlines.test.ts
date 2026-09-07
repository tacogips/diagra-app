import { expect, test } from "bun:test";
import type { Element } from "@diagra/ir";
import { makeEditor } from "./test-helpers.ts";
import { readDirectEndpoints, resolveConnector } from "./shapes/connector.ts";

function resolve(from: Element, to: Element) {
  const editor = makeEditor();
  const edge = editor.buildElement("edge.generic", {
    semantic: { from: from.id, to: to.id },
  });
  editor.apply(
    [from, to, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  return {
    editor,
    edge,
    endpoints: resolveConnector(
      edge,
      editor.createShapeContext(),
      readDirectEndpoints,
    ),
  };
}

test("connectors meet ellipse and polygon outlines instead of their boxes", () => {
  const editor = makeEditor();
  const target = editor.buildElement("node.generic", {
    id: "target",
    visual: { x: 250, y: -100, width: 100, height: 100 },
  });
  const ellipse = editor.buildElement("shape.geo", {
    id: "ellipse",
    semantic: { geo: "ellipse" },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const diamond = editor.buildElement("shape.geo", {
    id: "diamond",
    semantic: { geo: "diamond" },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });

  const ellipseResult = resolve(ellipse, target).endpoints;
  expect(ellipseResult).not.toBeNull();
  const ellipseX = ((ellipseResult?.start.x ?? 0) - 50) / 49;
  const ellipseY = ((ellipseResult?.start.y ?? 0) - 50) / 49;
  expect(ellipseX * ellipseX + ellipseY * ellipseY).toBeCloseTo(1);
  expect(ellipseResult?.start.x).toBeLessThan(100);
  expect(ellipseResult?.start.y).toBeGreaterThan(0);

  const diamondResult = resolve(diamond, target).endpoints;
  expect(diamondResult).not.toBeNull();
  expect(
    Math.abs((diamondResult?.start.x ?? 0) - 50) +
      Math.abs((diamondResult?.start.y ?? 0) - 50),
  ).toBeCloseTo(49);
  expect(diamondResult?.start.x).toBeLessThan(100);
  expect(diamondResult?.start.y).toBeGreaterThan(0);
});

test("rounded corners and rotation participate in shared endpoint geometry", () => {
  const editor = makeEditor();
  const rounded = editor.buildElement("node.generic", {
    id: "rounded",
    visual: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 90,
      style: { cornerRadius: 30 },
    },
  });
  const target = editor.buildElement("node.generic", {
    id: "target",
    visual: { x: 200, y: 200, width: 100, height: 100 },
  });
  const { editor: resultEditor, endpoints, edge } = resolve(rounded, target);
  expect(endpoints).not.toBeNull();
  expect(endpoints?.start.x).toBeLessThan(100);
  expect(endpoints?.start.y).toBeLessThan(100);
  expect(endpoints?.start.x).toBeGreaterThan(50);
  expect(endpoints?.start.y).toBeGreaterThan(50);
  expect(resultEditor.exportPageSvg()).toContain(`data-id="${edge.id}"`);
});

test("connectors terminate on flattened freehand paths", () => {
  const path = makeEditor().buildElement("draw.freehand", {
    id: "path",
    semantic: {
      closed: true,
      points: [
        { x: 0, y: 100 },
        { x: 50, y: 0 },
        { x: 100, y: 100 },
      ],
    },
  });
  const target = makeEditor().buildElement("node.generic", {
    id: "target",
    visual: { x: 200, y: -100, width: 100, height: 100 },
  });
  const { endpoints } = resolve(path, target);
  expect(endpoints).not.toBeNull();
  expect(endpoints?.start.x).toBeCloseTo(70, 3);
  expect(endpoints?.start.y).toBeCloseTo(40, 3);
});
