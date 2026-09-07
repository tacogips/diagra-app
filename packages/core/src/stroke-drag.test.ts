import { expect, test } from "bun:test";
import { StrokeAnchorDrag } from "./stroke-drag.ts";
import { strokePagePoints } from "./stroke-edit.ts";
import { makeEditor } from "./test-helpers.ts";

function fixture() {
  const editor = makeEditor();
  const stroke = editor.buildElement("draw.freehand", {
    semantic: {
      points: [
        { x: 10, y: 20, pressure: 0.7 },
        { x: 50, y: 60 },
      ],
    },
  });
  editor.apply([{ type: "createElement", element: stroke }]);
  return { editor, stroke };
}

test("control-handle drag moves only that control and commits atomically", () => {
  const { editor, stroke } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: stroke.id,
      semantic: {
        points: [
          {
            x: 10,
            y: 20,
            pressure: 0.7,
            controlIn: { x: 0, y: 10 },
            controlOut: { x: 20, y: 30 },
          },
          { x: 50, y: 60 },
        ],
      },
    },
  ]);
  const before = editor.getSnapshot();
  const current = editor.store.get(stroke.id);
  if (!current) throw new Error("missing stroke");
  const original = strokePagePoints(current);
  const drag = new StrokeAnchorDrag(editor, () => {});
  expect(drag.start(1, stroke.id, 0, "controlOut")).toBe(true);
  drag.move(1, { x: 80, y: 90 });
  expect(editor.getSnapshot()).toEqual(before);
  drag.finish(1, { x: 80, y: 90 });
  const updated = editor.store.get(stroke.id);
  if (!updated) throw new Error("missing updated stroke");
  expect(strokePagePoints(updated)).toEqual([
    { ...original[0], controlOut: { x: 80, y: 90 } },
    original[1],
  ]);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  expect(drag.start(2, stroke.id, 1, "controlIn")).toBe(false);
  drag.dispose();
});

test("canceled control-handle drags preserve the original curve", () => {
  const { editor, stroke } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: stroke.id,
      semantic: {
        points: [
          { x: 0, y: 0, controlOut: { x: 20, y: 40 } },
          { x: 60, y: 0 },
        ],
      },
    },
  ]);
  const before = editor.getSnapshot();
  const drag = new StrokeAnchorDrag(editor, () => {});
  drag.start(1, stroke.id, 0, "controlOut");
  drag.move(1, { x: 50, y: 80 });
  drag.cancel();
  drag.finish(1, { x: 50, y: 80 });
  expect(editor.getSnapshot()).toEqual(before);
  drag.dispose();
});

test("anchor drag previews without document mutations and commits one undo step", () => {
  const { editor, stroke } = fixture();
  const before = editor.getSnapshot();
  const drag = new StrokeAnchorDrag(editor, () => {});
  expect(drag.start(1, stroke.id, 0)).toBe(true);
  expect(drag.start(2, stroke.id, 1)).toBe(false);
  drag.move(1, { x: 30, y: 40 });
  expect(editor.getSnapshot()).toEqual(before);
  drag.finish(2, { x: 100, y: 100 });
  expect(editor.getSnapshot()).toEqual(before);
  drag.finish(1, { x: 30, y: 40 });
  const updated = editor.store.get(stroke.id);
  if (!updated) throw new Error("missing stroke");
  expect(strokePagePoints(updated)).toEqual([
    { x: 30, y: 40, pressure: 0.7 },
    { x: 50, y: 60 },
  ]);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  drag.dispose();
});

for (const reason of [
  "cancel",
  "reload",
  "camera",
  "selection",
  "dispose",
] as const) {
  test(`anchor drag ${reason} discards the unfinished change`, () => {
    const { editor, stroke } = fixture();
    const before = editor.getSnapshot();
    let visible = false;
    const drag = new StrokeAnchorDrag(editor, (points) => {
      visible = points !== null;
    });
    drag.start(1, stroke.id, 0);
    drag.move(1, { x: 100, y: 100 });
    if (reason === "cancel") drag.cancel();
    if (reason === "reload") editor.loadDocument(before);
    if (reason === "camera") editor.camera.set({ x: 1, y: 2, z: 2 });
    if (reason === "selection") editor.selection.set([stroke.id]);
    if (reason === "dispose") drag.dispose();
    drag.finish(1, { x: 100, y: 100 });
    expect(editor.getSnapshot()).toEqual(before);
    expect(visible).toBe(false);
    drag.dispose();
  });
}

test("unchanged drag is a no-op and locked strokes reject anchor gestures", () => {
  const { editor, stroke } = fixture();
  const drag = new StrokeAnchorDrag(editor, () => {});
  const revision = editor.revision;
  drag.start(1, stroke.id, 0);
  drag.finish(1, { x: 10, y: 20 });
  expect(editor.revision).toBe(revision);
  editor.apply([
    { type: "updateVisual", id: stroke.id, visual: { locked: true } },
  ]);
  expect(drag.start(1, stroke.id, 0)).toBe(false);
  drag.dispose();
});
