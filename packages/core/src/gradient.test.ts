import { expect, test } from "bun:test";
import {
  parseDocument,
  parseDocumentResult,
  serializeDocument,
} from "@diagra/io";
import type { FillGradient } from "@diagra/ir";
import { bindSelectionColor, createColorToken } from "./color-tokens.ts";
import {
  angularGradientPatches,
  diamondGradientPatches,
  gradientCss,
  gradientId,
  linearGradientVector,
  sampleGradient,
  strokeGradientId,
} from "./gradient.ts";
import { inspectDesign } from "./handoff.ts";
import { document, element, makeEditor } from "./test-helpers.ts";
import { componentOverrides } from "./component-overrides.ts";
import { insertUiBlock } from "./ui-blocks.ts";

const linear: FillGradient = {
  type: "linear",
  angle: 135,
  stops: [
    { offset: 0, color: "#112233" },
    { offset: 0.4, color: "#445566", opacity: 0.5 },
    { offset: 1, color: "#abcdef" },
  ],
};

const angular: FillGradient = {
  type: "angular",
  centerX: 0.25,
  centerY: 0.75,
  angle: 30,
  stops: linear.stops,
};

const diamond: FillGradient = {
  type: "diamond",
  centerX: 0.5,
  centerY: 0.5,
  radius: 0.75,
  angle: 45,
  stops: linear.stops,
};

test("linear gradients persist, export and hand off without mutating the document", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "card/<unsafe>",
        type: "shape.geo",
        semantic: { geo: "rect", label: "Card" },
        visual: {
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          style: { fill: "#112233", fillGradient: linear },
        },
      }),
    ]),
  });
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  const before = JSON.stringify(editor.getSnapshot());
  const svg = editor.exportPageSvg() ?? "";
  expect(svg).toContain(`<linearGradient id="${gradientId("card/<unsafe>")}"`);
  expect(svg).toContain(`fill="url(#${gradientId("card/<unsafe>")})"`);
  expect(svg).toContain('stop-color="#445566"');
  expect(svg).toContain('stop-opacity="0.5"');
  const handoff = inspectDesign(editor, "card/<unsafe>");
  expect(handoff?.css).toContain(`background-image: ${gradientCss(linear)};`);
  expect(JSON.stringify(editor.getSnapshot())).toBe(before);
});

test("radial gradients and aspect-aware linear vectors are deterministic", () => {
  const radial: FillGradient = {
    type: "radial",
    centerX: 0.25,
    centerY: 0.75,
    radius: 0.8,
    stops: [
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: "#000000" },
    ],
  };
  expect(gradientCss(radial)).toBe(
    "radial-gradient(circle 80% at 25% 75%, #ffffff 0%, #000000 100%)",
  );
  expect(linearGradientVector(90, 200, 100)).toEqual({
    x1: 0,
    y1: 0.5,
    x2: 1,
    y2: 0.5,
  });
  expect(linearGradientVector(0, 200, 100)).toEqual({
    x1: 0.5,
    y1: 1,
    x2: 0.5,
    y2: 0,
  });
});

test("angular and diamond ramps share deterministic CSS and SVG sampling", () => {
  expect(gradientCss(angular)).toBe(
    "conic-gradient(from 30deg at 25% 75%, #112233 0%, #44556680 40%, #abcdef 100%)",
  );
  expect(gradientCss(diamond)).toStartWith(
    'url("data:image/svg+xml,%3Csvg%20xmlns%3D',
  );
  expect(sampleGradient(linear.stops, 0.4)).toEqual({
    color: "#445566",
    opacity: 0.5,
  });
  expect(sampleGradient(linear.stops, 0.2)).toEqual({
    color: "#2b3c4d",
    opacity: 0.75,
  });
  const insetStops = [
    { offset: 0.2, color: "#112233" },
    { offset: 0.8, color: "#abcdef", opacity: 0.4 },
  ] as const;
  expect(sampleGradient(insetStops, 0)).toEqual({
    color: "#112233",
    opacity: 1,
  });
  expect(sampleGradient(insetStops, 1)).toEqual({
    color: "#abcdef",
    opacity: 0.4,
  });
  expect(angularGradientPatches(angular, 200, 100, 10, 20, 12)).toHaveLength(
    12,
  );
  expect(diamondGradientPatches(diamond, 200, 100, 10, 20, 8)).toHaveLength(8);
});

