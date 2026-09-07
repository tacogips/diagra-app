import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { insertUiBlock, UI_BLOCKS } from "./ui-blocks.ts";
import { makeEditor } from "./test-helpers.ts";
import { compareFractional } from "./fractional.ts";

for (const kind of UI_BLOCKS)
  test(`${kind} UI block is editable, reusable and undoable`, () => {
    const editor = makeEditor();
    const id = insertUiBlock(editor, kind, { x: 100, y: 200 });
    const frame = editor.store.get(id);
    const semantic = frame?.semantic as FrameSemantic;
    expect(semantic.component).toBe(true);
    expect(semantic.showTitle).toBe(false);
    expect(semantic.layout).toBeDefined();
    expect(frame?.visual.x).toBe(100);
    const bounds = editor.getBounds(id);
    if (!bounds) throw new Error("missing frame bounds");
    const keys: string[] = [];
    for (const childId of semantic.memberIds ?? []) {
      const child = editor.store.get(childId);
      const box = editor.getBounds(childId);
      if (!child || !box || !child.visual.componentKey)
        throw new Error("missing editable child");
      keys.push(child.visual.componentKey);
      expect(
        compareFractional(child.index, frame?.index ?? ""),
      ).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect(editor.exportPageSvg()).not.toContain(`>${semantic.name}</text>`);
    expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
      editor.getSnapshot(),
    );
    editor.undo();
    expect(editor.getSnapshot().elements).toHaveLength(0);
    editor.redo();
    const instance = editor.createComponentInstance(id);
    expect(instance).not.toBeNull();
  });
