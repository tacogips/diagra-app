import { expect, test } from "bun:test";
import { makeEditor } from "./test-helpers.ts";

test("inspector-style frame movement carries nested content with one undo", () => {
  const editor = makeEditor();
  const child = editor.buildElement("node.generic", {
    visual: { x: 50, y: 60 },
  });
  const inner = editor.buildElement("frame", {
    semantic: { name: "Inner", memberIds: [child.id] },
    visual: { x: 20, y: 30 },
  });
  const outer = editor.buildElement("frame", {
    semantic: { name: "Outer", memberIds: [inner.id] },
    visual: { x: 0, y: 0 },
  });
  editor.apply(
    [child, inner, outer].map((element) => ({
      type: "createElement",
      element,
    })),
  );
  const before = editor.getSnapshot();
  editor.apply([
    { type: "updateVisual", id: outer.id, visual: { x: 100, y: 200 } },
  ]);
  expect(editor.store.get(inner.id)?.visual.x).toBe(120);
  expect(editor.store.get(child.id)?.visual.x).toBe(150);
  expect(editor.store.get(child.id)?.visual.y).toBe(260);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.selection.set([outer.id]);
  editor.nudgeSelection(10, 20);
  expect(editor.store.get(child.id)?.visual.x).toBe(60);
  expect(editor.store.get(child.id)?.visual.y).toBe(80);
});

test("explicit child movement in a batch is not translated again", () => {
  const editor = makeEditor();
  const child = editor.buildElement("node.generic", {
    visual: { x: 20, y: 20 },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Frame", memberIds: [child.id] },
    visual: { x: 0, y: 0 },
  });
  editor.apply(
    [child, frame].map((element) => ({ type: "createElement", element })),
  );
  editor.apply([
    { type: "updateVisual", id: frame.id, visual: { x: 100 } },
    { type: "updateVisual", id: child.id, visual: { x: 130 } },
  ]);
  expect(editor.store.get(child.id)?.visual.x).toBe(130);
});
