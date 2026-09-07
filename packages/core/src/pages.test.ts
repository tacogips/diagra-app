import { describe, expect, test } from "bun:test";
import type { Page } from "@diagra/ir";
import { CommandError } from "./commands.ts";
import { document, element, makeEditor, TEST_PAGE } from "./test-helpers.ts";

const SECOND: Page = { id: "page-2", name: "Two", kind: "erd" };

function twoPages() {
  return makeEditor({
    document: document(
      [
        element({
          id: "n1",
          type: "node.generic",
          semantic: { label: "one" },
          page: TEST_PAGE.id,
          visual: { x: 0, y: 0 },
        }),
        element({
          id: "n2",
          type: "node.generic",
          semantic: { label: "two" },
          page: SECOND.id,
          visual: { x: 0, y: 0 },
        }),
        // An edge on page 1 pointing at an element on page 2, so a page
        // delete has a cross-page cascade to prove.
        element({
          id: "e",
          type: "edge.generic",
          index: "a9",
          semantic: { from: "n1", to: "n2" },
          page: TEST_PAGE.id,
        }),
      ],
      [TEST_PAGE, SECOND],
    ),
  });
}

describe("page commands", () => {
  test("same-document refresh retains only surviving selected layers on the active page", () => {
    const editor = twoPages();
    editor.selection.set(["n1", "e"]);
    const observed: string[][] = [];
    editor.subscribe(() => observed.push([...editor.selection.ids()]));
    const snapshot = editor.getSnapshot();
    editor.loadDocument(
      {
        ...snapshot,
        elements: snapshot.elements.filter((element) => element.id !== "e"),
      },
      { preserveView: true },
    );
    expect([...editor.selection.ids()]).toEqual(["n1"]);
    expect(observed).toEqual([["n1"]]);
    editor.loadDocument(
      {
        ...editor.getSnapshot(),
        elements: editor
          .getSnapshot()
          .elements.map((element) =>
            element.id === "n1" ? { ...element, page: SECOND.id } : element,
          ),
      },
      { preserveView: true },
    );
    expect(editor.selection.size).toBe(0);
    editor.setCurrentPage(SECOND.id);
    editor.selection.set(["n2"]);
    editor.loadDocument(editor.getSnapshot());
    expect(editor.selection.size).toBe(0);
  });
  test("page views are independent, ephemeral and restored after deleting and undoing a page", () => {
    const editor = twoPages();
    const snapshot = editor.getSnapshot();
    const firstView = { x: -500, y: 200, z: 0.5 };
    const secondView = { x: 120, y: -80, z: 2 };
    editor.camera.set(firstView);
    editor.setCurrentPage(SECOND.id);
    expect(editor.camera.get()).toEqual({ x: 0, y: 0, z: 1 });
    editor.camera.set(secondView);
    editor.setCurrentPage(TEST_PAGE.id);
    expect(editor.camera.get()).toEqual(firstView);
    editor.setCurrentPage(SECOND.id);
    expect(editor.camera.get()).toEqual(secondView);
    expect(editor.getSnapshot()).toEqual(snapshot);
    expect(editor.canUndo()).toBe(false);
    editor.deletePage(SECOND.id);
    expect(editor.camera.get()).toEqual(firstView);
    editor.undo();
    editor.setCurrentPage(SECOND.id);
    expect(editor.camera.get()).toEqual(secondView);
  });

  test("remote reload preserves page views but opening a document resets them", () => {
    const editor = twoPages();
    const view = { x: 120, y: -80, z: 2 };
    editor.setCurrentPage(SECOND.id);
    editor.camera.set(view);
    editor.loadDocument(editor.getSnapshot(), { preserveView: true });
    expect(editor.currentPageId).toBe(SECOND.id);
    expect(editor.camera.get()).toEqual(view);
    editor.loadDocument(editor.getSnapshot());
    expect(editor.currentPageId).toBe(TEST_PAGE.id);
    editor.setCurrentPage(SECOND.id);
    expect(editor.camera.get()).toEqual({ x: 0, y: 0, z: 1 });
    editor.camera.set(view);
    editor.loadDocument(
      { ...editor.getSnapshot(), id: "different-document" },
      { preserveView: true },
    );
    expect(editor.camera.get()).toEqual({ x: 0, y: 0, z: 1 });
  });

  test("createPage adds, switches, and undoes", () => {
    const editor = twoPages();
    const id = editor.createPage({ name: "Three", kind: "uml" });
    expect(editor.store.getPage(id)).toEqual({
      id,
      name: "Three",
      kind: "uml",
      order: expect.any(String),
    });
    expect(editor.currentPageId).toBe(id);
    editor.undo();
    expect(editor.store.getPage(id)).toBeUndefined();
    // The current page fell back to an existing one.
    expect(editor.store.getPage(editor.currentPageId)).toBeDefined();
    editor.redo();
    expect(editor.store.getPage(id)?.name).toBe("Three");
  });

  test("updatePage merges name and kind with an exact inverse", () => {
    const editor = twoPages();
    expect(editor.renamePage(SECOND.id, "Renamed")).toBe(true);
    expect(editor.setPageKind(SECOND.id, "sequence")).toBe(true);
    expect(editor.store.getPage(SECOND.id)).toEqual({
      id: SECOND.id,
      name: "Renamed",
      kind: "sequence",
    });
    editor.undo();
    editor.undo();
    expect(editor.store.getPage(SECOND.id)).toEqual(SECOND);
    expect(editor.renamePage(SECOND.id, "Two")).toBe(false);
  });

  test("page token modes persist through duplication and have exact undo", () => {
    const editor = twoPages();
    expect(editor.setPageTokenMode(SECOND.id, "Android")).toBe(true);
    expect(editor.store.getPage(SECOND.id)?.tokenMode).toBe("Android");
    editor.undo();
    expect(editor.store.getPage(SECOND.id)?.tokenMode).toBeUndefined();
    editor.redo();
    expect(editor.store.getPage(SECOND.id)?.tokenMode).toBe("Android");
    const copy = editor.duplicatePage(SECOND.id);
    expect(copy).not.toBeNull();
    expect(editor.store.getPage(copy ?? "")?.tokenMode).toBe("Android");
    expect(editor.setPageTokenMode(copy ?? "", null)).toBe(true);
    expect(editor.store.getPage(copy ?? "")?.tokenMode).toBeUndefined();
    expect(editor.setPageTokenMode(SECOND.id, "Default")).toBe(false);
  });

  test("deletePage removes its elements and cascades across pages", () => {
    const editor = twoPages();
    const diffs: boolean[] = [];
    editor.subscribe((diff) => diffs.push(diff.pagesChanged));
    expect(editor.deletePage(SECOND.id)).toBe(true);
    expect(editor.store.getPage(SECOND.id)).toBeUndefined();
    expect(editor.store.has("n2")).toBe(false);
    // The edge referenced n2 and cascades even though it lives on page 1.
    expect(editor.store.has("e")).toBe(false);
    expect(editor.store.has("n1")).toBe(true);
    expect(diffs).toContain(true);

    editor.undo();
    expect(editor.store.getPage(SECOND.id)).toEqual(SECOND);
    expect(editor.store.get("n2")?.semantic).toEqual({ label: "two" });
    expect(editor.store.has("e")).toBe(true);
  });

  test("the last page cannot be deleted", () => {
    const editor = makeEditor();
    expect(editor.deletePage(TEST_PAGE.id)).toBe(false);
    expect(() =>
      editor.apply([{ type: "deletePage", id: TEST_PAGE.id }]),
    ).toThrow(CommandError);
  });

  test("deleting the current page moves the editor to another page", () => {
    const editor = twoPages();
    editor.setCurrentPage(SECOND.id);
    editor.selection.set(["n2"]);
    editor.deletePage(SECOND.id);
    expect(editor.currentPageId).toBe(TEST_PAGE.id);
    expect(editor.selection.size).toBe(0);
  });

  test("createElement validates against pages created in the same batch", () => {
    const editor = makeEditor();
    const page: Page = { id: "fresh", name: "Fresh", kind: "freeform" };
    const draft = editor.buildElement("node.generic", { page: page.id });
    editor.apply([
      { type: "createPage", page },
      { type: "createElement", element: draft },
    ]);
    expect(editor.store.get(draft.id)?.page).toBe("fresh");
  });

  test("duplicatePage copies elements with fresh ids", () => {
    const editor = twoPages();
    const copy = editor.duplicatePage(TEST_PAGE.id);
    expect(copy).not.toBeNull();
    const elements = editor.store.getPageElements(copy as string);
    // The edge pointed at page 2, so it is not self-contained and is left
    // behind, exactly as a copy/paste would leave it.
    expect(elements.map((e) => e.type)).toEqual(["node.generic"]);
    expect(elements[0]?.id).not.toBe("n1");
    editor.undo();
    expect(editor.store.getPage(copy as string)).toBeUndefined();
  });

  test("new pages append regardless of their ID", () => {
    const editor = twoPages();
    editor.createPage({ id: "page-0", name: "Zero" });
    expect(editor.store.listPages().map((p) => p.id)).toEqual([
      "page-1",
      "page-2",
      "page-0",
    ]);
  });
});
