import { expect, test } from "bun:test";
import {
  parseDocument,
  parseDocumentResult,
  serializeDocument,
} from "@diagra/io";
import {
  bindSelectionNumber,
  createNumberToken,
  numberTokens,
  selectionNumberBindings,
  setNumberTokenAlias,
  updateNumberToken,
} from "./number-tokens.ts";
import { resolveNumberToken } from "./token-values.ts";
import type { FrameSemantic } from "@diagra/ir";
import { componentOverrides } from "./component-overrides.ts";
import { inspectDesign } from "./handoff.ts";
import { numberTokenCssName } from "./token-handoff.ts";
import { copyElements, planPaste } from "./clipboard.ts";
import { counterIds, document, element, makeEditor } from "./test-helpers.ts";

test("measurement resources are portable, validated and undoable", () => {
  const editor = makeEditor();
  const id = createNumberToken(editor, " Space medium ", 16);
  if (!id) throw new Error("missing token");
  expect(numberTokens(editor)[0]).toMatchObject({
    id,
    name: "Space medium",
    kind: "number",
    value: 16,
  });
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(updateNumberToken(editor, id, "Space large", 24)).toBe(true);
  editor.undo();
  expect(serializeDocument(editor.getSnapshot())).toBe(saved);
  expect(createNumberToken(editor, "Bad", -1)).toBeNull();
  expect(updateNumberToken(editor, id, "Bad", Number.NaN)).toBe(false);
  expect(
    parseDocumentResult(saved.replace('"value":16', '"value":-1')).ok,
  ).toBe(false);
});

test("one token drives size, radius and typography and direct style edits detach", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "shape",
        type: "shape.geo",
        semantic: { kind: "rectangle" },
        visual: { x: 0, y: 0, width: 100, height: 80, style: {} },
      }),
    ]),
  });
  const id = createNumberToken(editor, "Scale", 24);
  if (!id) throw new Error("missing token");
  editor.selection.set(["shape"]);
  for (const field of ["width", "cornerRadius", "fontSize"] as const)
    expect(bindSelectionNumber(editor, field, id)).toBe(true);
  expect(editor.getBounds("shape")?.width).toBe(24);
  expect(editor.store.get("shape")?.visual.style).toMatchObject({
    cornerRadius: 24,
    fontSize: 24,
  });
  expect(updateNumberToken(editor, id, "Scale", 32)).toBe(true);
  expect(editor.getBounds("shape")?.width).toBe(32);
  expect(editor.store.get("shape")?.visual.style?.fontSize).toBe(32);
  editor.setSelectionStyle({ fontSize: 18 });
  expect(
    editor.store.get("shape")?.visual.numberTokens?.fontSize,
  ).toBeUndefined();
  expect(editor.store.get("shape")?.visual.numberTokens?.cornerRadius).toBe(id);
  editor.resizeElement("shape", { x: 0, y: 0, width: 90, height: 80 });
  expect(editor.getBounds("shape")?.width).toBe(90);
  expect(editor.store.get("shape")?.visual.numberTokens?.width).toBeUndefined();
});

test("measurement tokens drive responsive size limits before auto layout", () => {
  const editor = makeEditor();
  const fixed = editor.buildElement("shape.geo", {
    visual: { width: 40, height: 40 },
  });
  const flexible = editor.buildElement("shape.geo", {
    visual: { width: 40, height: 40, layoutGrow: 1 },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Bounded row",
      memberIds: [fixed.id, flexible.id],
      layout: {
        direction: "horizontal",
        gap: 10,
        padding: 0,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { width: 350, height: 80 },
  });
  editor.apply(
    [fixed, flexible, frame].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const token = createNumberToken(editor, "Minimum control width", 280);
  if (!token) throw new Error("missing token");
  editor.selection.set([flexible.id]);
  expect(bindSelectionNumber(editor, "minWidth", token)).toBe(true);
  expect(editor.store.get(flexible.id)?.visual.minWidth).toBe(280);
  expect(editor.getBounds(flexible.id)?.width).toBe(300);
  expect(updateNumberToken(editor, token, "Minimum control width", 320)).toBe(
    true,
  );
  expect(editor.getBounds(flexible.id)?.width).toBe(320);
  expect(inspectDesign(editor, frame.id)?.layout?.linkedCss).toContain(
    `min-width: var(${numberTokenCssName(token)}, 320px);`,
  );
});

test("four measurement tokens drive independent corners and detach separately", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "rect" },
    visual: {
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      style: {
        cornerRadii: {
          topLeft: 1,
          topRight: 2,
          bottomRight: 3,
          bottomLeft: 4,
        },
      },
    },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  const fields = [
    "cornerTopLeft",
    "cornerTopRight",
    "cornerBottomRight",
    "cornerBottomLeft",
  ] as const;
  const tokens = fields.map((field, index) => {
    const token = createNumberToken(editor, field, (index + 1) * 10);
    if (!token) throw new Error("missing token");
    return token;
  });
  editor.selection.set([shape.id]);
  for (const [index, field] of fields.entries())
    expect(bindSelectionNumber(editor, field, tokens[index] ?? null)).toBe(
      true,
    );
  expect(editor.store.get(shape.id)?.visual.style?.cornerRadii).toEqual({
    topLeft: 10,
    topRight: 20,
    bottomRight: 30,
    bottomLeft: 40,
  });
  const bindings = selectionNumberBindings(editor);
  expect(bindings.some((binding) => binding.field === "cornerRadius")).toBe(
    false,
  );
  expect(
    bindings.filter(
      (binding) =>
        binding.field.startsWith("corner") && binding.field !== "cornerRadius",
    ),
  ).toHaveLength(4);
  const linked = inspectDesign(editor, shape.id)?.linkedCss;
  for (const token of tokens)
    expect(linked).toContain(`var(${numberTokenCssName(token)}`);

  editor.setSelectionStyle({
    cornerRadii: {
      topLeft: 15,
      topRight: 20,
      bottomRight: 30,
      bottomLeft: 40,
    },
  });
  expect(
    editor.store.get(shape.id)?.visual.numberTokens?.cornerTopLeft,
  ).toBeUndefined();
  expect(editor.store.get(shape.id)?.visual.numberTokens?.cornerTopRight).toBe(
    tokens[1],
  );
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});

