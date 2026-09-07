import { expect, test } from "bun:test";
import type { FrameSemantic, LayerEffect } from "@diagra/ir";
import { componentOverrides } from "./component-overrides.ts";
import { makeEditor } from "./test-helpers.ts";

const sourceEffects = [
  {
    type: "drop-shadow",
    x: 0,
    y: 4,
    blur: 8,
    color: "#000000",
    opacity: 0.25,
  },
] satisfies readonly LayerEffect[];

const changedEffects = [
  ...sourceEffects,
  { type: "layer-blur", blur: 2 },
] satisfies readonly LayerEffect[];

test("effect stacks inherit, survive local override and reset to the component", () => {
  const editor = makeEditor();
  const child = editor.buildElement("node.generic", {
    visual: { style: { effects: sourceEffects } },
  });
  const source = editor.buildElement("frame", {
    semantic: { name: "Card", component: true, memberIds: [child.id] },
  });
  editor.apply([
    { type: "createElement", element: source },
    { type: "createElement", element: child },
  ]);
  const instance = editor.createComponentInstance(source.id);
  if (!instance) throw new Error("missing instance");
  const target = (editor.store.get(instance)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target) throw new Error("missing target");

  editor.selection.set([child.id]);
  editor.setSelectionStyle({ effects: changedEffects });
  expect(editor.refreshComponentInstance(instance)).toBe(true);
  expect(editor.store.get(target)?.visual.style?.effects).toEqual(
    changedEffects,
  );

  editor.selection.set([target]);
  editor.setSelectionStyle({ effects: [] });
  expect(
    componentOverrides(editor, target).map((item) => item.field),
  ).toContain("style.effects");
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(target)?.visual.style?.effects).toEqual([]);
  expect(editor.resetComponentOverride(instance, target, "style.effects")).toBe(
    true,
  );
  expect(editor.store.get(target)?.visual.style?.effects).toEqual(
    changedEffects,
  );
  expect(componentOverrides(editor, target)).toEqual([]);
});
