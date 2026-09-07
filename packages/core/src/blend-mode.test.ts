import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { componentOverrides } from "./component-overrides.ts";
import { inspectDesign } from "./handoff.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { generateMobileInterfaceCode } from "./mobile-code.ts";
import { makeEditor } from "./test-helpers.ts";

test("blend modes persist, export and undo as one layer style field", () => {
  const editor = makeEditor();
  const layer = editor.buildElement("shape.geo", {
    semantic: { geo: "ellipse", label: "Glow" },
    visual: {
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      style: { fill: "#2563eb", opacity: 0.8 },
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Blend", memberIds: [layer.id] },
    visual: { x: 0, y: 0, width: 200, height: 200 },
  });
  editor.apply([
    { type: "createElement", element: frame },
    { type: "createElement", element: layer },
  ]);
  editor.selection.set([layer.id]);
  expect(editor.setSelectionStyle({ blendMode: "color-dodge" })).toBe(true);
  expect(inspectDesign(editor, layer.id)?.css).toContain(
    "mix-blend-mode: color-dodge;",
  );
  expect(editor.exportPageSvg()).toContain(
    'style="mix-blend-mode: color-dodge;"',
  );
  expect(generateInterfaceCode(editor, frame.id)?.css).toContain(
    "mix-blend-mode: color-dodge;",
  );
  const native = generateMobileInterfaceCode(editor, frame.id);
  expect(native?.swiftUi).toContain(".blendMode(.colorDodge)");
  expect(native?.jetpackCompose).toContain(
    ".graphicsLayer { blendMode = BlendMode.ColorDodge }",
  );
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(saved.indexOf('"opacity"')).toBeLessThan(saved.indexOf('"blendMode"'));
  editor.undo();
  expect(editor.store.get(layer.id)?.visual.style).toEqual({
    fill: "#2563eb",
    opacity: 0.8,
  });
});

test("component blend modes inherit, preserve overrides and reset", () => {
  const editor = makeEditor();
  const child = editor.buildElement("node.generic", {
    visual: { style: { blendMode: "multiply" } },
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
  expect(editor.store.get(target)?.visual.style?.blendMode).toBe("multiply");

  editor.selection.set([target]);
  editor.setSelectionStyle({ blendMode: "screen" });
  expect(
    componentOverrides(editor, target).map((item) => item.field),
  ).toContain("style.blendMode");
  editor.selection.set([child.id]);
  editor.setSelectionStyle({ blendMode: "overlay" });
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(target)?.visual.style?.blendMode).toBe("screen");
  expect(
    editor.resetComponentOverride(instance, target, "style.blendMode"),
  ).toBe(true);
  expect(editor.store.get(target)?.visual.style?.blendMode).toBe("overlay");
});
