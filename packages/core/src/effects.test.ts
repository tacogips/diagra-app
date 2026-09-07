import { expect, test } from "bun:test";
import { assertValidDocument, type LayerEffect } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  backdropEffectsCss,
  effectBounds,
  effectsBounds,
  effectsCss,
  layerEffects,
  shadowCss,
} from "./effects.ts";
import { inspectDesign } from "./handoff.ts";
import { makeEditor } from "./test-helpers.ts";

const shadow = { x: 5, y: 10, blur: 2, color: "#123456", opacity: 0.25 };

test("shadow CSS and Gaussian export bounds share design units", () => {
  expect(shadowCss(shadow)).toBe(
    "drop-shadow(5px 10px 2px rgba(18, 52, 86, 0.25))",
  );
  expect(effectBounds({ x: 0, y: 0, width: 100, height: 100 }, shadow)).toEqual(
    { x: -1, y: 0, width: 112, height: 116 },
  );
  expect(shadowCss(undefined)).toBeUndefined();
});

test("ordered effects share CSS, SVG, handoff and export bounds", () => {
  const stack = [
    { type: "drop-shadow", ...shadow },
    { type: "layer-blur", blur: 1 },
    {
      type: "drop-shadow",
      x: 99,
      y: 99,
      blur: 99,
      color: "#ffffff",
      opacity: 1,
      enabled: false,
    },
  ] satisfies readonly LayerEffect[];
  const css = "drop-shadow(5px 10px 2px rgba(18, 52, 86, 0.25)) blur(1px)";
  expect(effectsCss({ effects: stack })).toBe(css);
  expect(
    effectsBounds({ x: 0, y: 0, width: 100, height: 100 }, { effects: stack }),
  ).toEqual({ x: -4, y: -3, width: 118, height: 122 });

  const editor = makeEditor();
  const node = editor.buildElement("node.generic", {
    visual: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      style: { effects: stack },
    },
  });
  editor.apply([{ type: "createElement", element: node }]);
  expect(inspectDesign(editor, node.id)?.css).toContain(`filter: ${css};`);
  const svg = editor.exportPageSvg({ padding: 0 });
  if (!svg) throw new Error("missing SVG");
  expect(svg).toContain('viewBox="-4 -3 118 122"');
  expect(svg).not.toContain('dx="99"');
  expect(svg.indexOf("feDropShadow")).toBeLessThan(
    svg.indexOf("feGaussianBlur"),
  );
});

test("background blur samples the backdrop without expanding layer bounds", () => {
  const stack = [
    { type: "background-blur", blur: 8 },
    { type: "layer-blur", blur: 2 },
    { type: "background-blur", blur: 4, enabled: false },
  ] satisfies readonly LayerEffect[];
  expect(effectsCss({ effects: stack })).toBe("blur(2px)");
  expect(backdropEffectsCss({ effects: stack })).toBe("blur(8px)");
  expect(
    effectsBounds({ x: 0, y: 0, width: 100, height: 50 }, { effects: stack }),
  ).toEqual({ x: -6, y: -6, width: 112, height: 62 });

  const editor = makeEditor();
  const node = editor.buildElement("node.generic", {
    visual: {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      style: { fill: "#ffffff", effects: stack },
    },
  });
  editor.apply([{ type: "createElement", element: node }]);
  const saved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  expect(inspectDesign(editor, node.id)?.css).toContain(
    "backdrop-filter: blur(8px);",
  );
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain('in="BackgroundImage"');
  expect(svg).toContain('in2="SourceAlpha"');
  expect(svg).toContain("diagra-backdrop-clipped");
  expect(svg).toContain('viewBox="-6 -6 112 62"');
});

test("an explicit effect stack supersedes legacy shadow compatibility", () => {
  expect(layerEffects({ shadow })).toEqual([
    { type: "drop-shadow", ...shadow },
  ]);
  expect(effectsCss({ shadow })).toBe(shadowCss(shadow));
  expect(layerEffects({ effects: [], shadow })).toEqual([]);
  expect(effectsCss({ effects: [], shadow })).toBeUndefined();
  expect(
    effectsBounds(
      { x: 0, y: 0, width: 100, height: 100 },
      { effects: [{ type: "layer-blur", blur: 10, enabled: false }] },
    ),
  ).toEqual({ x: 0, y: 0, width: 100, height: 100 });
});

