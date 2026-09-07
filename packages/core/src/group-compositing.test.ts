import { expect, test } from "bun:test";
import type { GroupSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { generateInterfaceCode } from "./interface-code.ts";
import { generateMobileInterfaceCode } from "./mobile-code.ts";
import { prototypeScreen } from "./prototype.ts";
import { makeEditor } from "./test-helpers.ts";

test("isolated groups composite their ordered children as one export layer", () => {
  const editor = makeEditor();
  const back = editor.buildElement("shape.geo", {
    id: "group-back",
    semantic: { geo: "rect", label: "Back" },
    visual: {
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      style: { fill: "#ef4444" },
    },
  });
  const front = editor.buildElement("shape.geo", {
    id: "group-front",
    semantic: { geo: "ellipse", label: "Front" },
    visual: {
      x: 60,
      y: 40,
      width: 120,
      height: 80,
      style: { fill: "#3b82f6" },
    },
  });
  const group = editor.buildElement("group", {
    id: "composite-group",
    semantic: { memberIds: [back.id, front.id], isolate: true },
    visual: { style: { opacity: 0.4, blendMode: "multiply" } },
  });
  const frame = editor.buildElement("frame", {
    id: "composite-frame",
    semantic: { name: "Composite", memberIds: [group.id] },
    visual: { x: 0, y: 0, width: 240, height: 160 },
  });
  editor.apply(
    [frame, group, back, front].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );

  const screen = prototypeScreen(editor, frame.id);
  expect(new Set(screen?.elements.map((element) => element.id))).toEqual(
    new Set([frame.id, group.id, back.id, front.id]),
  );

  const svg = editor.exportPageSvg({ padding: 0 });
  const groupAt = svg?.indexOf('data-id="composite-group"') ?? -1;
  const backAt = svg?.indexOf('data-id="group-back"') ?? -1;
  const frontAt = svg?.indexOf('data-id="group-front"') ?? -1;
  expect(groupAt).toBeGreaterThan(-1);
  expect(backAt).toBeGreaterThan(groupAt);
  expect(frontAt).toBeGreaterThan(backAt);
  expect(svg).toContain('opacity="0.4"');
  expect(svg).toContain("mix-blend-mode: multiply;");
  expect(svg).toContain("isolation: isolate;");

  const web = generateInterfaceCode(editor, frame.id);
  expect(web?.css).toContain("opacity: 0.4;");
  expect(web?.css).toContain("mix-blend-mode: multiply;");
  expect(web?.css).toContain("isolation: isolate;");
  const native = generateMobileInterfaceCode(editor, frame.id);
  expect(native?.swiftUi).toContain(".opacity(0.4)");
  expect(native?.swiftUi).toContain(".blendMode(.multiply)");
  expect(native?.jetpackCompose).toContain(".alpha(0.4f)");
  expect(native?.jetpackCompose).toContain("BlendMode.Multiply");

  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(saved.indexOf('"memberIds"')).toBeLessThan(saved.indexOf('"isolate"'));

  editor.apply([
    {
      type: "updateSemantic",
      id: group.id,
      semantic: { memberIds: [back.id, front.id] },
    },
    { type: "replaceVisual", id: group.id, visual: {} },
  ]);
  editor.undo();
  expect((editor.store.get(group.id)?.semantic as GroupSemantic).isolate).toBe(
    true,
  );
  expect(editor.store.get(group.id)?.visual.style).toEqual({
    opacity: 0.4,
    blendMode: "multiply",
  });
});
