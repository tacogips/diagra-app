import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { validateDocument } from "@diagra/ir";
import { document, makeEditor } from "./test-helpers.ts";
import { pageAfterRemoval } from "./page-order.ts";

function fixture() {
  return makeEditor({
    document: document(
      [],
      [
        { id: "c", name: "Three", kind: "freeform" },
        { id: "a", name: "One", kind: "freeform" },
        { id: "b", name: "Two", kind: "erd" },
      ],
    ),
  });
}

test("opening unordered input activates the first displayed page without rewriting it", () => {
  const editor = fixture();
  expect(editor.currentPageId).toBe("a");
  const input = {
    ...editor.getSnapshot(),
    pages: [
      { id: "a", name: "Last", kind: "freeform" as const, order: "z" },
      { id: "b", name: "First", kind: "freeform" as const, order: "A" },
    ],
  };
  editor.loadDocument(input);
  expect(editor.currentPageId).toBe("b");
  expect(editor.store.listPages().map((page) => page.id)).toEqual(["b", "a"]);
  expect(input.pages.map((page) => page.id)).toEqual(["a", "b"]);
});

test("active page deletion follows current tab order and restores the neighbor's view", () => {
  const editor = fixture();
  editor.setCurrentPage("c");
  const view = { x: 300, y: -200, z: 2 };
  editor.camera.set(view);
  editor.setCurrentPage("b");
  editor.deletePage("b");
  expect(editor.currentPageId).toBe("c");
  expect(editor.camera.get()).toEqual(view);
  editor.undo();
  editor.reorderPage("b", 1);
  editor.setCurrentPage("b");
  editor.deletePage("b");
  expect(editor.currentPageId).toBe("c");
  expect(editor.camera.get()).toEqual(view);
});

test("same-document remote removal uses surviving neighbors and clears stale selection", () => {
  const editor = fixture();
  editor.setCurrentPage("c");
  const view = { x: -120, y: 80, z: 0.75 };
  editor.camera.set(view);
  editor.setCurrentPage("b");
  const selected = editor.createElement("text.note");
  editor.selection.set([selected]);
  const snapshot = editor.getSnapshot();
  editor.loadDocument(
    {
      ...snapshot,
      pages: snapshot.pages.filter((page) => page.id !== "b"),
      elements: [],
    },
    { preserveView: true },
  );
  expect(editor.currentPageId).toBe("c");
  expect(editor.camera.get()).toEqual(view);
  expect(editor.selection.size).toBe(0);
  expect(
    pageAfterRemoval(
      ["a", "b", "c", "d"],
      [{ id: "d", name: "Four", kind: "freeform" }],
      "b",
    ),
  ).toBe("d");
  expect(
    pageAfterRemoval(
      ["a", "b"],
      [{ id: "x", name: "New", kind: "freeform" }],
      "b",
    ),
  ).toBe("x");
});

test("legacy page order remains unchanged on load, then explicit moves persist with exact undo", () => {
  const editor = fixture();
  const selected = editor.createElement("text.note", {
    semantic: { text: "Selected note" },
  });
  editor.selection.set([selected]);
  editor.camera.set({ x: 250, y: -140, z: 2 });
  const before = editor.getSnapshot();
  expect(editor.store.listPages().map((page) => page.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(
    editor.store.listPages().every((page) => page.order === undefined),
  ).toBe(true);
  const active = editor.currentPageId;
  const camera = editor.camera.get();
  expect(editor.reorderPage("c", -1)).toBe(true);
  expect(editor.store.listPages().map((page) => page.id)).toEqual([
    "a",
    "c",
    "b",
  ]);
  const moved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(moved))).toEqual(moved);
  expect(validateDocument(moved)).toEqual([]);
  expect(editor.currentPageId).toBe(active);
  expect(editor.camera.get()).toEqual(camera);
  expect([...editor.selection.ids()]).toEqual([selected]);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.redo();
  expect(editor.getSnapshot()).toEqual(moved);
});

test("page creation appends and duplication follows its source regardless of generated IDs", () => {
  const editor = fixture();
  const before = editor.getSnapshot();
  editor.createPage({ id: "0", name: "Last" });
  expect(editor.store.listPages().map((page) => page.id)).toEqual([
    "a",
    "b",
    "c",
    "0",
  ]);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  const duplicate = editor.duplicatePage("b");
  if (!duplicate) throw new Error("Expected a duplicate page");
  expect(editor.store.listPages().map((page) => page.id)).toEqual([
    "a",
    "b",
    duplicate,
    "c",
  ]);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("boundary and missing page moves are non-mutating", () => {
  const editor = fixture();
  const before = editor.getSnapshot();
  expect(editor.reorderPage("a", -1)).toBe(false);
  expect(editor.reorderPage("c", 1)).toBe(false);
  expect(editor.reorderPage("missing", 1)).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.canUndo()).toBe(false);
});

test("tied imported order keys are normalized atomically before moving", () => {
  const editor = fixture();
  editor.loadDocument({
    ...editor.getSnapshot(),
    pages: editor.store.listPages().map((page) => ({ ...page, order: "V" })),
  });
  const before = editor.getSnapshot();
  expect(editor.reorderPage("a", 1)).toBe(true);
  expect(editor.store.listPages().map((page) => page.id)).toEqual([
    "b",
    "a",
    "c",
  ]);
  expect(new Set(editor.store.listPages().map((page) => page.order)).size).toBe(
    3,
  );
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("malformed page ordering is rejected by IR and command validation", () => {
  const editor = fixture();
  const before = editor.getSnapshot();
  for (const order of ["", "0", "a0", "bad key", "!"]) {
    expect(
      validateDocument({
        ...before,
        pages: before.pages.map((page) => ({ ...page, order })),
      }).some((issue) => issue.code === "page.order"),
    ).toBe(true);
    expect(() =>
      editor.apply([{ type: "updatePage", id: "a", page: { order } }]),
    ).toThrow();
    expect(() =>
      editor.apply([
        {
          type: "createPage",
          page: { id: "new", name: "New", kind: "freeform", order },
        },
      ]),
    ).toThrow();
    expect(editor.getSnapshot()).toEqual(before);
  }
});
