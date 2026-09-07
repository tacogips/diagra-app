import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { componentOverrides } from "./component-overrides.ts";
import {
  bindSelectionNumber,
  createNumberToken,
  updateNumberToken,
} from "./number-tokens.ts";
import { makeEditor } from "./test-helpers.ts";
import { insertUiBlock } from "./ui-blocks.ts";

function setup() {
  const editor = makeEditor();
  const source = insertUiBlock(editor, "button", { x: 0, y: 0 });
  const compact = createNumberToken(editor, "Compact", 120);
  const spacious = createNumberToken(editor, "Spacious", 240);
  if (!compact || !spacious) throw new Error("missing tokens");
  editor.selection.set([source]);
  bindSelectionNumber(editor, "width", compact);
  const instance = editor.createComponentInstance(source);
  if (!instance) throw new Error("missing instance");
  return { editor, source, instance, compact, spacious };
}

test("component refresh inherits source measurement bindings", () => {
  const { editor, source, instance, spacious } = setup();
  editor.selection.set([source]);
  bindSelectionNumber(editor, "width", spacious);
  expect(editor.refreshComponentInstance(instance)).toBe(true);
  expect(editor.store.get(instance)?.visual.numberTokens?.width).toBe(spacious);
  expect(editor.getBounds(instance)?.width).toBe(240);
  expect(componentOverrides(editor, instance)).toEqual([]);
});

test("local measurement bindings survive refresh and can reset to the source", () => {
  const { editor, source, instance, compact, spacious } = setup();
  editor.selection.set([source]);
  bindSelectionNumber(editor, "width", spacious);
  editor.refreshComponentInstance(instance);
  editor.selection.set([instance]);
  bindSelectionNumber(editor, "width", compact);
  expect(
    componentOverrides(editor, instance).map((item) => item.field),
  ).toContain("measurement.width");
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(instance)?.visual.numberTokens?.width).toBe(compact);
  expect(
    editor.resetComponentOverride(instance, instance, "measurement.width"),
  ).toBe(true);
  expect(editor.store.get(instance)?.visual.numberTokens?.width).toBe(spacious);
  expect(editor.getBounds(instance)?.width).toBe(240);
});

test("numeric style bindings use ordinary component style override reset", () => {
  const { editor, source, instance, compact, spacious } = setup();
  editor.selection.set([source]);
  bindSelectionNumber(editor, "cornerRadius", spacious);
  editor.refreshComponentInstance(instance);
  editor.selection.set([instance]);
  bindSelectionNumber(editor, "cornerRadius", compact);
  expect(
    componentOverrides(editor, instance).map((item) => item.field),
  ).toContain("style.cornerRadius");
  expect(
    editor.resetComponentOverride(instance, instance, "style.cornerRadius"),
  ).toBe(true);
  expect(editor.store.get(instance)?.visual.numberTokens?.cornerRadius).toBe(
    spacious,
  );
  expect(editor.store.get(instance)?.visual.style?.cornerRadius).toBe(240);
});

test("automatic component refresh propagates new measurement identities", () => {
  const { editor, source, instance, spacious } = setup();
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
  bindSelectionNumber(editor, "width", spacious);
  expect(editor.store.get(instance)?.visual.numberTokens?.width).toBe(spacious);
  expect(editor.getBounds(instance)?.width).toBe(240);
  updateNumberToken(editor, spacious, "Spacious", 260);
  expect(editor.getBounds(instance)?.width).toBe(260);
});

test("variant switches inherit source measurements and retain local bindings", () => {
  const { editor, source, instance, compact, spacious } = setup();
  const variant = insertUiBlock(editor, "button", { x: 0, y: 200 });
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
  editor.selection.set([variant]);
  bindSelectionNumber(editor, "width", spacious);
  expect(editor.switchComponentVariant(instance, variant)).toBe(true);
  expect(editor.store.get(instance)?.visual.numberTokens?.width).toBe(spacious);
  editor.selection.set([instance]);
  bindSelectionNumber(editor, "width", compact);
  expect(editor.switchComponentVariant(instance, source)).toBe(true);
  expect(editor.store.get(instance)?.visual.numberTokens?.width).toBe(compact);
  expect(editor.getBounds(instance)?.width).toBe(120);
});
