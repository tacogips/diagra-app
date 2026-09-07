import { describe, expect, test } from "bun:test";
import type { Editor } from "./editor.ts";
import { document, makeEditor } from "./test-helpers.ts";
import {
  createReviewComment,
  focusReviewComment,
  moveReviewComment,
  replyToReviewComment,
  reviewComments,
  setReviewCommentResolved,
} from "./comments.ts";

function setup(): Editor {
  let id = 0;
  return makeEditor({
    document: document([]),
    idSource: () => `id-${++id}`,
  });
}

describe("review comments", () => {
  test("focusing a cross-page thread centers its pin at the destination zoom without edits", () => {
    const editor = setup();
    const first = editor.currentPageId;
    const second = editor.createPage({ name: "Mobile" });
    editor.camera.set({ x: 0, y: 0, z: 2 });
    const id = createReviewComment(
      editor,
      { x: 1800, y: -400 },
      { author: "Ada", body: "Review this screen" },
    );
    if (!id) throw new Error("Expected thread");
    editor.setCurrentPage(first);
    const before = editor.getSnapshot();
    expect(reviewComments(editor)).toHaveLength(0);
    expect(reviewComments(editor, second)).toHaveLength(1);
    expect(focusReviewComment(editor, id, { width: 1000, height: 600 })).toBe(
      true,
    );
    expect(editor.currentPageId).toBe(second);
    expect(editor.camera.get().z).toBe(2);
    expect(editor.camera.pageToScreen({ x: 1800, y: -400 })).toEqual({
      x: 500,
      y: 300,
    });
    expect(editor.getSnapshot()).toEqual(before);
  });

  test("invalid comment navigation leaves the current view untouched", () => {
    const editor = setup();
    const id = createReviewComment(
      editor,
      { x: 0, y: 0 },
      { author: "Ada", body: "Review" },
    );
    if (!id) throw new Error("Expected thread");
    const before = editor.camera.get();
    expect(focusReviewComment(editor, id, { width: 0, height: 600 })).toBe(
      false,
    );
    expect(
      focusReviewComment(editor, "missing", { width: 1000, height: 600 }),
    ).toBe(false);
    expect(editor.camera.get()).toEqual(before);
  });
  test("creates a contextual thread and preserves its page-space pin", () => {
    const editor = setup();
    const target = editor.createElement("shape.geo");
    const id = createReviewComment(
      editor,
      { x: 120, y: 80 },
      {
        author: "Ada",
        body: "Increase contrast",
        createdAt: "2026-09-07T00:00:00.000Z",
        id: "m1",
      },
      target,
    );
    expect(id).not.toBeNull();
    const [thread] = reviewComments(editor);
    expect(thread?.number).toBe(1);
    expect(thread?.element.semantic.target).toBe(target);
    expect(thread?.element.visual).toMatchObject({ x: 120, y: 80 });
    expect(editor.selection.size).toBe(0);
  });

  test("replies, resolves, reopens and supports undo", () => {
    const editor = setup();
    const id = createReviewComment(
      editor,
      { x: 1, y: 2 },
      {
        author: "Ada",
        body: "Question",
        createdAt: "2026-09-07T00:00:00.000Z",
        id: "m1",
      },
    ) as string;
    expect(
      replyToReviewComment(editor, id, {
        author: "Grace",
        body: "Answered",
        createdAt: "2026-09-07T00:01:00.000Z",
        id: "m2",
      }),
    ).toBe(true);
    expect(setReviewCommentResolved(editor, id, true)).toBe(true);
    expect(reviewComments(editor)[0]?.element.semantic.messages).toHaveLength(
      2,
    );
    expect(reviewComments(editor)[0]?.element.semantic.resolved).toBe(true);
    editor.undo();
    expect(
      reviewComments(editor)[0]?.element.semantic.resolved,
    ).toBeUndefined();
    expect(setReviewCommentResolved(editor, id, true)).toBe(true);
    expect(setReviewCommentResolved(editor, id, false)).toBe(true);
    expect(
      reviewComments(editor)[0]?.element.semantic.resolved,
    ).toBeUndefined();
  });

  test("detaches when its contextual target is deleted", () => {
    const editor = setup();
    const target = editor.createElement("shape.geo");
    createReviewComment(
      editor,
      { x: 5, y: 6 },
      {
        author: "Ada",
        body: "Keep this note",
        createdAt: "2026-09-07T00:00:00.000Z",
        id: "m1",
      },
      target,
    );
    editor.deleteElements([target]);
    expect(reviewComments(editor)[0]?.element.semantic.target).toBeUndefined();
  });

  test("rejects empty messages and invalid coordinates", () => {
    const editor = setup();
    expect(
      createReviewComment(
        editor,
        { x: 0, y: 0 },
        { author: "Ada", body: "  " },
      ),
    ).toBeNull();
    expect(
      createReviewComment(
        editor,
        { x: Number.NaN, y: 0 },
        { author: "Ada", body: "Hello" },
      ),
    ).toBeNull();
    expect(reviewComments(editor)).toHaveLength(0);
  });

  test("moves only valid editable comment pins", () => {
    const editor = setup();
    const id = createReviewComment(
      editor,
      { x: 5, y: 6 },
      {
        author: "Ada",
        body: "Move me",
        createdAt: "2026-09-07T00:00:00.000Z",
        id: "m1",
      },
    ) as string;
    expect(moveReviewComment(editor, id, { x: 30, y: 40 })).toBe(true);
    expect(reviewComments(editor)[0]?.element.visual).toMatchObject({
      x: 30,
      y: 40,
    });
    expect(moveReviewComment(editor, id, { x: 30, y: 40 })).toBe(false);
    expect(moveReviewComment(editor, id, { x: Number.NaN, y: 0 })).toBe(false);
    expect(moveReviewComment(editor, "missing", { x: 0, y: 0 })).toBe(false);
  });
});
