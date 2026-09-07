import { expect, test } from "bun:test";
import { FreehandGesture } from "./freehand-gesture.ts";
import { makeEditor } from "./test-helpers.ts";

test("stroke accepts only its pointer and commits one undoable edit", () => {
  const editor = makeEditor();
  const gesture = new FreehandGesture(editor, () => {});
  expect(gesture.start(1, { x: 10, y: 20 })).toBe(true);
  expect(gesture.start(2, { x: 100, y: 100 })).toBe(false);
  gesture.cancel(2);
  gesture.finish(2, { x: 100, y: 100 });
  expect(editor.getSnapshot().elements).toHaveLength(0);
  gesture.finish(1, { x: 30, y: 40 });
  expect(editor.getSnapshot().elements).toHaveLength(1);
  editor.undo();
  expect(editor.getSnapshot().elements).toHaveLength(0);
  gesture.dispose();
});

for (const reason of ["cancel", "reload", "camera", "dispose"] as const) {
  test(`${reason} discards the pending stroke without history`, () => {
    const editor = makeEditor();
    let preview = 0;
    const gesture = new FreehandGesture(editor, (points) => {
      preview = points.length;
    });
    gesture.start(1, { x: 10, y: 20 });
    expect(preview).toBe(1);
    if (reason === "cancel") gesture.cancel();
    if (reason === "reload") editor.loadDocument(editor.getSnapshot());
    if (reason === "camera") editor.camera.set({ x: 10, y: 0, z: 1 });
    if (reason === "dispose") gesture.dispose();
    gesture.finish(1, { x: 30, y: 40 });
    expect(preview).toBe(0);
    expect(editor.getSnapshot().elements).toHaveLength(0);
    gesture.dispose();
  });
}
