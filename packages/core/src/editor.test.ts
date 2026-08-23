// The editor facade's own contract: what subscribers see, and when.
//
// A renderer re-reads the document whenever the editor notifies it, so every
// change to *what should be on screen* has to arrive as a notification with
// the editor already in its new state. Page switches and document loads are
// the two cases that are not plain store commits.

import { describe, expect, test } from "bun:test";
import type { Page } from "@diagra/ir";
import { Editor } from "./editor.ts";
import {
  counterIds,
  document,
  element,
  makeEditor,
  seededRng,
  TEST_PAGE,
} from "./test-helpers.ts";

const SECOND_PAGE: Page = { id: "page-2", name: "Page 2", kind: "freeform" };

function twoPageEditor(): Editor {
  return makeEditor({
    document: document(
      [
        element({
          id: "on-one",
          type: "node.generic",
          semantic: { label: "one" },
          page: TEST_PAGE.id,
        }),
        element({
          id: "on-two",
          type: "node.generic",
          semantic: { label: "two" },
          page: SECOND_PAGE.id,
        }),
      ],
      [TEST_PAGE, SECOND_PAGE],
    ),
  });
}

describe("setCurrentPage", () => {
  test("notifies subscribers so a renderer re-reads the page", () => {
    const editor = twoPageEditor();
    const seen: string[] = [];
    editor.subscribe(() => {
      seen.push(editor.currentPageId);
    });

    const before = editor.revision;
    editor.setCurrentPage(SECOND_PAGE.id);

    expect(editor.currentPageId).toBe(SECOND_PAGE.id);
    expect(editor.revision).toBeGreaterThan(before);
    // The notification arrives with the new page already current.
    expect(seen).toEqual([SECOND_PAGE.id]);
    expect(
      editor.store.getPageElements(editor.currentPageId).map((el) => el.id),
    ).toEqual(["on-two"]);
  });

  test("clears the selection, which belonged to the page being left", () => {
    const editor = twoPageEditor();
    editor.selection.set(["on-one"]);
    editor.setCurrentPage(SECOND_PAGE.id);
    expect(editor.selection.size).toBe(0);
  });

  test("ignores an unknown page and re-selecting the current one", () => {
    const editor = twoPageEditor();
    editor.selection.set(["on-one"]);
    let notifications = 0;
    editor.subscribe(() => {
      notifications += 1;
    });

    editor.setCurrentPage("no-such-page");
    editor.setCurrentPage(TEST_PAGE.id);

    expect(editor.currentPageId).toBe(TEST_PAGE.id);
    expect(notifications).toBe(0);
    expect(editor.selection.has("on-one")).toBe(true);
  });
});

// A toolbar reads `canUndo()` when the editor tells it something changed. If
// the history stack can move without a notification, the Undo button renders
// the *previous* edit's state and only catches up on the edit after — which
// is exactly what an unwatched `endBatch` produces.
describe("undo availability is announced when it changes", () => {
  /** What a toolbar would render, sampled on every editor notification. */
  function trackButtons(editor: Editor): () => {
    undo: boolean;
    redo: boolean;
  } {
    let latest = { undo: editor.canUndo(), redo: editor.canRedo() };
    editor.subscribe(() => {
      latest = { undo: editor.canUndo(), redo: editor.canRedo() };
    });
    return () => latest;
  }

  test("the first edit enables undo without waiting for a second", () => {
    const editor = makeEditor();
    const rendered = trackButtons(editor);
    expect(rendered()).toEqual({ undo: false, redo: false });

    editor.createElement("shape.geo");

    expect(editor.canUndo()).toBe(true);
    expect(rendered()).toEqual({ undo: true, redo: false });
  });

  test("closing a batch enables undo even though no element changed then", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "n1",
          type: "node.generic",
          semantic: { label: "a" },
          visual: { x: 0, y: 0 },
        }),
      ]),
    });
    const rendered = trackButtons(editor);

    editor.beginBatch();
    editor.apply([{ type: "updateVisual", id: "n1", visual: { x: 10 } }]);
    // Mid-drag the entry is still pending, so undo is genuinely unavailable.
    expect(rendered()).toEqual({ undo: false, redo: false });

    editor.endBatch();

    expect(rendered()).toEqual({ undo: true, redo: false });
  });

  test("undo and redo announce the other direction becoming available", () => {
    const editor = makeEditor();
    const rendered = trackButtons(editor);
    editor.createElement("shape.geo");

    editor.undo();
    expect(rendered()).toEqual({ undo: false, redo: true });
    editor.redo();
    expect(rendered()).toEqual({ undo: true, redo: false });
  });

  test("an aborted batch leaves undo where it was", () => {
    const editor = makeEditor();
    const rendered = trackButtons(editor);
    editor.beginBatch();
    editor.createElement("shape.geo");
    editor.abortBatch();
    expect(rendered()).toEqual({ undo: false, redo: false });
  });

  test("loading a document announces that the stacks were dropped", () => {
    const editor = makeEditor();
    editor.createElement("shape.geo");
    const rendered = trackButtons(editor);
    expect(rendered()).toEqual({ undo: true, redo: false });

    editor.loadDocument(document([], [SECOND_PAGE]));

    expect(rendered()).toEqual({ undo: false, redo: false });
  });
});

