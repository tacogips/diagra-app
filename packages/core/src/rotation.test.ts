import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  canRotateElement,
  canRotateSelection,
  rotateElement,
  rotateSelectionBy,
} from "./rotation.ts";
import { makeEditor } from "./test-helpers.ts";

test("leaf rotation normalizes angles, preserves size, persists and undoes", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: { x: 100, y: 100, width: 200, height: 40 },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  const before = editor.getSnapshot();
  expect(rotateElement(editor, shape.id, -270)).toBe(true);
  expect(editor.store.get(shape.id)?.visual).toEqual({
    ...shape.visual,
    rotation: 90,
  });
  expect(editor.hitTest({ x: 200, y: 40 })).toBe(shape.id);
  expect(editor.exportPageSvg({ padding: 0 })).toContain(
    'viewBox="180 20 40 200"',
  );
  const saved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  expect(rotateElement(editor, shape.id, 450)).toBe(false);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.redo();
  expect(editor.getSnapshot()).toEqual(saved);
});

test("rotation accepts frames and rejects missing layers and nonfinite angles", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame");
  const group = editor.buildElement("group");
  const shape = editor.buildElement("shape.geo");
  editor.apply(
    [frame, group, shape].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();
  expect(rotateElement(editor, frame.id, 45)).toBe(true);
  expect(editor.store.get(frame.id)?.visual.rotation).toBe(45);
  expect(rotateElement(editor, "missing", 45)).toBe(false);
  for (const angle of [Number.NaN, Number.POSITIVE_INFINITY])
    expect(rotateElement(editor, shape.id, angle)).toBe(false);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  expect(canRotateElement(editor.buildElement("erd.table"))).toBe(true);
  expect(canRotateElement(editor.buildElement("draw.freehand"))).toBe(true);
  expect(canRotateElement(frame)).toBe(true);
  expect(canRotateElement(group)).toBe(true);
});

test("frame rotation freezes implicit membership and transforms its hierarchy", () => {
  const editor = makeEditor();
  const source = editor.buildElement("frame", {
    semantic: { name: "Desktop source" },
    visual: { x: 500, y: 0, width: 400, height: 300 },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Responsive screen",
      clipContent: true,
      responsiveSource: source.id,
      layout: {
        direction: "horizontal",
        gap: 12,
        padding: 16,
        sizing: "fixed",
        align: "center",
      },
    },
    visual: { x: 0, y: 0, width: 200, height: 100 },
  });
  const first = editor.buildElement("node.generic", {
    semantic: { label: "First" },
    visual: { x: 20, y: 20, width: 40, height: 20 },
  });
  const second = editor.buildElement("node.generic", {
    semantic: { label: "Second" },
    visual: { x: 140, y: 60, width: 40, height: 20 },
  });
  const connector = editor.buildElement("edge.generic", {
    semantic: { from: first.id, to: second.id },
  });
  editor.apply(
    [source, frame, first, second, connector].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();

  expect(rotateElement(editor, frame.id, 90)).toBe(true);
  expect(editor.store.get(frame.id)?.visual).toMatchObject({
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    rotation: 90,
  });
  expect(editor.store.get(first.id)?.visual).toMatchObject({
    x: 80,
    y: -24,
    rotation: 90,
  });
  expect(editor.store.get(second.id)?.visual).toMatchObject({
    x: 80,
    y: 28,
    rotation: 90,
  });
  expect(editor.store.get(frame.id)?.semantic).toMatchObject({
    name: "Responsive screen",
    clipContent: true,
    responsiveSource: source.id,
    memberIds: [first.id, second.id, connector.id],
    layout: { direction: "horizontal", gap: 12 },
  });
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain(`data-id="${connector.id}"`);
  const rotated = editor.getSnapshot();
  expect(parseDocument(serializeDocument(rotated))).toEqual(rotated);
  expect(editor.undo()).toBe(true);
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.redo()).toBe(true);
  expect(editor.getSnapshot()).toEqual(rotated);
});