test("shadow style preserves JSONL, undo and handoff and expands SVG export", () => {
  const editor = makeEditor();
  const node = editor.buildElement("node.generic", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  editor.apply([{ type: "createElement", element: node }]);
  editor.selection.set([node.id]);
  editor.setSelectionStyle({ shadow });
  const saved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  expect(inspectDesign(editor, node.id)?.css).toContain(
    shadowCss(shadow) ?? "missing",
  );
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain('viewBox="-1 0 112 116"');
  expect(svg).toContain('stdDeviation="2"');
  expect(svg).toContain('flood-opacity="0.25"');
  expect(svg).toContain('filter="url(#diagra-shadow-0)"');
  editor.undo();
  expect(editor.store.get(node.id)?.visual.style?.shadow).toBeUndefined();
  editor.redo();
  editor.setSelectionStyle({ shadow: null });
  expect(editor.exportPageSvg()).not.toContain("feDropShadow");
});

test("effect stacks preserve JSONL and undo as one style edit", () => {
  const editor = makeEditor();
  const node = editor.buildElement("node.generic");
  const effects = [
    { type: "layer-blur", blur: 3 },
    { type: "drop-shadow", ...shadow },
  ] satisfies readonly LayerEffect[];
  editor.apply([{ type: "createElement", element: node }]);
  editor.selection.set([node.id]);
  editor.setSelectionStyle({ effects });
  const saved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  expect(editor.store.get(node.id)?.visual.style?.effects).toEqual(effects);
  editor.undo();
  expect(editor.store.get(node.id)?.visual.style?.effects).toBeUndefined();
  editor.redo();
  expect(editor.store.get(node.id)?.visual.style?.effects).toEqual(effects);
});

test("invalid shadows cannot enter the document", () => {
  const editor = makeEditor();
  const node = editor.buildElement("node.generic");
  for (const invalid of [
    { ...shadow, blur: -1 },
    { ...shadow, opacity: 2 },
    { ...shadow, color: "url(https://example.com)" },
    { ...shadow, x: Number.NaN },
  ]) {
    expect(() =>
      assertValidDocument({
        ...editor.getSnapshot(),
        elements: [{ ...node, visual: { style: { shadow: invalid } } }],
      }),
    ).toThrow();
  }
});

test("invalid or oversized effect stacks cannot enter the document", () => {
  const editor = makeEditor();
  const node = editor.buildElement("node.generic");
  const invalid: readonly unknown[] = [
    "not-an-array",
    Array.from({ length: 9 }, () => ({ type: "layer-blur", blur: 1 })),
    [{ type: "inner-shadow", blur: 1 }],
    [{ type: "layer-blur", blur: -1 }],
    [{ type: "layer-blur", blur: 1, enabled: "yes" }],
    [{ type: "drop-shadow", x: 1, y: 2, blur: 3, color: "red" }],
    [
      {
        type: "drop-shadow",
        x: 1,
        y: 2,
        blur: 3,
        color: "#000000",
        opacity: 2,
      },
    ],
  ];
  for (const effects of invalid) {
    expect(() =>
      assertValidDocument({
        ...editor.getSnapshot(),
        elements: [
          {
            ...node,
            visual: { style: { effects: effects as readonly LayerEffect[] } },
          },
        ],
      }),
    ).toThrow();
  }
});

test("a shadow can enter a frame clip while its source is outside", () => {
  const editor = makeEditor();
  const node = editor.buildElement("node.generic", {
    visual: {
      x: 110,
      y: 20,
      width: 10,
      height: 10,
      style: { shadow: { ...shadow, x: -20, y: 0, blur: 0 } },
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Screen", memberIds: [node.id], clipContent: true },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  editor.apply([
    { type: "createElement", element: frame },
    { type: "createElement", element: node },
  ]);
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain(`data-id="${node.id}"`);
  expect(svg).toContain('viewBox="0 0 100 100"');
  expect(svg).toContain('clip-path="url(#diagra-clip-0)"');
  expect(editor.hitTest({ x: 95, y: 25 })).not.toBe(node.id);
});
