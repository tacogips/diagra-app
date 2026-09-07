import { expect, test } from "bun:test";
import type { FillGradient } from "@diagra/ir";
import {
  gradientHandleGeometry,
  moveGradientHandle,
  setElementFillGradient,
  setElementStrokeGradient,
} from "./gradient-handles.ts";
import { makeEditor } from "./test-helpers.ts";

const stops = [
  { offset: 0, color: "#000000" },
  { offset: 0.5, color: "#888888" },
  { offset: 1, color: "#ffffff" },
] as const;
const box = { x: 10, y: 20, width: 200, height: 100 };

test("linear handle geometry follows the renderer's aspect-aware vector", () => {
  const geometry = gradientHandleGeometry(
    { type: "linear", angle: 90, stops },
    box,
  );
  expect(geometry.start).toEqual({ x: 10, y: 70 });
  expect(geometry.end).toEqual({ x: 210, y: 70 });
  expect(geometry.stops[1]).toEqual({ x: 110, y: 70 });
});

test("linear endpoints set CSS angles in either direction", () => {
  const gradient: FillGradient = { type: "linear", angle: 90, stops };
  expect(
    moveGradientHandle(
      gradient,
      { kind: "linear-end" },
      { x: 110, y: 20 },
      box,
    ),
  ).toMatchObject({ angle: 0 });
  expect(
    moveGradientHandle(
      gradient,
      { kind: "linear-start" },
      { x: 110, y: 120 },
      box,
    ),
  ).toMatchObject({ angle: 0 });
});

test("stop drags project onto the axis and cannot cross neighbours", () => {
  const gradient: FillGradient = { type: "linear", angle: 90, stops };
  const moved = moveGradientHandle(
    gradient,
    { kind: "stop", index: 1 },
    { x: 190, y: 300 },
    box,
  );
  expect(moved.stops[1]?.offset).toBeCloseTo(0.9);
  expect(
    moveGradientHandle(
      gradient,
      { kind: "stop", index: 1 },
      { x: -500, y: 70 },
      box,
    ).stops[1]?.offset,
  ).toBe(0);
});

test("radial center and radius handles stay within the IR bounds", () => {
  const gradient: FillGradient = {
    type: "radial",
    centerX: 0.5,
    centerY: 0.5,
    radius: 0.5,
    stops,
  };
  expect(
    moveGradientHandle(
      gradient,
      { kind: "radial-center" },
      { x: 500, y: 0 },
      box,
    ),
  ).toMatchObject({ centerX: 1, centerY: 0 });
  expect(
    moveGradientHandle(
      gradient,
      { kind: "radial-radius" },
      { x: 5110, y: 70 },
      box,
    ),
  ).toMatchObject({ radius: 2 });
});

test("angular handles move the center, zero direction and circular stops", () => {
  const gradient: FillGradient = {
    type: "angular",
    centerX: 0.5,
    centerY: 0.5,
    angle: 0,
    stops,
  };
  const geometry = gradientHandleGeometry(gradient, box);
  expect(geometry.start).toEqual({ x: 110, y: 70 });
  expect(geometry.end).toEqual({ x: 110, y: -30 });
  expect(geometry.stops[1]?.x).toBeCloseTo(110);
  expect(geometry.stops[1]?.y).toBeCloseTo(170);
  expect(
    moveGradientHandle(
      gradient,
      { kind: "angular-angle" },
      { x: 210, y: 70 },
      box,
    ),
  ).toMatchObject({ angle: 90 });
  expect(
    moveGradientHandle(
      gradient,
      { kind: "stop", index: 1 },
      { x: 210, y: 70 },
      box,
    ).stops[1]?.offset,
  ).toBeCloseTo(0.25);
  expect(
    moveGradientHandle(
      gradient,
      { kind: "angular-center" },
      { x: 10, y: 20 },
      box,
    ),
  ).toMatchObject({ centerX: 0, centerY: 0 });
});

test("diamond radius handle controls its size and direction", () => {
  const gradient: FillGradient = {
    type: "diamond",
    centerX: 0.5,
    centerY: 0.5,
    radius: 0.5,
    angle: 90,
    stops,
  };
  expect(gradientHandleGeometry(gradient, box).end).toEqual({ x: 210, y: 70 });
  expect(
    moveGradientHandle(
      gradient,
      { kind: "diamond-radius" },
      { x: 110, y: 170 },
      box,
    ),
  ).toMatchObject({ angle: 180, radius: 0.5 });
});

test("canvas gradient commits preserve visual fields and undo atomically", () => {
  const editor = makeEditor();
  const original: FillGradient = { type: "linear", angle: 90, stops };
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "rect" },
    visual: {
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      style: { fill: "#000000", stroke: "#ffffff", fillGradient: original },
    },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  const next = moveGradientHandle(
    original,
    { kind: "linear-end" },
    { x: 110, y: 20 },
    box,
  );
  expect(setElementFillGradient(editor, shape.id, next)).toBe(true);
  expect(editor.store.get(shape.id)?.visual.style).toMatchObject({
    fill: "#000000",
    stroke: "#ffffff",
    fillGradient: { type: "linear", angle: 0 },
  });
  expect(setElementFillGradient(editor, shape.id, next)).toBe(false);
  expect(editor.undo()).toBe(true);
  expect(editor.store.get(shape.id)?.visual.style?.fillGradient).toEqual(
    original,
  );
});

test("stroke-gradient canvas commits use an independent paint channel", () => {
  const editor = makeEditor();
  const original: FillGradient = { type: "linear", angle: 90, stops };
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "rect" },
    visual: {
      style: { fillGradient: original, strokeGradient: original },
    },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  const next = { ...original, angle: 180 };
  expect(setElementStrokeGradient(editor, shape.id, next)).toBe(true);
  expect(editor.store.get(shape.id)?.visual.style?.strokeGradient).toEqual(
    next,
  );
  expect(editor.store.get(shape.id)?.visual.style?.fillGradient).toEqual(
    original,
  );
  editor.undo();
  expect(editor.store.get(shape.id)?.visual.style?.strokeGradient).toEqual(
    original,
  );
});

test("canvas gradient commits reject inherited locks", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", {
    semantic: { name: "Locked", memberIds: [] },
    visual: { x: 0, y: 0, width: 300, height: 200, locked: true },
  });
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "rect" },
    visual: {
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      style: { fillGradient: { type: "linear", angle: 90, stops } },
    },
  });
  editor.apply([
    { type: "createElement", element: frame },
    { type: "createElement", element: shape },
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: { name: "Locked", memberIds: [shape.id] },
    },
  ]);
  expect(
    setElementFillGradient(editor, shape.id, {
      type: "linear",
      angle: 0,
      stops,
    }),
  ).toBe(false);
});