test("frame rotation advances nested frame and group metadata once", () => {
  const editor = makeEditor();
  const leaf = editor.buildElement("shape.geo", {
    visual: { x: 20, y: 20, width: 20, height: 20 },
  });
  const group = editor.buildElement("group", {
    semantic: { memberIds: [leaf.id] },
  });
  const nested = editor.buildElement("frame", {
    semantic: { name: "Nested", memberIds: [group.id] },
    visual: { x: 10, y: 10, width: 50, height: 50 },
  });
  const outer = editor.buildElement("frame", {
    semantic: { name: "Outer", memberIds: [nested.id] },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  editor.apply(
    [outer, nested, group, leaf].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );

  expect(rotateElement(editor, outer.id, 90)).toBe(true);
  expect(editor.store.get(outer.id)?.visual.rotation).toBe(90);
  expect(editor.store.get(nested.id)?.visual).toMatchObject({
    x: 40,
    y: 10,
    rotation: 90,
  });
  expect(editor.store.get(group.id)?.visual.rotation).toBe(90);
  expect(editor.store.get(leaf.id)?.visual).toMatchObject({
    x: 60,
    y: 20,
    rotation: 90,
  });
});

test("group rotation transforms member positions, orientations and connectors", () => {
  const editor = makeEditor();
  const left = editor.buildElement("node.generic", {
    semantic: { label: "Left" },
    visual: { x: 0, y: 0, width: 100, height: 50 },
  });
  const right = editor.buildElement("node.generic", {
    semantic: { label: "Right" },
    visual: { x: 200, y: 0, width: 100, height: 50 },
  });
  const connector = editor.buildElement("edge.generic", {
    semantic: { from: left.id, to: right.id },
  });
  const group = editor.buildElement("group", {
    semantic: { memberIds: [left.id, right.id, connector.id] },
  });
  editor.apply(
    [left, right, connector, group].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();

  expect(rotateElement(editor, group.id, 90)).toBe(true);
  expect(editor.store.get(left.id)?.visual).toMatchObject({
    x: 100,
    y: -100,
    rotation: 90,
  });
  expect(editor.store.get(right.id)?.visual).toMatchObject({
    x: 100,
    y: 100,
    rotation: 90,
  });
  expect(editor.store.get(group.id)?.visual.rotation).toBe(90);
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain(`data-id="${connector.id}"`);
  expect(svg).toContain('x1="150" y1="-25" x2="150" y2="75"');
  const rotated = editor.getSnapshot();
  expect(parseDocument(serializeDocument(rotated))).toEqual(rotated);

  expect(editor.undo()).toBe(true);
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.redo()).toBe(true);
  expect(editor.getSnapshot()).toEqual(rotated);
});

test("outer group rotation advances nested metadata without double-moving leaves", () => {
  const editor = makeEditor();
  const first = editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 40, height: 40 },
  });
  const second = editor.buildElement("shape.geo", {
    visual: { x: 80, y: 0, width: 40, height: 40 },
  });
  const inner = editor.buildElement("group", {
    semantic: { memberIds: [first.id, second.id] },
  });
  const outer = editor.buildElement("group", {
    semantic: { memberIds: [inner.id] },
  });
  editor.apply(
    [first, second, inner, outer].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(rotateElement(editor, outer.id, 90)).toBe(true);
  expect(editor.store.get(first.id)?.visual).toMatchObject({ x: 40, y: -40 });
  expect(editor.store.get(second.id)?.visual).toMatchObject({ x: 40, y: 40 });
  expect(editor.store.get(first.id)?.visual.rotation).toBe(90);
  expect(editor.store.get(inner.id)?.visual.rotation).toBe(90);
  expect(editor.store.get(outer.id)?.visual.rotation).toBe(90);
});

test("group rotation rejects locked, cyclic and unsupported descendants atomically", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 40, height: 40, locked: true },
  });
  const locked = editor.buildElement("group", {
    semantic: { memberIds: [shape.id] },
  });
  const participant = editor.buildElement("sequence.participant");
  const unsupported = editor.buildElement("group", {
    semantic: { memberIds: [participant.id] },
  });
  const cycleA = editor.buildElement("group", {
    semantic: { memberIds: [] },
  });
  const cycleB = editor.buildElement("group", {
    semantic: { memberIds: [cycleA.id] },
  });
  editor.apply(
    [shape, locked, participant, unsupported, cycleA, cycleB].map(
      (element) => ({
        type: "createElement" as const,
        element,
      }),
    ),
  );
  editor.apply([
    {
      type: "updateSemantic",
      id: cycleA.id,
      semantic: { memberIds: [cycleB.id] },
    },
  ]);
  const before = editor.getSnapshot();
  expect(rotateElement(editor, locked.id, 90)).toBe(false);
  expect(rotateElement(editor, unsupported.id, 90)).toBe(false);
  expect(rotateElement(editor, cycleA.id, 90)).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
});

test("rotation respects inherited locks", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  const frame = editor.buildElement("frame", {
    semantic: { name: "Locked", memberIds: [shape.id] },
    visual: { locked: true },
  });
  editor.apply(
    [frame, shape].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();
  expect(rotateElement(editor, shape.id, 45)).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
});

