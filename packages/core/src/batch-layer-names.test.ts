import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  previewLayerNames,
  renameSelectedLayers,
} from "./batch-layer-names.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

function fixture() {
  const editor = makeEditor({
    document: document([
      element({
        id: "table",
        index: "a1",
        type: "erd.table",
        semantic: {
          tableName: "users",
          columns: [{ id: "pk", name: "id", dataType: "uuid", pk: true }],
        },
      }),
      element({
        id: "locked",
        index: "a2",
        type: "text.note",
        semantic: { text: "Locked" },
        visual: { locked: true },
      }),
      element({
        id: "box",
        index: "a3",
        type: "shape.geo",
        semantic: { geo: "rect" },
        visual: { layerName: "Box", hidden: true },
      }),
      element({
        id: "token",
        index: "a4",
        type: "design.token",
        semantic: { kind: "color", name: "Primary", value: "#123456" },
      }),
    ]),
  });
  editor.selection.set(["table", "locked", "box", "token"]);
  return editor;
}

test("batch name preview follows layer order and skips locked layers and resources without mutation", () => {
  const editor = fixture();
  const before = editor.getSnapshot();
  expect(
    previewLayerNames(editor, {
      pattern: "{n} {type} {name}",
      start: 7,
      digits: 3,
    }).map((row) => [row.id, row.name]),
  ).toEqual([
    ["box", "007 shape.geo Box"],
    ["table", "008 erd.table users"],
  ]);
  expect(editor.getSnapshot()).toEqual(before);
  expect([...editor.selection.ids()]).toEqual([
    "table",
    "locked",
    "box",
    "token",
  ]);
});

test("batch naming is one undo step and preserves engineering semantics and rendered content", () => {
  const editor = fixture();
  const before = editor.getSnapshot();
  const svg = editor.exportPageSvg();
  expect(
    renameSelectedLayers(editor, { pattern: "Layer {n}", digits: 2 }),
  ).toBe(2);
  expect(editor.store.get("box")?.visual.layerName).toBe("Layer 01");
  expect(editor.store.get("table")?.visual.layerName).toBe("Layer 02");
  expect(editor.store.get("table")?.semantic).toEqual(
    before.elements.find((item) => item.id === "table")?.semantic,
  );
  expect(editor.exportPageSvg()).toBe(svg);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  const after = editor.getSnapshot();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.redo();
  expect(editor.getSnapshot()).toEqual(after);
});

test("unchanged implicit names remain implicit and empty patterns clear only overrides", () => {
  const editor = fixture();
  expect(renameSelectedLayers(editor, { pattern: "{name}" })).toBe(0);
  expect(editor.canUndo()).toBe(false);
  expect(renameSelectedLayers(editor, { pattern: " " })).toBe(1);
  expect(editor.store.get("box")?.visual.layerName).toBeUndefined();
  expect(editor.store.get("table")?.visual.layerName).toBeUndefined();
  expect(renameSelectedLayers(editor, { pattern: "" })).toBe(0);
});

test("batch naming does not expand selected groups or cross pages and revalidates locks", () => {
  const editor = fixture();
  const group = editor.createElement("group", {
    semantic: { memberIds: ["table"] },
  });
  editor.selection.set([group]);
  expect(renameSelectedLayers(editor, { pattern: "Container" })).toBe(1);
  expect(editor.store.get("table")?.visual.layerName).toBeUndefined();
  editor.selection.set(["table"]);
  expect(previewLayerNames(editor, { pattern: "Data" })).toHaveLength(1);
  editor.apply([{ type: "updateVisual", id: group, visual: { locked: true } }]);
  expect(renameSelectedLayers(editor, { pattern: "Data" })).toBe(0);
  editor.createPage({ name: "Other" });
  editor.selection.set(["box"]);
  expect(renameSelectedLayers(editor, { pattern: "Wrong page" })).toBe(0);
});

test("invalid batch naming options fail before any edit", () => {
  const editor = fixture();
  const before = editor.getSnapshot();
  for (const options of [
    { pattern: "x".repeat(257) },
    { pattern: "x", start: -1 },
    { pattern: "x", start: Number.NaN },
    { pattern: "x", digits: 1.5 },
    { pattern: "x", digits: 7 },
  ])
    expect(() => renameSelectedLayers(editor, options)).toThrow();
  expect(editor.getSnapshot()).toEqual(before);
});

test("literal name replacement handles every match without interpreting regex or replacement syntax", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: "box",
      visual: { layerName: "Desktop.* / Desktop.* / desktop.*" },
    },
  ]);
  editor.selection.set(["box"]);
  const before = editor.getSnapshot();
  const options = {
    pattern: "{name} / {n}",
    find: "Desktop.*",
    replace: "$& {type}",
    digits: 2,
  };
  expect(previewLayerNames(editor, options)[0]?.name).toBe(
    "$& {type} / $& {type} / desktop.* / 01",
  );
  expect(editor.getSnapshot()).toEqual(before);
  expect(renameSelectedLayers(editor, options)).toBe(1);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("find/replace can remove substrings but never changes database names or visible text", () => {
  const editor = fixture();
  editor.selection.set(["table"]);
  const semantic = editor.store.get("table")?.semantic;
  expect(
    renameSelectedLayers(editor, {
      pattern: "{name}",
      find: "users",
      replace: "Accounts",
    }),
  ).toBe(1);
  expect(editor.store.get("table")?.visual.layerName).toBe("Accounts");
  expect(editor.store.get("table")?.semantic).toEqual(semantic);
  expect(
    renameSelectedLayers(editor, {
      pattern: "{name}",
      find: "Accounts",
      replace: "",
    }),
  ).toBe(1);
  expect(editor.store.get("table")?.visual.layerName).toBeUndefined();
  expect(
    renameSelectedLayers(editor, {
      pattern: "{name}",
      find: "",
      replace: "ignored",
    }),
  ).toBe(0);
  expect(
    renameSelectedLayers(editor, {
      pattern: "{name}",
      find: "USERS",
      replace: "ignored",
    }),
  ).toBe(0);
});

test("oversized replacement input and generated names fail atomically", () => {
  const editor = fixture();
  const before = editor.getSnapshot();
  expect(() =>
    renameSelectedLayers(editor, { pattern: "{name}", find: "x".repeat(257) }),
  ).toThrow();
  expect(() =>
    renameSelectedLayers(editor, {
      pattern: "{name}",
      replace: "x".repeat(257),
    }),
  ).toThrow();
  expect(() =>
    renameSelectedLayers(editor, {
      pattern: "{name}".repeat(5),
      find: "Box",
      replace: "x".repeat(256),
    }),
  ).toThrow("1024");
  expect(editor.getSnapshot()).toEqual(before);
});