describe("loadDocument", () => {
  test("subscribers observe the new document's page, not the old one", () => {
    const editor = makeEditor();
    const pages: string[] = [];
    const counts: number[] = [];
    editor.subscribe(() => {
      pages.push(editor.currentPageId);
      counts.push(editor.store.getPageElements(editor.currentPageId).length);
    });

    editor.loadDocument(
      document(
        [
          element({
            id: "fresh",
            type: "shape.geo",
            semantic: { geo: "rect", label: "" },
            page: SECOND_PAGE.id,
          }),
        ],
        [SECOND_PAGE],
      ),
    );

    expect(pages).toEqual([SECOND_PAGE.id]);
    expect(counts).toEqual([1]);
  });

  test("loading over a non-empty undo stack still announces the load once", () => {
    const editor = twoPageEditor();
    editor.selection.set(["on-one"]);
    editor.createElement("shape.geo");
    expect(editor.canUndo()).toBe(true);

    // Dropping that stack is a notifiable event in its own right, so a load
    // must not let it out while the page and store still describe the
    // document being replaced.
    const observed: {
      page: string;
      undo: boolean;
      selection: number;
      elements: number;
    }[] = [];
    editor.subscribe(() => {
      observed.push({
        page: editor.currentPageId,
        undo: editor.canUndo(),
        selection: editor.selection.size,
        elements: editor.store.getPageElements(editor.currentPageId).length,
      });
    });

    editor.loadDocument(
      document(
        [
          element({
            id: "fresh",
            type: "shape.geo",
            semantic: { geo: "rect", label: "" },
            page: SECOND_PAGE.id,
          }),
        ],
        [SECOND_PAGE],
      ),
    );

    expect(observed).toEqual([
      { page: SECOND_PAGE.id, undo: false, selection: 0, elements: 1 },
    ]);
  });

  test("resets history, selection and the z-order cursor", () => {
    const editor = twoPageEditor();
    editor.selection.set(["on-one"]);
    editor.createElement("shape.geo");
    expect(editor.canUndo()).toBe(true);

    editor.loadDocument(document([], [SECOND_PAGE]));

    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(editor.selection.size).toBe(0);
    expect(editor.currentPageId).toBe(SECOND_PAGE.id);
    expect(editor.store.size).toBe(0);
  });

  test("elements created after a load still stack in creation order", () => {
    const editor = new Editor({
      document: document([], [TEST_PAGE]),
      idSource: counterIds(),
      rng: seededRng(7),
    });
    editor.createElement("shape.geo");
    editor.loadDocument(document([], [TEST_PAGE]));
    const first = editor.createElement("shape.geo");
    const second = editor.createElement("shape.geo");
    expect(
      editor.store.getPageElements(TEST_PAGE.id).map((el) => el.id),
    ).toEqual([first, second]);
  });
});
