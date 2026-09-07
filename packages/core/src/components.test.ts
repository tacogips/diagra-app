import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { makeEditor } from "./test-helpers.ts";
import { insertUiBlock } from "./ui-blocks.ts";
import {
  bindSelectionColor,
  createColorToken,
  updateColorToken,
} from "./color-tokens.ts";

test("duplicating an instance preserves shared resources and source tracking", () => {
  const editor = makeEditor();
  const source = insertUiBlock(editor, "button", { x: 0, y: 0 });
  const token = createColorToken(editor, "Brand", "#123456");
  if (!token) throw new Error("missing token");
  editor.selection.set([source]);
  bindSelectionColor(editor, "fill", token);
  const instance = editor.createComponentInstance(source, { x: 300, y: 0 });
  if (!instance) throw new Error("missing instance");
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
  editor.selection.set([instance]);
  const copies = editor.duplicateSelection();
  const duplicate = copies.find((id) => editor.store.get(id)?.type === "frame");
  if (!duplicate) throw new Error("missing duplicate");
  const duplicateSemantic = editor.store.get(duplicate)
    ?.semantic as FrameSemantic;
  expect(duplicateSemantic.instanceOf).toBe(source);
  expect(editor.store.get(duplicate)?.visual.colorTokens?.fill).toBe(token);
  const label = duplicateSemantic.memberIds?.[0];
  const sourceLabel = (editor.store.get(source)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!label || !sourceLabel) throw new Error("missing labels");
  expect(
    duplicateSemantic.instanceBindings?.some(
      (binding) => binding.source === sourceLabel && binding.target === label,
    ),
  ).toBe(true);
  const saved = serializeDocument(editor.getSnapshot());
  editor.undo();
  expect(copies.every((id) => !editor.store.has(id))).toBe(true);
  editor.redo();
  expect(serializeDocument(editor.getSnapshot())).toBe(saved);
  editor.setText(sourceLabel, "Updated source");
  expect(editor.getText(label)).toBe("Updated source");
  editor.setText(label, "Copy override");
  editor.setText(sourceLabel, "Another update");
  expect(editor.getText(label)).toBe("Copy override");
  updateColorToken(editor, token, "Brand", "#abcdef");
  expect(editor.store.get(duplicate)?.visual.style?.fill).toBe("#abcdef");
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});

test("library insertion onto another page places nested content at the requested origin", () => {
  const editor = makeEditor();
  const originalPage = editor.currentPageId;
  const child = editor.buildElement("text.note", {
    semantic: { text: "Library label" },
    visual: { x: 520, y: 520, width: 100, height: 40 },
  });
  const source = editor.buildElement("frame", {
    semantic: {
      name: "Library source",
      component: true,
      memberIds: [child.id],
    },
    visual: { x: 500, y: 500, width: 140, height: 80 },
  });
  editor.apply([
    { type: "createElement", element: child },
    { type: "createElement", element: source },
  ]);
  editor.createPage({ name: "Product screen" });
  const destination = editor.currentPageId;
  expect(destination).not.toBe(originalPage);
  const instance = editor.createComponentInstance(source.id, { x: 40, y: 60 });
  if (!instance) throw new Error("expected instance");
  const copy = editor.store.get(instance);
  expect(copy?.page).toBe(destination);
  expect(copy?.visual.x).toBe(40);
  expect(copy?.visual.y).toBe(60);
  const member = (copy?.semantic as FrameSemantic).memberIds?.[0];
  expect(editor.store.get(member ?? "")?.page).toBe(destination);
  expect(editor.store.get(member ?? "")?.visual.x).toBe(60);
  expect(editor.store.get(source.id)?.visual.x).toBe(500);
  editor.undo();
  expect(editor.store.has(instance)).toBe(false);
  expect(editor.store.has(source.id)).toBe(true);
  editor.redo();
  expect(editor.store.has(instance)).toBe(true);
});

test("component instances copy content, reset from source, detach and undo", () => {
  const editor = makeEditor();
  const child = editor.buildElement("text.note", {
    semantic: { text: "Button" },
    visual: { x: 20, y: 20, width: 100, height: 40 },
  });
  const source = editor.buildElement("frame", {
    semantic: { name: "Button component", memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 140, height: 80 },
  });
  editor.apply([
    { type: "createElement", element: child },
    { type: "createElement", element: source },
  ]);
  expect(editor.makeComponent(source.id)).toBe(true);
  const id = editor.createComponentInstance(source.id);
  if (!id) throw new Error("expected instance");
  const instance = editor.store.get(id);
  expect((instance?.semantic as FrameSemantic).instanceOf).toBe(source.id);
  const copyChild = (instance?.semantic as FrameSemantic).memberIds?.[0];
  expect(copyChild).not.toBe(child.id);
  const x = instance?.visual.x;
  editor.setText(child.id, "Changed");
  expect(editor.resetComponentInstance(id)).toBe(true);
  const updatedChild = (editor.store.get(id)?.semantic as FrameSemantic)
    .memberIds?.[0];
  expect(editor.store.get(updatedChild ?? "")?.semantic).toEqual({
    text: "Changed",
  });
  expect(editor.store.get(id)?.visual.x).toBe(x);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  expect(editor.detachComponentInstance(id)).toBe(true);
  expect(
    (editor.store.get(id)?.semantic as FrameSemantic).instanceOf,
  ).toBeUndefined();
  editor.undo();
  expect((editor.store.get(id)?.semantic as FrameSemantic).instanceOf).toBe(
    source.id,
  );
});

test("deleting source detaches surviving instances without deleting their content", () => {
  const editor = makeEditor();
  const source = editor.buildElement("frame", {
    semantic: { name: "Source", component: true, memberIds: [] },
  });
  editor.apply([{ type: "createElement", element: source }]);
  const id = editor.createComponentInstance(source.id);
  if (!id) throw new Error("expected instance");
  editor.deleteElements([source.id]);
  expect(editor.store.has(id)).toBe(true);
  expect(
    (editor.store.get(id)?.semantic as FrameSemantic).instanceOf,
  ).toBeUndefined();
});