test("component reset restores an overridden per-corner token link", () => {
  const editor = makeEditor();
  const child = editor.buildElement("node.generic", {
    visual: {
      style: {
        cornerRadii: {
          topLeft: 8,
          topRight: 8,
          bottomRight: 8,
          bottomLeft: 8,
        },
      },
    },
  });
  const source = editor.buildElement("frame", {
    semantic: { name: "Token card", component: true, memberIds: [child.id] },
  });
  editor.apply([
    { type: "createElement", element: source },
    { type: "createElement", element: child },
  ]);
  const token = createNumberToken(editor, "Leading radius", 12);
  if (!token) throw new Error("missing token");
  editor.selection.set([child.id]);
  bindSelectionNumber(editor, "cornerTopLeft", token);
  const instance = editor.createComponentInstance(source.id);
  if (!instance) throw new Error("missing instance");
  const target = (editor.store.get(instance)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target) throw new Error("missing target");
  expect(editor.store.get(target)?.visual.numberTokens?.cornerTopLeft).toBe(
    token,
  );
  editor.selection.set([target]);
  editor.setSelectionStyle({
    cornerRadii: {
      topLeft: 28,
      topRight: 8,
      bottomRight: 8,
      bottomLeft: 8,
    },
  });
  expect(
    componentOverrides(editor, target).map((override) => override.field),
  ).toContain("style.cornerRadii");
  expect(
    editor.resetComponentOverride(instance, target, "style.cornerRadii"),
  ).toBe(true);
  expect(editor.store.get(target)?.visual.numberTokens?.cornerTopLeft).toBe(
    token,
  );
  expect(editor.store.get(target)?.visual.style?.cornerRadii?.topLeft).toBe(12);
  updateNumberToken(editor, token, "Leading radius", 18);
  expect(editor.store.get(target)?.visual.style?.cornerRadii?.topLeft).toBe(18);
});

test("layout measurement changes reflow children and deletion keeps literals", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        semantic: {
          name: "Stack",
          memberIds: ["one", "two"],
          layout: {
            direction: "vertical",
            gap: 8,
            padding: 10,
            sizing: "hug",
            align: "start",
          },
        },
        visual: { x: 0, y: 0, width: 200, height: 200 },
      }),
      element({
        id: "one",
        type: "node.generic",
        semantic: { label: "One" },
        visual: { x: 10, y: 10, width: 50, height: 20 },
      }),
      element({
        id: "two",
        type: "node.generic",
        semantic: { label: "Two" },
        visual: { x: 10, y: 38, width: 50, height: 20 },
      }),
    ]),
  });
  const id = createNumberToken(editor, "Stack gap", 12);
  if (!id) throw new Error("missing token");
  editor.selection.set(["frame"]);
  bindSelectionNumber(editor, "gap", id);
  expect(editor.getBounds("two")?.y).toBe(42);
  updateNumberToken(editor, id, "Stack gap", 20);
  expect(editor.getBounds("two")?.y).toBe(50);
  editor.deleteElements([id]);
  expect(editor.store.get("frame")?.visual.numberTokens?.gap).toBeUndefined();
  expect(
    (editor.store.get("frame")?.semantic as { layout: { gap: number } }).layout
      .gap,
  ).toBe(20);
});

