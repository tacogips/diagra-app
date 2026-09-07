import { expect, test } from "bun:test";
import {
  parseDocument,
  parseDocumentResult,
  serializeDocument,
} from "@diagra/io";
import {
  bindSelectionColor,
  colorTokens,
  createColorToken,
  setColorTokenAlias,
  updateColorToken,
} from "./color-tokens.ts";
import { copyElements, planPaste } from "./clipboard.ts";
import {
  counterIds,
  document,
  element,
  makeEditor,
  TEST_PAGE,
} from "./test-helpers.ts";

test("palette resources are normalized, portable and undoable without selection changes", () => {
  const editor = makeEditor();
  const id = createColorToken(editor, " Primary ", "#ABCDEF");
  if (!id) throw new Error("missing token");
  expect(colorTokens(editor)[0]).toMatchObject({
    id,
    name: "Primary",
    value: "#abcdef",
  });
  expect(editor.selection.ids().size).toBe(0);
  expect(editor.getBounds(id)).toBeNull();
  expect(editor.exportPageSvg()).toBeNull();
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(updateColorToken(editor, id, "Accent", "#123456")).toBe(true);
  editor.undo();
  expect(serializeDocument(editor.getSnapshot())).toBe(saved);
  editor.redo();
  expect(colorTokens(editor)[0]?.name).toBe("Accent");
  editor.deleteElements([id]);
  expect(colorTokens(editor)).toEqual([]);
  editor.undo();
  expect(colorTokens(editor)[0]?.name).toBe("Accent");
});

test("palette lookup spans pages and preserves semantic extensions on updates", () => {
  const editor = makeEditor({
    document: document(
      [
        element({
          id: "token",
          type: "design.token",
          page: "library",
          semantic: {
            name: "Primary",
            kind: "color",
            value: "#abcdef",
            custom: { description: "Brand" },
          },
        }),
      ],
      [TEST_PAGE, { id: "library", name: "Library", kind: "freeform" }],
    ),
  });
  expect(colorTokens(editor)).toHaveLength(1);
  expect(updateColorToken(editor, "token", "New", "#123456")).toBe(true);
  expect(editor.store.get("token")?.semantic).toMatchObject({
    custom: { description: "Brand" },
  });
});

test("invalid colors and locked or unrelated elements cannot be updated as tokens", () => {
  const editor = makeEditor();
  for (const [name, value] of [
    ["", "#123456"],
    ["  ", "#123456"],
    ["Brand", "red"],
    ["Brand", "#123"],
    ["Brand", "#12345678"],
  ])
    expect(createColorToken(editor, name ?? "", value ?? "")).toBeNull();
  const id = createColorToken(editor, "Brand", "#123456");
  if (!id) throw new Error("missing token");
  expect(updateColorToken(editor, id, "Brand", "invalid")).toBe(false);
  expect(updateColorToken(editor, "missing", "Brand", "#123456")).toBe(false);
  editor.apply([{ type: "updateVisual", id, visual: { locked: true } }]);
  const before = serializeDocument(editor.getSnapshot());
  expect(updateColorToken(editor, id, "New", "#abcdef")).toBe(false);
  expect(serializeDocument(editor.getSnapshot())).toBe(before);
  expect(
    parseDocumentResult(before.replace('"#123456"', '"url(bad)"')).ok,
  ).toBe(false);
});

test("applied palette values remain independent of resource changes and deletion", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  editor.selection.set([shape.id]);
  const id = createColorToken(editor, "Primary", "#123456");
  if (!id) throw new Error("missing token");
  editor.setSelectionStyle({ fill: colorTokens(editor)[0]?.value });
  updateColorToken(editor, id, "Primary", "#abcdef");
  editor.deleteElements([id]);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#123456");
});

test("page modes and alias chains materialize, persist, undo and fall back safely", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  const primitive = createColorToken(editor, "Blue 500", "#2563eb");
  const semantic = createColorToken(editor, "Action", "#64748b");
  if (!primitive || !semantic) throw new Error("missing tokens");
  expect(setColorTokenAlias(editor, semantic, primitive)).toBe(true);
  expect(
    colorTokens(editor).find((token) => token.id === semantic),
  ).toMatchObject({ value: "#2563eb", aliasId: primitive, broken: false });
  editor.selection.set([shape.id]);
  expect(bindSelectionColor(editor, "fill", semantic)).toBe(true);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#2563eb");

  expect(editor.setPageTokenMode(TEST_PAGE.id, "Dark")).toBe(true);
  expect(updateColorToken(editor, primitive, "Blue 500", "#60a5fa")).toBe(true);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#60a5fa");
  expect(
    colorTokens(editor).find((token) => token.id === semantic)?.value,
  ).toBe("#60a5fa");
  expect(updateColorToken(editor, semantic, "Action", "#f8fafc")).toBe(true);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#f8fafc");
  expect(
    colorTokens(editor).find((token) => token.id === semantic)?.aliasId,
  ).toBeNull();

  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  editor.setPageTokenMode(TEST_PAGE.id, null);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#2563eb");
  expect(setColorTokenAlias(editor, primitive, semantic)).toBe(false);
  editor.deleteElements([primitive]);
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#64748b");
  expect(
    (editor.store.get(semantic)?.semantic as { alias?: string }).alias,
  ).toBeUndefined();
  editor.undo();
  expect(editor.store.get(shape.id)?.visual.style?.fill).toBe("#2563eb");
});

test("clipboard detaches external token aliases and remaps included alias chains", () => {
  const editor = makeEditor();
  const target = editor.buildElement("design.token", {
    id: "target",
    semantic: { name: "Blue", kind: "color", value: "#2563eb" },
  });
  const alias = editor.buildElement("design.token", {
    id: "alias",
    semantic: {
      name: "Action",
      kind: "color",
      value: "#64748b",
      alias: target.id,
      modes: [{ name: "Dark", alias: target.id }],
    },
  });
  editor.apply([
    { type: "createElement", element: target },
    { type: "createElement", element: alias },
  ]);

  expect(copyElements(editor.store, [alias.id]).elements[0]?.semantic).toEqual({
    name: "Action",
    kind: "color",
    value: "#64748b",
    modes: [{ name: "Dark" }],
  });

  const plan = planPaste(copyElements(editor.store, [alias.id, target.id]), {
    page: editor.currentPageId,
    idSource: counterIds("copy"),
    nextIndex: () => editor.nextIndex(),
    offset: { x: 0, y: 0 },
  });
  const copiedTarget = plan.mapping.get(target.id);
  const copiedAlias = plan.commands.find(
    (command) =>
      command.type === "createElement" &&
      command.element.id === plan.mapping.get(alias.id),
  );
  expect(copiedAlias?.type).toBe("createElement");
  if (copiedAlias?.type !== "createElement") throw new Error("missing copy");
  expect(copiedAlias.element.semantic).toMatchObject({
    alias: copiedTarget,
    modes: [{ name: "Dark", alias: copiedTarget }],
  });
});
