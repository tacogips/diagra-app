// Copy, cut, paste and duplicate through the editor.
//
// The point of these is the seams the pure functions cannot cover: that each
// user action is exactly one undo step, that what landed becomes the
// selection, and that the offset grows per paste rather than per element.

import { describe, expect, test } from "bun:test";
import type { Element, ElementId } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import {
  counterIds,
  document,
  element,
  erdFixture,
  makeEditor,
  TEST_PAGE,
} from "./test-helpers.ts";

function positioned(editor: Editor, id: ElementId): { x?: number; y?: number } {
  return (editor.store.get(id) as Element).visual;
}

function boxEditor(): Editor {
  return makeEditor({
    document: document([
      element({
        id: "box",
        type: "node.generic",
        index: "a1",
        semantic: { label: "Box" },
        visual: { x: 100, y: 100 },
      }),
    ]),
    idSource: counterIds("copy"),
  });
}

describe("copy and paste", () => {
  test("a paste lands offset, selected, and as one undo step", () => {
    const editor = boxEditor();
    editor.selection.set(["box"]);
    expect(editor.copySelection()).toBe(true);

    const before = editor.history.undoSize;
    const pasted = editor.paste();

    expect(pasted).toEqual(["copy-1"]);
    expect(editor.history.undoSize).toBe(before + 1);
    expect([...editor.selection.ids()]).toEqual(["copy-1"]);
    expect(positioned(editor, "copy-1")).toMatchObject({ x: 116, y: 116 });

    editor.undo();
    expect(editor.store.has("copy-1")).toBe(false);
    editor.redo();
    expect(editor.store.has("copy-1")).toBe(true);
  });

  test("a second paste of the same payload lands one step further out", () => {
    const editor = boxEditor();
    editor.selection.set(["box"]);
    editor.copySelection();

    editor.paste();
    const second = editor.paste();
    expect(positioned(editor, second[0] as ElementId)).toMatchObject({
      x: 132,
      y: 132,
    });
  });

  test("a fresh copy restarts the offset", () => {
    const editor = boxEditor();
    editor.selection.set(["box"]);
    editor.copySelection();
    editor.paste();
    editor.paste();

    editor.selection.set(["box"]);
    editor.copySelection();
    const pasted = editor.paste();
    expect(positioned(editor, pasted[0] as ElementId)).toMatchObject({
      x: 116,
      y: 116,
    });
  });

  test("pasting a relation rewrites both of its tables", () => {
    const editor = makeEditor({
      document: document([...erdFixture()]),
      idSource: counterIds("copy"),
    });
    editor.selection.set(["users", "orders", "rel"]);
    expect(editor.copySelection()).toBe(true);
    const pasted = editor.paste();

    expect(pasted).toHaveLength(3);
    const relation = editor.store.get(pasted[2] as ElementId) as Element;
    expect(relation.type).toBe("erd.relation");
    expect(relation.semantic).toEqual({
      from: { table: pasted[0], column: "c1" },
      to: { table: pasted[1], column: "c2" },
      cardinality: "1:*",
    });
  });

  test("copy refuses a selection that would carry nothing", () => {
    const editor = makeEditor({ document: document([...erdFixture()]) });
    editor.selection.set(["rel"]);
    expect(editor.copySelection()).toBe(false);
    expect(editor.canPaste()).toBe(false);
    expect(editor.paste()).toEqual([]);
  });

  test("a failed copy leaves an earlier payload intact", () => {
    const editor = makeEditor({
      document: document([...erdFixture()]),
      idSource: counterIds("copy"),
    });
    editor.selection.set(["users"]);
    expect(editor.copySelection()).toBe(true);
    editor.selection.set(["rel"]);
    expect(editor.copySelection()).toBe(false);
    expect(editor.canPaste()).toBe(true);
    expect(editor.paste()).toHaveLength(1);
  });

  test("paste lands on the page that is showing", () => {
    const second = { id: "page-2", name: "Page 2", kind: "freeform" as const };
    const editor = makeEditor({
      document: document(
        [
          element({
            id: "box",
            type: "node.generic",
            index: "a1",
            semantic: { label: "Box" },
            visual: { x: 0, y: 0 },
          }),
        ],
        [TEST_PAGE, second],
      ),
      idSource: counterIds("copy"),
    });
    editor.selection.set(["box"]);
    editor.copySelection();
    editor.setCurrentPage("page-2");

    const pasted = editor.paste();
    expect((editor.store.get(pasted[0] as ElementId) as Element).page).toBe(
      "page-2",
    );
    expect(editor.store.getPageElements("page-2")).toHaveLength(1);
  });

  test("a pasted element sits above everything already on the page", () => {
    const editor = boxEditor();
    editor.selection.set(["box"]);
    editor.copySelection();
    const pasted = editor.paste();
    const order = editor.store
      .getPageElements(TEST_PAGE.id)
      .map((entry) => entry.id);
    expect(order).toEqual(["box", pasted[0] as ElementId]);
  });
});

describe("cut", () => {
  test("removes the selection and restores it in one undo", () => {
    const editor = boxEditor();
    editor.selection.set(["box"]);
    const before = editor.history.undoSize;

    expect(editor.cutSelection()).toBe(true);
    expect(editor.store.has("box")).toBe(false);
    expect(editor.history.undoSize).toBe(before + 1);

    editor.undo();
    expect(editor.store.has("box")).toBe(true);
    expect(editor.canPaste()).toBe(true);
  });

  test("keeps the document when there was nothing to take", () => {
    const editor = makeEditor({ document: document([...erdFixture()]) });
    editor.selection.set(["rel"]);
    expect(editor.cutSelection()).toBe(false);
    expect(editor.store.has("rel")).toBe(true);
  });
});

describe("duplicate", () => {
  test("copies next to the original without touching the clipboard", () => {
    const editor = boxEditor();
    editor.selection.set(["box"]);
    editor.copySelection();
    const clipboard = editor.clipboard.get();

    const duplicated = editor.duplicateSelection();
    expect(duplicated).toHaveLength(1);
    expect(positioned(editor, duplicated[0] as ElementId)).toMatchObject({
      x: 116,
      y: 116,
    });
    expect([...editor.selection.ids()]).toEqual([duplicated[0] as ElementId]);
    expect(editor.clipboard.get()).toBe(clipboard);
    expect(editor.clipboard.pasteGeneration).toBe(0);
  });

  test("duplicating twice steps away from the duplicate, not the original", () => {
    const editor = boxEditor();
    editor.selection.set(["box"]);
    const first = editor.duplicateSelection();
    const second = editor.duplicateSelection();
    expect(positioned(editor, first[0] as ElementId)).toMatchObject({
      x: 116,
      y: 116,
    });
    expect(positioned(editor, second[0] as ElementId)).toMatchObject({
      x: 132,
      y: 132,
    });
  });

  test("does nothing with an empty selection", () => {
    const editor = boxEditor();
    const before = editor.history.undoSize;
    expect(editor.duplicateSelection()).toEqual([]);
    expect(editor.history.undoSize).toBe(before);
  });
});
