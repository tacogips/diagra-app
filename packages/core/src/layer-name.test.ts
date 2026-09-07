import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { layerName, renameLayer } from "./layer-name.ts";
import { makeEditor, document, erdFixture } from "./test-helpers.ts";

test("layer names preserve database semantics and export appearance with undo", () => {
  const editor = makeEditor({ document: document(erdFixture()) });
  const original = editor.store.get("users");
  if (!original) throw new Error("missing table");
  const svg = editor.exportPageSvg();
  expect(renameLayer(editor, "users", " Account model ")).toBe(true);
  const renamed = editor.store.get("users");
  if (!renamed) throw new Error("missing table");
  expect(layerName(renamed)).toBe("Account model");
  expect(renamed.semantic).toEqual(original.semantic);
  expect(editor.exportPageSvg()).toBe(svg);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.undo();
  expect(editor.store.get("users")).toEqual(original);
  editor.redo();
  expect(editor.store.get("users")?.visual.layerName).toBe("Account model");
});

test("clearing a layer name restores the semantic label and locked layers stay unchanged", () => {
  const editor = makeEditor({ document: document(erdFixture()) });
  renameLayer(editor, "users", "Account model");
  expect(renameLayer(editor, "users", "Account model")).toBe(false);
  renameLayer(editor, "users", "  ");
  const cleared = editor.store.get("users");
  if (!cleared) throw new Error("missing table");
  expect(cleared.visual.layerName).toBeUndefined();
  expect(layerName(cleared)).toBe("users");
  editor.apply([
    { type: "updateVisual", id: "users", visual: { locked: true } },
  ]);
  expect(renameLayer(editor, "users", "Locked name")).toBe(false);
  expect(renameLayer(editor, "missing", "Name")).toBe(false);
});

test("nonsemantic shapes can have names without visible text changes", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  renameLayer(editor, shape.id, "Hero background");
  expect(editor.store.get(shape.id)?.semantic).toEqual(shape.semantic);
  editor.selection.set([shape.id]);
  editor.duplicateSelection();
  const copy = [...editor.selection.ids()][0];
  expect(editor.store.get(copy ?? "")?.visual.layerName).toBe(
    "Hero background",
  );
});
