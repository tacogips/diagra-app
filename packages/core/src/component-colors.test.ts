import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import {
  bindSelectionColor,
  createColorToken,
  updateColorToken,
} from "./color-tokens.ts";
import { componentOverrides } from "./component-overrides.ts";
import { insertUiBlock } from "./ui-blocks.ts";
import { makeEditor } from "./test-helpers.ts";

function setup() {
  const editor = makeEditor();
  const source = insertUiBlock(editor, "button", { x: 0, y: 0 });
  const token = createColorToken(editor, "Brand", "#123456");
  const alternate = createColorToken(editor, "Accent", "#abcdef");
  if (!token || !alternate) throw new Error("missing tokens");
  editor.selection.set([source]);
  bindSelectionColor(editor, "fill", token);
  const instance = editor.createComponentInstance(source);
  if (!instance) throw new Error("missing instance");
  return { editor, source, instance, token, alternate };
}

test("component instances retain shared colors and palette edits are not overrides", () => {
  const { editor, instance, token } = setup();
  expect(editor.store.get(instance)?.visual.colorTokens?.fill).toBe(token);
  updateColorToken(editor, token, "Brand", "#998877");
  expect(editor.store.get(instance)?.visual.style?.fill).toBe("#998877");
  expect(componentOverrides(editor, instance)).toEqual([]);
  expect(editor.refreshComponentInstance(instance)).toBe(true);
  expect(componentOverrides(editor, instance)).toEqual([]);
});

test("source binding changes inherit while local token overrides survive and reset", () => {
  const { editor, source, instance, token, alternate } = setup();
  editor.selection.set([source]);
  bindSelectionColor(editor, "fill", alternate);
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(instance)?.visual.colorTokens?.fill).toBe(alternate);
  editor.selection.set([instance]);
  bindSelectionColor(editor, "fill", token);
  expect(
    componentOverrides(editor, instance).map((item) => item.field),
  ).toContain("style.fill");
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(instance)?.visual.colorTokens?.fill).toBe(token);
  expect(editor.resetComponentOverride(instance, instance, "style.fill")).toBe(
    true,
  );
  expect(editor.store.get(instance)?.visual.colorTokens?.fill).toBe(alternate);
  expect(componentOverrides(editor, instance)).toEqual([]);
});

test("same-value literal overrides survive structure updates and full reset relinks", () => {
  const { editor, instance, token } = setup();
  editor.selection.set([instance]);
  editor.setSelectionStyle({ fill: "#123456" });
  expect(
    componentOverrides(editor, instance).map((item) => item.field),
  ).toContain("style.fill");
  expect(editor.updateComponentStructure(instance)).toBe(true);
  expect(editor.store.get(instance)?.visual.colorTokens?.fill).toBeUndefined();
  updateColorToken(editor, token, "Brand", "#998877");
  expect(editor.store.get(instance)?.visual.style?.fill).toBe("#123456");
  expect(editor.resetComponentInstance(instance)).toBe(true);
  expect(editor.store.get(instance)?.visual.colorTokens?.fill).toBe(token);
  expect(editor.store.get(instance)?.visual.style?.fill).toBe("#998877");
});

test("automatic component refresh inherits new source token identities", () => {
  const { editor, source, instance, alternate } = setup();
  editor.apply([
    {
      type: "updateSemantic",
      id: instance,
      semantic: {
        ...(editor.store.get(instance)?.semantic as FrameSemantic),
        autoRefresh: true,
      },
    },
  ]);
  editor.selection.set([source]);
  bindSelectionColor(editor, "fill", alternate);
  expect(editor.store.get(instance)?.visual.colorTokens?.fill).toBe(alternate);
  expect(editor.store.get(instance)?.visual.style?.fill).toBe("#abcdef");
  expect(componentOverrides(editor, instance)).toEqual([]);
});

test("child token links inherit across variant switches and retain local bindings", () => {
  const { editor, source, instance, token, alternate } = setup();
  const variant = insertUiBlock(editor, "button", { x: 0, y: 200 });
  const child = (editor.store.get(source)?.semantic as FrameSemantic)
    .memberIds?.[0];
  const variantChild = (editor.store.get(variant)?.semantic as FrameSemantic)
    .memberIds?.[0];
  const target = (editor.store.get(instance)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!child || !variantChild || !target) throw new Error("missing child");
  for (const id of [source, variant])
    editor.apply([
      {
        type: "updateSemantic",
        id,
        semantic: {
          ...(editor.store.get(id)?.semantic as FrameSemantic),
          variantSet: "Button",
          variantName: id,
        },
      },
    ]);
  editor.selection.set([child]);
  bindSelectionColor(editor, "color", token);
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(target)?.visual.colorTokens?.color).toBe(token);
  editor.selection.set([variantChild]);
  bindSelectionColor(editor, "color", alternate);
  expect(editor.switchComponentVariant(instance, variant)).toBe(true);
  expect(editor.store.get(target)?.visual.colorTokens?.color).toBe(alternate);
  editor.selection.set([target]);
  bindSelectionColor(editor, "color", token);
  expect(editor.switchComponentVariant(instance, source)).toBe(true);
  expect(editor.store.get(target)?.visual.colorTokens?.color).toBe(token);
  updateColorToken(editor, token, "Brand", "#998877");
  expect(editor.store.get(target)?.visual.style?.color).toBe("#998877");
});