test("advanced fill and stroke gradients persist, export as patterns and hand off", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "rect" },
    visual: {
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      style: {
        fill: "#112233",
        fillGradient: angular,
        stroke: "#abcdef",
        strokeGradient: diamond,
      },
    },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(saved).toContain('"fillGradient":{"type":"angular","angle":30');
  expect(saved).toContain('"strokeGradient":{"type":"diamond","angle":45');
  const svg = editor.exportPageSvg() ?? "";
  expect(svg).toContain(`<pattern id="${gradientId(shape.id)}"`);
  expect(svg).toContain(`<pattern id="${strokeGradientId(shape.id)}"`);
  expect(svg).toContain("<polygon");
  expect(inspectDesign(editor, shape.id)?.css).toContain(
    `background-image: ${gradientCss(angular)};`,
  );
});

test("stroke gradients persist, export, hand off and yield to solid or linked strokes", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "rect" },
    visual: {
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      style: { stroke: "#112233", strokeWidth: 4, strokeGradient: linear },
    },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(saved).toContain(
    `"stroke":"#112233","strokeGradient":{"type":"linear"`,
  );
  const svg = editor.exportPageSvg() ?? "";
  expect(svg).toContain(`<linearGradient id="${strokeGradientId(shape.id)}"`);
  expect(svg).toContain(`stroke="url(#${strokeGradientId(shape.id)})"`);
  expect(inspectDesign(editor, shape.id)?.css).toContain(
    `border-image-source: ${gradientCss(linear)};`,
  );

  editor.selection.set([shape.id]);
  editor.setSelectionStyle({ stroke: "#fedcba" });
  expect(
    editor.store.get(shape.id)?.visual.style?.strokeGradient,
  ).toBeUndefined();
  editor.setSelectionStyle({ strokeGradient: linear });
  expect(editor.store.get(shape.id)?.visual.style?.stroke).toBe("#112233");
  const token = createColorToken(editor, "Outline", "#123456");
  if (!token) throw new Error("missing token");
  bindSelectionColor(editor, "stroke", token);
  expect(editor.store.get(shape.id)?.visual.style?.stroke).toBe("#123456");
  expect(
    editor.store.get(shape.id)?.visual.style?.strokeGradient,
  ).toBeUndefined();
});

test("horizontal connectors export a user-space stroke gradient", () => {
  const editor = makeEditor();
  const from = editor.buildElement("node.generic", {
    id: "from",
    visual: { x: 0, y: 0, width: 100, height: 60 },
  });
  const to = editor.buildElement("node.generic", {
    id: "to",
    visual: { x: 300, y: 0, width: 100, height: 60 },
  });
  const edge = editor.buildElement("edge.generic", {
    id: "gradient-edge",
    semantic: { from: from.id, to: to.id },
    visual: { style: { stroke: "#112233", strokeGradient: linear } },
  });
  editor.apply([
    { type: "createElement", element: from },
    { type: "createElement", element: to },
    { type: "createElement", element: edge },
  ]);
  const svg = editor.exportPageSvg() ?? "";
  expect(svg).toContain(
    `<linearGradient id="${strokeGradientId(edge.id)}" gradientUnits="userSpaceOnUse"`,
  );
  expect(svg).toContain(`stroke="url(#${strokeGradientId(edge.id)})"`);
});

test("solid and linked color edits replace a gradient while disabling it retains the fallback", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      style: { fillGradient: linear },
    },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  editor.selection.set([shape.id]);
  editor.setSelectionStyle({ fillGradient: null });
  expect(
    editor.store.get(shape.id)?.visual.style?.fillGradient,
  ).toBeUndefined();
  editor.setSelectionStyle({ fillGradient: linear });
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#112233");
  editor.setSelectionStyle({ fill: "#fedcba" });
  expect(editor.store.get(shape.id)?.visual.style).toMatchObject({
    fill: "#fedcba",
  });
  expect(
    editor.store.get(shape.id)?.visual.style?.fillGradient,
  ).toBeUndefined();
  editor.setSelectionStyle({ fillGradient: linear });
  const token = createColorToken(editor, "Solid", "#123456");
  if (!token) throw new Error("missing token");
  bindSelectionColor(editor, "fill", token);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#123456");
  expect(
    editor.store.get(shape.id)?.visual.style?.fillGradient,
  ).toBeUndefined();
  const linked = serializeDocument(editor.getSnapshot());
  editor.setSelectionStyle({ fillGradient: linear });
  expect(editor.store.get(shape.id)?.visual.colorTokens?.fill).toBeUndefined();
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#112233");
  editor.undo();
  expect(serializeDocument(editor.getSnapshot())).toBe(linked);
});

