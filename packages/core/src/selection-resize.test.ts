import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  canResizeSelection,
  createSelectionResizeSnapshot,
  resizeSelection,
} from "./selection-resize.ts";
import { makeEditor } from "./test-helpers.ts";

test("multi-selection resize scales boxes from one stable envelope and undoes", () => {
  const editor = makeEditor();
  const left = editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const right = editor.buildElement("node.generic", {
    visual: { x: 200, y: 0, width: 100, height: 100 },
  });
  editor.apply(
    [left, right].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([left.id, right.id]);
  const before = editor.getSnapshot();
  const snapshot = createSelectionResizeSnapshot(editor);
  expect(snapshot?.bounds).toEqual({ x: 0, y: 0, width: 300, height: 100 });
  if (!snapshot) throw new Error("expected resize snapshot");

  expect(
    resizeSelection(editor, snapshot, {
      x: 0,
      y: 0,
      width: 600,
      height: 200,
    }),
  ).toBe(true);
  expect(editor.store.get(left.id)?.visual).toMatchObject({
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  });
  expect(editor.store.get(right.id)?.visual).toMatchObject({
    x: 400,
    y: 0,
    width: 200,
    height: 200,
  });
  const resized = editor.getSnapshot();
  expect(parseDocument(serializeDocument(resized))).toEqual(resized);
  expect(editor.undo()).toBe(true);
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.redo()).toBe(true);
  expect(editor.getSnapshot()).toEqual(resized);
});

test("successive updates remain absolute and rotated axes scale correctly", () => {
  const editor = makeEditor();
  const upright = editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const rotated = editor.buildElement("shape.geo", {
    visual: { x: 200, y: 0, width: 100, height: 50, rotation: 90 },
  });
  editor.apply(
    [upright, rotated].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([upright.id, rotated.id]);
  const snapshot = createSelectionResizeSnapshot(editor);
  if (!snapshot) throw new Error("expected resize snapshot");
  const first = { ...snapshot.bounds, width: snapshot.bounds.width * 1.5 };
  const final = { ...snapshot.bounds, width: snapshot.bounds.width * 2 };
  expect(resizeSelection(editor, snapshot, first)).toBe(true);
  expect(resizeSelection(editor, snapshot, final)).toBe(true);

  expect(editor.store.get(upright.id)?.visual.width).toBeCloseTo(200);
  expect(editor.store.get(rotated.id)?.visual.width).toBeCloseTo(100);
  expect(editor.store.get(rotated.id)?.visual.height).toBeCloseTo(100);
  expect(editor.store.get(rotated.id)?.visual.rotation).toBeCloseTo(90);
});

test("group descendants resize once and implicit frame membership freezes", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", {
    semantic: { name: "Implicit" },
    visual: { x: 0, y: 0, width: 400, height: 200 },
  });
  const left = editor.buildElement("shape.geo", {
    visual: { x: 20, y: 20, width: 40, height: 40 },
  });
  const right = editor.buildElement("shape.geo", {
    visual: { x: 100, y: 20, width: 40, height: 40 },
  });
  const group = editor.buildElement("group", {
    semantic: { memberIds: [left.id, right.id] },
  });
  const loose = editor.buildElement("shape.geo", {
    visual: { x: 300, y: 20, width: 40, height: 40 },
  });
  editor.apply(
    [frame, left, right, group, loose].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([group.id, left.id, loose.id]);
  const snapshot = createSelectionResizeSnapshot(editor);
  expect(snapshot?.roots).toEqual([group.id, loose.id]);
  if (!snapshot) throw new Error("expected resize snapshot");
  expect(
    resizeSelection(editor, snapshot, {
      ...snapshot.bounds,
      width: snapshot.bounds.width * 2,
    }),
  ).toBe(true);
  expect(editor.store.get(left.id)?.visual.width).toBe(80);
  expect(editor.store.get(right.id)?.visual.width).toBe(80);
  expect(editor.store.get(loose.id)?.visual.width).toBe(80);
  expect(editor.store.get(frame.id)?.semantic).toMatchObject({
    name: "Implicit",
    memberIds: [left.id, right.id, group.id, loose.id],
  });
});

