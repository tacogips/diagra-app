import { expect, test } from "bun:test";
import { Editor } from "./editor.ts";
import {
  bindSelectionNumber,
  createNumberToken,
  updateNumberToken,
} from "./number-tokens.ts";
import {
  canPasteSelectionStyle,
  copySelectionStyle,
  pasteSelectionStyle,
} from "./style-clipboard.ts";

test("style paste copies appearance without content or geometry and undoes atomically", () => {
  const editor = new Editor();
  const source = editor.createElement("node.generic", {
    semantic: { label: "Source" },
    visual: { style: { fill: "#123456", strokeWidth: 3, opacity: 0.5 } },
  });
  const target = editor.createElement("node.generic", {
    semantic: { label: "Target" },
    visual: {
      x: 400,
      y: 60,
      width: 90,
      height: 40,
      style: { fill: "#ffffff", fontSize: 20 },
    },
  });
  const locked = editor.createElement("node.generic", {
    visual: { locked: true },
  });
  editor.selection.set([source]);
  expect(copySelectionStyle(editor)).toBe(true);
  // Clipboard snapshots are detached from subsequent source edits.
  editor.setSelectionStyle({ fill: "#abcdef" });
  const before = editor.getSnapshot();
  editor.selection.set([target, locked]);
  expect(pasteSelectionStyle(editor)).toBe(true);
  expect(editor.store.get(target)?.visual).toMatchObject({
    x: 400,
    y: 60,
    width: 90,
    height: 40,
    style: { fill: "#123456", strokeWidth: 3, opacity: 0.5 },
  });
  expect(editor.store.get(target)?.visual.style?.fontSize).toBeUndefined();
  expect(editor.store.get(target)?.semantic).toEqual({ label: "Target" });
  expect(editor.store.get(locked)?.visual.style).toBeUndefined();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  expect(pasteSelectionStyle(new Editor())).toBe(false);
});

test("style paste detaches appearance tokens but retains dimension bindings", () => {
  const editor = new Editor();
  const widthToken = createNumberToken(editor, "Card width", 200);
  const strokeToken = createNumberToken(editor, "Border", 2);
  if (!widthToken || !strokeToken) throw new Error("Missing tokens");
  const source = editor.createElement("node.generic", {
    visual: { style: { strokeWidth: 5 } },
  });
  const target = editor.createElement("node.generic");
  editor.selection.set([target]);
  bindSelectionNumber(editor, "width", widthToken);
  bindSelectionNumber(editor, "strokeWidth", strokeToken);
  editor.selection.set([source]);
  copySelectionStyle(editor);
  editor.selection.set([target]);
  pasteSelectionStyle(editor);
  expect(editor.store.get(target)?.visual.numberTokens).toEqual({
    width: widthToken,
  });
  updateNumberToken(editor, strokeToken, "Border", 8);
  updateNumberToken(editor, widthToken, "Card width", 240);
  expect(editor.store.get(target)?.visual.style?.strokeWidth).toBe(5);
  expect(editor.getBounds(target)?.width).toBe(240);
});

test("copying an unstyled layer clears custom style and repeated paste is disabled", () => {
  const editor = new Editor();
  const source = editor.createElement("node.generic");
  const target = editor.createElement("node.generic", {
    visual: { style: { fill: "#123456" } },
  });
  editor.selection.set([source]);
  expect(copySelectionStyle(editor)).toBe(true);
  editor.selection.set([target]);
  expect(canPasteSelectionStyle(editor)).toBe(true);
  expect(pasteSelectionStyle(editor)).toBe(true);
  expect(editor.store.get(target)?.visual.style).toBeUndefined();
  expect(canPasteSelectionStyle(editor)).toBe(false);
  expect(pasteSelectionStyle(editor)).toBe(false);
  editor.undo();
  expect(editor.store.get(target)?.visual.style?.fill).toBe("#123456");
});