test("wrapped line gaps can use measurement tokens", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        semantic: {
          name: "Tags",
          memberIds: ["one", "two"],
          layout: {
            direction: "horizontal",
            gap: 10,
            crossGap: 7,
            wrap: true,
            padding: 20,
            sizing: "fixed",
            align: "start",
          },
        },
        visual: { x: 0, y: 0, width: 170, height: 200 },
      }),
      element({
        id: "one",
        type: "node.generic",
        semantic: { label: "One" },
        visual: { x: 0, y: 0, width: 100, height: 30 },
      }),
      element({
        id: "two",
        type: "node.generic",
        semantic: { label: "Two" },
        visual: { x: 0, y: 0, width: 80, height: 40 },
      }),
    ]),
  });
  const token = createNumberToken(editor, "Line gap", 15);
  if (!token) throw new Error("missing token");
  editor.selection.set(["frame"]);
  expect(bindSelectionNumber(editor, "crossGap", token)).toBe(true);
  expect(editor.getBounds("two")?.y).toBe(65);
  expect(editor.store.get("frame")?.visual.numberTokens?.crossGap).toBe(token);
});

test("locked bindings defer materialization and refresh when unlocked", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  const id = createNumberToken(editor, "Radius", 8);
  if (!id) throw new Error("missing token");
  editor.selection.set([shape.id]);
  bindSelectionNumber(editor, "cornerRadius", id);
  editor.apply([
    { type: "updateVisual", id: shape.id, visual: { locked: true } },
  ]);
  updateNumberToken(editor, id, "Radius", 12);
  expect(
    selectionNumberBindings(editor).find(
      (item) => item.field === "cornerRadius",
    )?.deferred,
  ).toBe(1);
  editor.apply([
    { type: "updateVisual", id: shape.id, visual: { locked: false } },
  ]);
  expect(editor.store.get(shape.id)?.visual.style?.cornerRadius).toBe(12);
});

test("clipboard detaches external measurements and remaps included resources", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  const token = createNumberToken(editor, "Radius", 10);
  if (!token) throw new Error("missing token");
  editor.selection.set([shape.id]);
  bindSelectionNumber(editor, "cornerRadius", token);
  expect(
    copyElements(editor.store, [shape.id]).elements[0]?.visual.numberTokens,
  ).toBeUndefined();
  const payload = copyElements(editor.store, [shape.id, token]);
  const plan = planPaste(payload, {
    page: editor.currentPageId,
    idSource: counterIds("copy"),
    nextIndex: () => editor.nextIndex(),
    offset: { x: 10, y: 10 },
  });
  editor.apply(plan.commands);
  const copiedShape = plan.mapping.get(shape.id) ?? "";
  const copiedToken = plan.mapping.get(token) ?? "";
  expect(editor.store.get(copiedShape)?.visual.numberTokens?.cornerRadius).toBe(
    copiedToken,
  );
  updateNumberToken(editor, copiedToken, "Copy", 18);
  expect(editor.store.get(copiedShape)?.visual.style?.cornerRadius).toBe(18);
  expect(editor.store.get(shape.id)?.visual.style?.cornerRadius).toBe(10);
});

test("measurement aliases honor page modes and reflow auto layout atomically", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        semantic: {
          name: "Stack",
          memberIds: ["one", "two"],
          layout: {
            direction: "vertical",
            gap: 8,
            padding: 0,
            sizing: "fixed",
            align: "start",
          },
        },
        visual: { width: 200, height: 200 },
      }),
      element({
        id: "one",
        type: "node.generic",
        semantic: { label: "One" },
        visual: { x: 0, y: 0, width: 50, height: 20 },
      }),
      element({
        id: "two",
        type: "node.generic",
        semantic: { label: "Two" },
        visual: { x: 0, y: 28, width: 50, height: 20 },
      }),
    ]),
  });
  const base = createNumberToken(editor, "Space base", 8);
  const semantic = createNumberToken(editor, "Stack gap", 12);
  if (!base || !semantic) throw new Error("missing tokens");
  expect(setNumberTokenAlias(editor, semantic, base)).toBe(true);
  editor.selection.set(["frame"]);
  expect(bindSelectionNumber(editor, "gap", semantic)).toBe(true);
  expect(editor.getBounds("two")?.y).toBe(28);

  expect(editor.setPageTokenMode(editor.currentPageId, "Comfortable")).toBe(
    true,
  );
  expect(updateNumberToken(editor, base, "Space base", 24)).toBe(true);
  expect(editor.store.getPage(editor.currentPageId)?.tokenMode).toBe(
    "Comfortable",
  );
  expect(editor.store.get(base)?.semantic).toMatchObject({
    modes: [{ name: "Comfortable", value: 24 }],
  });
  expect(
    resolveNumberToken(editor.store, semantic, editor.currentPageId)?.value,
  ).toBe(24);
  expect(
    (editor.store.get("frame")?.semantic as { layout: { gap: number } }).layout
      .gap,
  ).toBe(24);
  expect(editor.getBounds("two")?.y).toBe(44);
  expect(
    numberTokens(editor).find((token) => token.id === semantic),
  ).toMatchObject({ value: 24, aliasId: base, broken: false });
  expect(setNumberTokenAlias(editor, semantic, null)).toBe(true);
  expect(editor.getBounds("two")?.y).toBe(44);
  editor.setPageTokenMode(editor.currentPageId, null);
  expect(editor.getBounds("two")?.y).toBe(28);
});