test("malformed gradient geometry, colors, stop counts and ordering are rejected", () => {
  const base = element({
    id: "shape",
    type: "shape.geo",
    semantic: { geo: "rect" },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  for (const fillGradient of [
    { type: "linear", angle: 0, stops: [{ offset: 0, color: "#000000" }] },
    {
      type: "linear",
      angle: 0,
      stops: [
        { offset: 0.8, color: "#000000" },
        { offset: 0.2, color: "#ffffff" },
      ],
    },
    {
      type: "linear",
      angle: 0,
      stops: [
        { offset: 0, color: "red" },
        { offset: 1, color: "#ffffff", opacity: 2 },
      ],
    },
    {
      type: "radial",
      centerX: 2,
      centerY: 0.5,
      radius: 3,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    },
    {
      type: "angular",
      centerX: -1,
      centerY: 0.5,
      angle: 0,
      stops: linear.stops,
    },
    {
      type: "diamond",
      centerX: 0.5,
      centerY: 0.5,
      radius: 3,
      angle: 0,
      stops: linear.stops,
    },
  ]) {
    const json = serializeDocument(
      document([
        {
          ...base,
          visual: {
            ...base.visual,
            style: { fillGradient: fillGradient as FillGradient },
          },
        },
      ]),
      { validate: false },
    );
    expect(parseDocumentResult(json).ok).toBe(false);
    const strokeJson = serializeDocument(
      document([
        {
          ...base,
          visual: {
            ...base.visual,
            style: { strokeGradient: fillGradient as FillGradient },
          },
        },
      ]),
      { validate: false },
    );
    expect(parseDocumentResult(strokeJson).ok).toBe(false);
  }
});

test("component refresh preserves local gradient overrides and reset restores source paint", () => {
  const editor = makeEditor();
  const source = insertUiBlock(editor, "button", { x: 0, y: 0 });
  editor.selection.set([source]);
  editor.setSelectionStyle({ fillGradient: linear });
  const instance = editor.createComponentInstance(source);
  if (!instance) throw new Error("missing instance");
  const radial: FillGradient = {
    type: "radial",
    centerX: 0.5,
    centerY: 0.5,
    radius: 0.7,
    stops: [
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: "#000000" },
    ],
  };
  editor.selection.set([instance]);
  editor.setSelectionStyle({ fillGradient: radial });
  expect(
    componentOverrides(editor, instance).map((item) => item.field),
  ).toContain("style.fillGradient");
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(instance)?.visual.style?.fillGradient).toEqual(
    radial,
  );
  expect(
    editor.resetComponentOverride(instance, instance, "style.fillGradient"),
  ).toBe(true);
  expect(editor.store.get(instance)?.visual.style?.fillGradient).toEqual(
    linear,
  );
});

test("component instances track stroke-gradient overrides independently", () => {
  const editor = makeEditor();
  const source = insertUiBlock(editor, "button", { x: 0, y: 0 });
  editor.selection.set([source]);
  editor.setSelectionStyle({ strokeGradient: linear });
  const instance = editor.createComponentInstance(source);
  if (!instance) throw new Error("missing instance");
  const radial: FillGradient = {
    type: "radial",
    centerX: 0.25,
    centerY: 0.75,
    radius: 0.6,
    stops: linear.stops,
  };
  editor.selection.set([instance]);
  editor.setSelectionStyle({ strokeGradient: radial });
  expect(
    componentOverrides(editor, instance).map((item) => item.field),
  ).toContain("style.strokeGradient");
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(instance)?.visual.style?.strokeGradient).toEqual(
    radial,
  );
  expect(
    editor.resetComponentOverride(instance, instance, "style.strokeGradient"),
  ).toBe(true);
  expect(editor.store.get(instance)?.visual.style?.strokeGradient).toEqual(
    linear,
  );
});
