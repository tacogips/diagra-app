import { expect, test } from "bun:test";
import { ReviewCommentPinDrag } from "./comment-pin-drag.ts";
import {
  createReviewComment,
  moveReviewComment,
  reviewComments,
} from "./comments.ts";
import { makeEditor } from "./test-helpers.ts";

function fixture() {
  const editor = makeEditor();
  const id = createReviewComment(
    editor,
    { x: 100, y: 80 },
    {
      author: "Ada",
      body: "Align this pin precisely",
      createdAt: "2026-09-07T00:00:00.000Z",
      id: "message-1",
    },
  );
  if (!id) throw new Error("missing comment");
  return { editor, id };
}

test("comment pin dragging previews at zoom and commits one undoable edit", () => {
  const { editor, id } = fixture();
  const previews: unknown[] = [];
  const drag = new ReviewCommentPinDrag(editor, (value) =>
    previews.push(value),
  );
  expect(drag.start(7, id, { x: 20, y: 30 }, 2)).toBe(true);
  drag.move(7, { x: 60, y: 10 });
  expect(previews.at(-1)).toEqual({ id, point: { x: 120, y: 70 } });
  expect(reviewComments(editor)[0]?.element.visual).toMatchObject({
    x: 100,
    y: 80,
  });
  expect(drag.finish(7, { x: 80, y: 50 })).toBe(true);
  expect(reviewComments(editor)[0]?.element.visual).toMatchObject({
    x: 130,
    y: 90,
  });
  expect(previews.at(-1)).toBeNull();
  expect(editor.undo()).toBe(true);
  expect(reviewComments(editor)[0]?.element.visual).toMatchObject({
    x: 100,
    y: 80,
  });
  drag.dispose();
});

test("comment pin dragging cancels without writes and ignores foreign pointers", () => {
  const { editor, id } = fixture();
  const revision = editor.revision;
  let preview: unknown = null;
  const drag = new ReviewCommentPinDrag(editor, (value) => {
    preview = value;
  });
  expect(drag.start(1, id, { x: 0, y: 0 }, 1)).toBe(true);
  drag.move(2, { x: 50, y: 50 });
  expect(drag.finish(2, { x: 50, y: 50 })).toBe(false);
  drag.cancel(1);
  expect(preview).toBeNull();
  expect(editor.canUndo()).toBe(true);
  expect(editor.revision).toBe(revision);
  expect(reviewComments(editor)[0]?.element.visual).toMatchObject({
    x: 100,
    y: 80,
  });

  expect(drag.start(3, id, { x: 0, y: 0 }, 1)).toBe(true);
  editor.createElement("shape.geo");
  expect(preview).toBeNull();
  expect(drag.finish(3, { x: 50, y: 50 })).toBe(false);
  drag.dispose();
});

test("resolved and locked comment pins reject drag and direct movement", () => {
  const { editor, id } = fixture();
  const drag = new ReviewCommentPinDrag(editor, () => {});
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        resolved: true,
      },
    },
  ]);
  expect(drag.start(1, id, { x: 0, y: 0 }, 1)).toBe(false);
  expect(moveReviewComment(editor, id, { x: 40, y: 50 })).toBe(false);
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        resolved: false,
      },
    },
    { type: "updateVisual", id, visual: { locked: true } },
  ]);
  expect(drag.start(1, id, { x: 0, y: 0 }, 1)).toBe(false);
  expect(drag.start(1, id, { x: 0, y: 0 }, 0)).toBe(false);
  drag.dispose();
});

test("a pin press without movement remains a history-free click", () => {
  const { editor, id } = fixture();
  const revision = editor.revision;
  const drag = new ReviewCommentPinDrag(editor, () => {});
  expect(drag.start(1, id, { x: 10, y: 20 }, 1)).toBe(true);
  expect(drag.finish(1, { x: 10, y: 20 })).toBe(false);
  expect(editor.revision).toBe(revision);
  expect(editor.undo()).toBe(true);
  expect(reviewComments(editor)).toHaveLength(0);
  drag.dispose();
});
