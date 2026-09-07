import { expect, test } from "bun:test";
import { assertValidDocument, type VisualStyle } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { fontFeatureCss, fontVariationCss } from "./font-settings.ts";
import { inspectDesign } from "./handoff.ts";
import { prototypeSmartSteps } from "./prototype.ts";
import {
  bindSelectionTextStyle,
  createTextStyle,
  typographyOf,
} from "./text-styles.ts";
import { typographyHandoff } from "./token-handoff.ts";
import { makeEditor } from "./test-helpers.ts";

const advanced: VisualStyle = {
  fontFamily: "Recursive",
  fontSize: 24,
  fontWeight: 650,
  fontStyle: "normal",
  lineHeight: 1.2,
  letterSpacing: -0.25,
  textAlign: "start",
  textDecoration: "none",
  verticalAlign: "top",
  fontVariations: [
    { tag: "wght", value: 650 },
    { tag: "wdth", value: 92.5 },
  ],
  fontFeatures: [
    { tag: "liga", value: 0 },
    { tag: "ss01", value: 1 },
  ],
};

test("variable axes and OpenType features share JSONL, CSS, SVG and handoff", () => {
  expect(fontVariationCss(advanced)).toBe('"wght" 650, "wdth" 92.5');
  expect(fontFeatureCss(advanced)).toBe('"liga" 0, "ss01" 1');
  const editor = makeEditor();
  const note = editor.createElement("text.note", {
    semantic: { text: "Variable typography" },
    visual: { x: 0, y: 0, width: 260, height: 60, style: advanced },
  });
  const saved = editor.getSnapshot();
  assertValidDocument(saved);
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  const css = inspectDesign(editor, note)?.css ?? "";
  expect(css).toContain('font-variation-settings: "wght" 650, "wdth" 92.5;');
  expect(css).toContain('font-feature-settings: "liga" 0, "ss01" 1;');
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain(
    'font-variation-settings="&quot;wght&quot; 650, &quot;wdth&quot; 92.5"',
  );
  expect(svg).toContain(
    'font-feature-settings="&quot;liga&quot; 0, &quot;ss01&quot; 1"',
  );
});

test("reusable text styles preserve advanced settings and linked CSS variables", () => {
  const editor = makeEditor();
  const source = editor.createElement("text.note", {
    semantic: { text: "Source" },
    visual: { x: 0, y: 0, width: 100, height: 30, style: advanced },
  });
  editor.selection.set([source]);
  const textStyle = createTextStyle(editor, "Variable label");
  if (!textStyle) throw new Error("missing text style");
  const target = editor.createElement("text.note", {
    semantic: { text: "Target" },
    visual: { x: 0, y: 40, width: 100, height: 30 },
  });
  editor.selection.set([target]);
  expect(bindSelectionTextStyle(editor, textStyle)).toBe(true);
  expect(editor.store.get(target)?.visual.style?.fontVariations).toEqual(
    advanced.fontVariations,
  );
  expect(editor.store.get(target)?.visual.style?.fontFeatures).toEqual(
    advanced.fontFeatures,
  );
  const linked = inspectDesign(editor, target)?.linkedCss ?? "";
  expect(linked).toContain("var(--diagra-type-");
  const variables = typographyHandoff(editor).css;
  expect(variables).toContain('font-variations: "wght" 650, "wdth" 92.5;');
  expect(variables).toContain('font-features: "liga" 0, "ss01" 1;');
  expect(typographyOf(editor.store.get(target)?.visual.style)).toMatchObject({
    fontVariations: advanced.fontVariations,
    fontFeatures: advanced.fontFeatures,
  });
});

test("smart animation carries compatible setting tags between matched text", () => {
  const editor = makeEditor();
  const from = editor.buildElement("text.note", {
    semantic: { text: "Variable" },
    visual: {
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      componentKey: "label",
      style: advanced,
    },
  });
  const source = editor.buildElement("frame", {
    semantic: { name: "Source", memberIds: [from.id] },
    visual: { x: 0, y: 0, width: 200, height: 100 },
  });
  const to = editor.buildElement("text.note", {
    semantic: { text: "Variable" },
    visual: {
      x: 300,
      y: 0,
      width: 100,
      height: 30,
      componentKey: "label",
      style: {
        ...advanced,
        fontVariations: [
          { tag: "wght", value: 800 },
          { tag: "wdth", value: 110 },
        ],
        fontFeatures: [
          { tag: "liga", value: 1 },
          { tag: "ss01", value: 0 },
        ],
      },
    },
  });
  const target = editor.buildElement("frame", {
    semantic: { name: "Target", memberIds: [to.id] },
    visual: { x: 300, y: 0, width: 200, height: 100 },
  });
  editor.apply(
    [source, from, target, to].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const step = prototypeSmartSteps(editor, source.id, target.id)[0];
  expect(step?.paintFrom?.fontVariations).toEqual(advanced.fontVariations);
  expect(step?.paintTo?.fontVariations?.[0]?.value).toBe(800);
  expect(step?.paintFrom?.fontFeatures).toEqual(advanced.fontFeatures);
  expect(step?.paintTo?.fontFeatures?.[0]?.value).toBe(1);
});

test("invalid tags, duplicates, values and oversized setting lists are rejected", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: { text: "Invalid" },
  });
  for (const style of [
    { fontVariations: [{ tag: "bad", value: 1 }] },
    {
      fontVariations: [
        { tag: "wght", value: 400 },
        { tag: "wght", value: 700 },
      ],
    },
    { fontFeatures: [{ tag: "liga", value: 0.5 }] },
    {
      fontFeatures: Array.from({ length: 17 }, (_, index) => ({
        tag: `x${index.toString().padStart(3, "0")}`,
        value: 1,
      })),
    },
  ])
    expect(() =>
      assertValidDocument({
        ...editor.getSnapshot(),
        elements: [{ ...note, visual: { style } }],
      }),
    ).toThrow();
});
