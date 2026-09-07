import { expect, test } from "bun:test";
import {
  bindSelectionColor,
  createColorToken,
  setColorTokenAlias,
  updateColorToken,
} from "./color-tokens.ts";
import { inspectDesign } from "./handoff.ts";
import { colorTokenCssName, paletteHandoff } from "./token-handoff.ts";
import { bindSelectionNumber, createNumberToken } from "./number-tokens.ts";
import { measurementHandoff, numberTokenCssName } from "./token-handoff.ts";
import { makeEditor } from "./test-helpers.ts";

test("CSS names are safe and distinct for punctuation, Unicode and hostile IDs", () => {
  const ids = [
    "a-b",
    "a_b",
    "a b",
    "雪",
    "😀",
    "*/}body{color:red}",
    "61",
    "a",
  ];
  const names = ids.map(colorTokenCssName);
  expect(new Set(names).size).toBe(ids.length);
  for (const name of names) expect(name).toMatch(/^--diagra-color-[0-9a-f-]+$/);
});

test("measurement handoff emits safe variables and linked numeric CSS", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 80 },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  const token = createNumberToken(editor, "Card radius", 12);
  if (!token) throw new Error("missing token");
  editor.selection.set([shape.id]);
  bindSelectionNumber(editor, "cornerRadius", token);
  const variables = measurementHandoff(editor);
  expect(variables.css).toContain(`${numberTokenCssName(token)}: 12px;`);
  const report = inspectDesign(editor, shape.id);
  expect(report?.css).toContain("border-radius: 12px;");
  expect(report?.linkedCss).toContain(
    `border-radius: var(${numberTokenCssName(token)}, 12px);`,
  );
  expect(report?.measurements.tokens[0]?.name).toBe("Card radius");
});

test("layout handoff links gap and padding with literal fallbacks", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Stack",
      memberIds: [],
      layout: {
        direction: "vertical",
        gap: 8,
        padding: 8,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 0, y: 0, width: 200, height: 200 },
  });
  editor.apply([{ type: "createElement", element: frame }]);
  const token = createNumberToken(editor, "Space", 16);
  if (!token) throw new Error("missing token");
  editor.selection.set([frame.id]);
  bindSelectionNumber(editor, "gap", token);
  bindSelectionNumber(editor, "padding", token);
  const layout = inspectDesign(editor, frame.id)?.layout;
  expect(layout?.css).toContain("gap: 16px;");
  expect(layout?.linkedCss).toContain(
    `gap: var(${numberTokenCssName(token)}, 16px);`,
  );
  expect(
    layout?.linkedCss.match(new RegExp(numberTokenCssName(token), "g")),
  ).toHaveLength(5);
});

test("palette exports stable variables without interpolating names and remains read-only", () => {
  const editor = makeEditor();
  const token = createColorToken(editor, "*/}body{color:red}", "#123456");
  if (!token) throw new Error("missing token");
  const before = JSON.stringify(editor.getSnapshot());
  const revision = editor.revision;
  const report = paletteHandoff(editor);
  expect(report.css).toContain(`${colorTokenCssName(token)}: #123456;`);
  expect(report.css).not.toContain("body");
  expect(report.tokens[0]?.name).toBe("*/}body{color:red}");
  expect(JSON.stringify(editor.getSnapshot())).toBe(before);
  expect(editor.revision).toBe(revision);
  updateColorToken(editor, token, "Renamed", "#abcdef");
  expect(paletteHandoff(editor).tokens[0]?.cssVariable).toBe(
    report.tokens[0]?.cssVariable,
  );
});

test("handoff offers linked declarations and preserves literal export and missing-token fallbacks", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  const token = createColorToken(editor, "Brand", "#123456");
  if (!token) throw new Error("missing token");
  editor.selection.set([shape.id]);
  bindSelectionColor(editor, "fill", token);
  const report = inspectDesign(editor, shape.id);
  expect(report?.css).toContain("background-color: #123456;");
  expect(report?.linkedCss).toContain(
    `background-color: var(${colorTokenCssName(token)}, #123456);`,
  );
  editor.apply([
    { type: "updateVisual", id: shape.id, visual: { locked: true } },
  ]);
  editor.deleteElements([token]);
  const missing = inspectDesign(editor, shape.id);
  expect(missing?.linkedCss).toContain("background-color: #123456;");
  expect(missing?.linkedCss).not.toContain("var(");
});

test("handoff identifies the page mode and retains alias/mode metadata", () => {
  const editor = makeEditor();
  const base = createColorToken(editor, "Blue", "#2563eb");
  const action = createColorToken(editor, "Action", "#64748b");
  if (!base || !action) throw new Error("missing token");
  setColorTokenAlias(editor, action, base);
  editor.setPageTokenMode(editor.currentPageId, "Dark");
  updateColorToken(editor, base, "Blue", "#60a5fa");
  const handoff = paletteHandoff(editor);
  expect(handoff.mode).toBe("Dark");
  expect(handoff.availableModes).toEqual(["Dark"]);
  expect(handoff.css).toContain(`${colorTokenCssName(action)}: #60a5fa;`);
  expect(handoff.tokens.find((token) => token.id === action)).toMatchObject({
    baseValue: "#64748b",
    value: "#60a5fa",
    aliasId: base,
    broken: false,
  });
  expect(handoff.tokens.find((token) => token.id === base)?.modes).toEqual([
    { name: "Dark", value: "#60a5fa" },
  ]);
});