test("multi-selection rotates leaves around one shared pivot and undoes", () => {
  const editor = makeEditor();
  const left = editor.buildElement("node.generic", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const right = editor.buildElement("node.generic", {
    visual: { x: 200, y: 0, width: 100, height: 100 },
  });
  const connector = editor.buildElement("edge.generic", {
    semantic: { from: left.id, to: right.id },
  });
  editor.apply(
    [left, right, connector].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([left.id, right.id]);
  const before = editor.getSnapshot();

  expect(canRotateSelection(editor)).toBe(true);
  expect(rotateSelectionBy(editor, 90)).toBe(true);
  expect(editor.store.get(left.id)?.visual).toMatchObject({
    x: 100,
    y: -100,
    rotation: 90,
  });
  expect(editor.store.get(right.id)?.visual).toMatchObject({
    x: 100,
    y: 100,
    rotation: 90,
  });
  expect(editor.exportPageSvg({ padding: 0 })).toContain(
    `data-id="${connector.id}"`,
  );
  const rotated = editor.getSnapshot();
  expect(parseDocument(serializeDocument(rotated))).toEqual(rotated);
  expect(editor.undo()).toBe(true);
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.redo()).toBe(true);
  expect(editor.getSnapshot()).toEqual(rotated);
});

test("incremental multi-selection updates retain the gesture's fixed pivot", () => {
  const editor = makeEditor();
  const left = editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const right = editor.buildElement("shape.geo", {
    visual: { x: 300, y: 0, width: 40, height: 100 },
  });
  editor.apply(
    [left, right].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([left.id, right.id]);
  const pivot = { x: 170, y: 50 };

  expect(rotateSelectionBy(editor, 45, pivot)).toBe(true);
  expect(rotateSelectionBy(editor, 45, pivot)).toBe(true);
  const leftVisual = editor.store.get(left.id)?.visual;
  const rightVisual = editor.store.get(right.id)?.visual;
  expect(leftVisual?.x).toBeCloseTo(120);
  expect(leftVisual?.y).toBeCloseTo(-120);
  expect(leftVisual?.rotation).toBe(90);
  expect(rightVisual?.x).toBeCloseTo(150);
  expect(rightVisual?.y).toBeCloseTo(150);
  expect(rightVisual?.rotation).toBe(90);
});

test("multi-selection reduces selected container descendants and freezes implicit frames", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", {
    semantic: { name: "Implicit" },
    visual: { x: 0, y: 0, width: 260, height: 100 },
  });
  const first = editor.buildElement("shape.geo", {
    visual: { x: 20, y: 20, width: 20, height: 20 },
  });
  const second = editor.buildElement("shape.geo", {
    visual: { x: 80, y: 20, width: 20, height: 20 },
  });
  const group = editor.buildElement("group", {
    semantic: { memberIds: [first.id, second.id] },
  });
  const loose = editor.buildElement("shape.geo", {
    visual: { x: 200, y: 20, width: 20, height: 20 },
  });
  editor.apply(
    [frame, first, second, group, loose].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([group.id, first.id, loose.id]);

  expect(rotateSelectionBy(editor, 90)).toBe(true);
  expect(editor.store.get(first.id)?.visual.rotation).toBe(90);
  expect(editor.store.get(second.id)?.visual.rotation).toBe(90);
  expect(editor.store.get(loose.id)?.visual.rotation).toBe(90);
  expect(editor.store.get(group.id)?.visual.rotation).toBe(90);
  expect(editor.store.get(frame.id)?.semantic).toMatchObject({
    name: "Implicit",
    memberIds: [first.id, second.id, group.id, loose.id],
  });
});

test("multi-selection rejects locked, unsupported, nested-only and cross-page roots", () => {
  const editor = makeEditor();
  const first = editor.buildElement("shape.geo");
  const locked = editor.buildElement("shape.geo", { visual: { locked: true } });
  const participant = editor.buildElement("sequence.participant");
  const group = editor.buildElement("group", {
    semantic: { memberIds: [first.id] },
  });
  const otherPage = editor.createPage({ name: "Other" });
  const remote = editor.buildElement("shape.geo", { page: otherPage });
  editor.apply(
    [first, locked, participant, group, remote].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();
  for (const selection of [
    [first.id, locked.id],
    [first.id, participant.id],
    [group.id, first.id],
    [first.id, remote.id],
  ]) {
    editor.selection.set(selection);
    expect(canRotateSelection(editor)).toBe(false);
    expect(rotateSelectionBy(editor, 90)).toBe(false);
  }
  expect(editor.getSnapshot()).toEqual(before);
});
