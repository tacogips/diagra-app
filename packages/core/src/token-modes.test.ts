import { expect, test } from "bun:test";
import {
  bindSelectionColor,
  createColorToken,
  updateColorToken,
} from "./color-tokens.ts";
import { removeDesignTokenMode, renameDesignTokenMode } from "./token-modes.ts";
import { designTokenModes } from "./token-values.ts";
import { makeEditor, TEST_PAGE } from "./test-helpers.ts";

test("mode rename/removal updates every page and token as one undoable edit", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  const token = createColorToken(editor, "Surface", "#ffffff");
  if (!token) throw new Error("missing token");
  editor.selection.set([shape.id]);
  bindSelectionColor(editor, "fill", token);
  editor.setPageTokenMode(TEST_PAGE.id, "Dark");
  updateColorToken(editor, token, "Surface", "#111827");
  const second = editor.createPage({ name: "Android" });
  editor.setPageTokenMode(second, "Dark");
  editor.setCurrentPage(TEST_PAGE.id);

  expect(renameDesignTokenMode(editor, "Dark", "Night")).toBe(true);
  expect(editor.store.getPage(TEST_PAGE.id)?.tokenMode).toBe("Night");
  expect(editor.store.getPage(second)?.tokenMode).toBe("Night");
  expect(designTokenModes(editor.store)).toEqual(["Night"]);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#111827");
  editor.undo();
  expect(editor.store.getPage(TEST_PAGE.id)?.tokenMode).toBe("Dark");
  expect(editor.store.getPage(second)?.tokenMode).toBe("Dark");
  expect(designTokenModes(editor.store)).toEqual(["Dark"]);

  editor.apply([{ type: "updateVisual", id: token, visual: { locked: true } }]);
  expect(removeDesignTokenMode(editor, "Dark")).toBe(false);
  expect(editor.store.getPage(TEST_PAGE.id)?.tokenMode).toBe("Dark");
  editor.apply([
    { type: "updateVisual", id: token, visual: { locked: false } },
  ]);
  expect(removeDesignTokenMode(editor, "Dark")).toBe(true);
  expect(editor.store.getPage(TEST_PAGE.id)?.tokenMode).toBeUndefined();
  expect(editor.store.getPage(second)?.tokenMode).toBeUndefined();
  expect(designTokenModes(editor.store)).toEqual([]);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#ffffff");
  editor.undo();
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#111827");
  expect(editor.store.getPage(second)?.tokenMode).toBe("Dark");
});

test("mode lifecycle rejects Default, collisions and no-op names", () => {
  const editor = makeEditor();
  editor.setPageTokenMode(TEST_PAGE.id, "Dark");
  const second = editor.createPage({ name: "Second" });
  editor.setPageTokenMode(second, "Android");
  expect(renameDesignTokenMode(editor, "Dark", "Android")).toBe(false);
  expect(renameDesignTokenMode(editor, "Dark", "Default")).toBe(false);
  expect(renameDesignTokenMode(editor, "Dark", "Dark")).toBe(false);
  expect(removeDesignTokenMode(editor, "Default")).toBe(false);
});
