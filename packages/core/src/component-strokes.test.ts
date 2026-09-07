import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { componentOverrides } from "./component-overrides.ts";
import { makeEditor } from "./test-helpers.ts";

test("stroke geometry inherits, overrides and resets through components", () => {
  const editor = makeEditor();
  const child = editor.buildElement("shape.geo", {
    visual: {
      style: {
        strokeCap: "round",
        strokeJoin: "round",
        strokeMiterLimit: 4,
      },
    },
  });
  const source = editor.buildElement("frame", {
    semantic: { name: "Icon", component: true, memberIds: [child.id] },
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
  editor.setSelectionStyle({
    strokeCap: "square",
    strokeJoin: "bevel",
    strokeMiterLimit: 8,
  });
  expect(editor.refreshComponentInstance(instance)).toBe(true);
  expect(editor.store.get(target)?.visual.style).toMatchObject({
    strokeCap: "square",
    strokeJoin: "bevel",
    strokeMiterLimit: 8,
  });

  editor.selection.set([target]);
  editor.setSelectionStyle({ strokeJoin: "round" });
  expect(
    componentOverrides(editor, target).map((override) => override.field),
  ).toContain("style.strokeJoin");
  expect(
    editor.resetComponentOverride(instance, target, "style.strokeJoin"),
  ).toBe(true);
  expect(editor.store.get(target)?.visual.style?.strokeJoin).toBe("bevel");
});
