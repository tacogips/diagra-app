import { expect, test } from "bun:test";
import { assertValidDocument } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { FRAME_PRESETS, safeAreaContentBox } from "./shapes/frame.ts";
import { document, makeEditor } from "./test-helpers.ts";

test("design artboards retain dimensions and names through JSONL and undo", () => {
  const editor = makeEditor();
  for (const preset of Object.values(FRAME_PRESETS)) {
    const frame = editor.buildElement("frame", {
      semantic: {
        name: preset.name,
        platform: preset.platform,
        ...("safeArea" in preset ? { safeArea: preset.safeArea } : {}),
      },
      visual: { x: 10, y: 20, width: preset.width, height: preset.height },
    });
    editor.apply([{ type: "createElement", element: frame }]);
    expect(editor.getBounds(frame.id)).toEqual({
      x: 10,
      y: 20,
      width: preset.width,
      height: preset.height,
    });
    const saved = document([frame]);
    assertValidDocument(saved);
    expect(parseDocument(serializeDocument(saved))).toEqual(saved);
    editor.undo();
    expect(editor.store.get(frame.id)).toBeUndefined();
    editor.redo();
    expect(editor.getBounds(frame.id)?.width).toBe(preset.width);
  }
});

test("frame export escapes names and renders artboard instead of unsupported placeholder", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "<Checkout>",
      platform: "ios",
      safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
    },
  });
  editor.apply([{ type: "createElement", element: frame }]);
  expect(editor.exportPageSvg()).toContain("&lt;Checkout&gt;");
  expect(editor.exportPageSvg()).not.toContain("unsupported");
  expect(editor.exportPageSvg()).not.toContain("safeArea");
  expect(editor.exportPageSvg()).not.toContain("#ec4899");
  const util = editor.getShapeUtil("frame");
  const context = editor.createShapeContext();
  expect(util.hitTest(frame, { x: 100, y: 100 }, context)).toBe(false);
  expect(util.hitTest(frame, { x: 2, y: 100 }, context)).toBe(true);
});

test("device safe areas clamp to a valid content rectangle", () => {
  expect(
    safeAreaContentBox(
      { x: 100, y: 200, width: 390, height: 844 },
      { top: 47, right: 12, bottom: 34, left: 16 },
    ),
  ).toEqual({ x: 116, y: 247, width: 362, height: 763 });
  expect(
    safeAreaContentBox(
      { x: 0, y: 0, width: 100, height: 80 },
      { top: 90, right: 90, bottom: 90, left: 90 },
    ),
  ).toEqual({ x: 90, y: 80, width: 0, height: 0 });
});
