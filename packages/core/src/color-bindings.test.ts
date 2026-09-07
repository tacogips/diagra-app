import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  bindSelectionColor,
  selectionColorBindings,
  createColorToken,
  updateColorToken,
} from "./color-tokens.ts";
import { copyElements, planPaste } from "./clipboard.ts";
import { counterIds, makeEditor } from "./test-helpers.ts";

function setup() {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  const token = createColorToken(editor, "Brand", "#123456");
  if (!token) throw new Error("missing token");
  editor.selection.set([shape.id]);
  expect(bindSelectionColor(editor, "fill", token)).toBe(true);
  return { editor, shape: shape.id, token };
}

test("binding inspection distinguishes linked, unlinked and mixed selections", () => {
  const { editor, shape, token } = setup();
  expect(selectionColorBindings(editor)[0]).toMatchObject({
    field: "fill",
    count: 1,
    editable: 1,
    tokenId: token,
    name: "Brand",
    value: "#123456",
    mixed: false,
    missing: false,
    deferred: 0,
  });
  expect(selectionColorBindings(editor)[1]).toMatchObject({
    tokenId: null,
    mixed: false,
  });
  const second = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: second }]);
  editor.selection.set([shape, second.id]);
  expect(selectionColorBindings(editor)[0]).toMatchObject({
    count: 2,
    editable: 2,
    tokenId: null,
    mixed: true,
  });
  bindSelectionColor(editor, "fill", token);
  expect(selectionColorBindings(editor)[0]).toMatchObject({
    tokenId: token,
    mixed: false,
  });
  editor.selection.set([]);
  expect(selectionColorBindings(editor)[0]).toMatchObject({
    count: 0,
    editable: 0,
  });
});

test("binding inspection exposes locked stale colors and deleted resources", () => {
  const { editor, shape, token } = setup();
  editor.apply([{ type: "updateVisual", id: shape, visual: { locked: true } }]);
  updateColorToken(editor, token, "Brand", "#abcdef");
  expect(selectionColorBindings(editor)[0]).toMatchObject({
    editable: 0,
    deferred: 1,
    value: "#abcdef",
    missing: false,
  });
  editor.deleteElements([token]);
  expect(selectionColorBindings(editor)[0]).toMatchObject({
    editable: 0,
    tokenId: token,
    name: null,
    missing: true,
    deferred: 1,
  });
  editor.apply([
    { type: "updateVisual", id: shape, visual: { locked: false } },
  ]);
  expect(selectionColorBindings(editor)[0]).toMatchObject({
    editable: 1,
    tokenId: null,
    missing: false,
    deferred: 0,
  });
});

test("linked colors propagate, serialize and undo in the source transaction", () => {
  const { editor, shape, token } = setup();
  const before = serializeDocument(editor.getSnapshot());
  updateColorToken(editor, token, "Brand", "#abcdef");
  expect(editor.store.get(shape)?.visual.style?.fill).toBe("#abcdef");
  expect(editor.exportPageSvg()).toContain("#abcdef");
  editor.undo();
  expect(serializeDocument(editor.getSnapshot())).toBe(before);
  editor.redo();
  const reopened = makeEditor({
    document: parseDocument(serializeDocument(editor.getSnapshot())),
  });
  updateColorToken(reopened, token, "Brand", "#998877");
  expect(reopened.store.get(shape)?.visual.style?.fill).toBe("#998877");
});

test("direct style edits detach even when the literal value is unchanged", () => {
  const { editor, shape, token } = setup();
  bindSelectionColor(editor, "stroke", token);
  editor.setSelectionStyle({ fill: "#123456" });
  expect(editor.store.get(shape)?.visual.colorTokens).toEqual({
    stroke: token,
  });
  updateColorToken(editor, token, "Brand", "#abcdef");
  expect(editor.store.get(shape)?.visual.style).toMatchObject({
    fill: "#123456",
    stroke: "#abcdef",
  });
  bindSelectionColor(editor, "stroke", null);
  expect(editor.store.get(shape)?.visual.colorTokens).toBeUndefined();
  expect(editor.store.get(shape)?.visual.style?.stroke).toBe("#abcdef");
});

test("removing a token detaches consumers without losing their last color", () => {
  const { editor, shape, token } = setup();
  editor.deleteElements([token]);
  expect(editor.store.get(shape)?.visual.colorTokens).toBeUndefined();
  expect(editor.store.get(shape)?.visual.style?.fill).toBe("#123456");
  editor.undo();
  expect(editor.store.get(shape)?.visual.colorTokens?.fill).toBe(token);
});

test("locked layers defer token changes until unlocked", () => {
  const { editor, shape, token } = setup();
  editor.apply([{ type: "updateVisual", id: shape, visual: { locked: true } }]);
  updateColorToken(editor, token, "Brand", "#abcdef");
  expect(editor.store.get(shape)?.visual.style?.fill).toBe("#123456");
  expect(bindSelectionColor(editor, "fill", null)).toBe(false);
  editor.apply([
    { type: "updateVisual", id: shape, visual: { locked: false } },
  ]);
  expect(editor.store.get(shape)?.visual.style?.fill).toBe("#abcdef");
});

test("clipboard detaches external tokens and remaps tokens included in a fragment", () => {
  const { editor, shape, token } = setup();
  const alone = copyElements(editor.store, [shape]);
  expect(alone.elements[0]?.visual.colorTokens).toBeUndefined();
  expect(alone.elements[0]?.visual.style?.fill).toBe("#123456");
  const payload = copyElements(editor.store, [shape, token]);
  const plan = planPaste(payload, {
    page: editor.currentPageId,
    idSource: counterIds("copy"),
    nextIndex: () => editor.nextIndex(),
    offset: { x: 10, y: 10 },
  });
  editor.apply(plan.commands);
  const copiedShape = plan.mapping.get(shape) ?? "";
  const copiedToken = plan.mapping.get(token) ?? "";
  expect(editor.store.get(copiedShape)?.visual.colorTokens?.fill).toBe(
    copiedToken,
  );
  updateColorToken(editor, copiedToken, "Copy", "#abcdef");
  expect(editor.store.get(copiedShape)?.visual.style?.fill).toBe("#abcdef");
  expect(editor.store.get(shape)?.visual.style?.fill).toBe("#123456");
});