test("selected frames resize through their constraint and auto-layout pipeline", () => {
  const editor = makeEditor();
  const child = editor.buildElement("shape.geo", {
    visual: { x: 10, y: 10, width: 40, height: 40 },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Row",
      memberIds: [child.id],
      layout: {
        direction: "horizontal",
        gap: 0,
        padding: 10,
        sizing: "fixed",
        align: "stretch",
      },
    },
    visual: { x: 0, y: 0, width: 100, height: 60 },
  });
  const loose = editor.buildElement("shape.geo", {
    visual: { x: 200, y: 0, width: 100, height: 60 },
  });
  editor.apply(
    [frame, child, loose].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([frame.id, loose.id]);
  const snapshot = createSelectionResizeSnapshot(editor);
  if (!snapshot) throw new Error("expected resize snapshot");
  expect(
    resizeSelection(editor, snapshot, {
      ...snapshot.bounds,
      height: 120,
    }),
  ).toBe(true);
  expect(editor.store.get(frame.id)?.visual.height).toBe(120);
  expect(editor.store.get(child.id)?.visual).toMatchObject({
    y: 10,
    height: 100,
  });
});

test("semantic engineering heights stay derived while their centers scale", () => {
  const editor = makeEditor();
  const table = editor.buildElement("erd.table", {
    visual: { x: 0, y: 0, width: 200 },
  });
  const shape = editor.buildElement("shape.geo", {
    visual: { x: 300, y: 100, width: 100, height: 100 },
  });
  editor.apply(
    [table, shape].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([table.id, shape.id]);
  const before = editor.getBounds(table.id);
  const snapshot = createSelectionResizeSnapshot(editor);
  if (!before || !snapshot) throw new Error("expected engineering geometry");
  expect(
    resizeSelection(editor, snapshot, {
      x: snapshot.bounds.x,
      y: snapshot.bounds.y,
      width: snapshot.bounds.width * 2,
      height: snapshot.bounds.height * 2,
    }),
  ).toBe(true);
  const after = editor.getBounds(table.id);
  expect(after?.height).toBe(before.height);
  expect(after?.width).toBe(before.width * 2);
  expect(after && after.y + after.height / 2).toBeCloseTo(
    snapshot.bounds.y + (before.y + before.height / 2 - snapshot.bounds.y) * 2,
  );
});

test("invalid multi-resize selections reject without document changes", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  const locked = editor.buildElement("shape.geo", { visual: { locked: true } });
  const activation = editor.buildElement("sequence.activation", {
    visual: { x: 100, y: 100, width: 10, height: 80 },
  });
  const otherPage = editor.createPage({ name: "Other" });
  const remote = editor.buildElement("shape.geo", { page: otherPage });
  editor.apply(
    [shape, locked, activation, remote].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();
  for (const ids of [
    [shape.id, locked.id],
    [shape.id, activation.id],
    [shape.id, remote.id],
  ]) {
    editor.selection.set(ids);
    expect(canResizeSelection(editor)).toBe(false);
    expect(createSelectionResizeSnapshot(editor)).toBeNull();
  }
  expect(editor.getSnapshot()).toEqual(before);
});

test("non-uniform multi-selection resize preserves each locked item ratio", () => {
  const editor = makeEditor();
  const locked = editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 50, aspectRatio: 2 },
  });
  const loose = editor.buildElement("shape.geo", {
    visual: { x: 200, y: 0, width: 100, height: 50 },
  });
  editor.apply(
    [locked, loose].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([locked.id, loose.id]);
  const snapshot = createSelectionResizeSnapshot(editor);
  if (!snapshot) throw new Error("expected resize snapshot");
  expect(
    resizeSelection(editor, snapshot, {
      ...snapshot.bounds,
      width: snapshot.bounds.width * 2,
      height: snapshot.bounds.height * 3,
    }),
  ).toBe(true);
  const bounds = editor.getBounds(locked.id);
  expect(bounds && bounds.width / bounds.height).toBeCloseTo(2);
});
