import { expect, test } from "bun:test";
import { makeEditor } from "./test-helpers.ts";

test("page fit includes rotated extents and ignores hidden off-canvas layers", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: { x: 100, y: 100, width: 200, height: 40, rotation: 90 },
  });
  const hidden = editor.buildElement("shape.geo", {
    visual: { x: 10000, y: 10000, hidden: true },
  });
  editor.apply(
    [shape, hidden].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const box = editor.pageBounds();
  expect(box?.x).toBeCloseTo(180);
  expect(box?.y).toBeCloseTo(20);
  expect(box?.width).toBeCloseTo(40);
  expect(box?.height).toBeCloseTo(200);
  expect(editor.zoomToFit({ width: 200, height: 100 }, { padding: 0 })).toBe(
    true,
  );
  expect(editor.camera.get().z).toBeCloseTo(0.5);
  expect(editor.getBounds(shape.id)?.width).toBe(200);
});

test("selection fit expands groups through rotated members without changing document", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: { x: 100, y: 100, width: 200, height: 40, rotation: 90 },
  });
  const group = editor.buildElement("group", {
    semantic: { memberIds: [shape.id] },
  });
  editor.apply(
    [shape, group].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([group.id]);
  const before = editor.getSnapshot();
  editor.zoomToSelection({ width: 200, height: 100 }, { padding: 0 });
  expect(editor.camera.get().z).toBeCloseTo(0.5);
  expect(editor.getSnapshot()).toEqual(before);
});

test("fit bounds respect clipped children and retain locked visible layers", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: { x: 80, y: 20, width: 200, height: 40 },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Screen", clipContent: true, memberIds: [shape.id] },
    visual: { x: 0, y: 0, width: 100, height: 100, locked: true },
  });
  editor.apply(
    [frame, shape].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(editor.pageBounds()).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  editor.selection.set([shape.id]);
  editor.zoomToSelection({ width: 100, height: 100 }, { padding: 0 });
  expect(editor.camera.get().z).toBeCloseTo(2.5);
});
