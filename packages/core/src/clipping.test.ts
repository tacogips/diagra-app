import { expect, test } from "bun:test";
import { assertValidDocument } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { insideClip, layerClipPolygons, visibleBounds } from "./clipping.ts";
import { makeEditor } from "./test-helpers.ts";

function fixture() {
  const editor = makeEditor();
  const node = editor.buildElement("node.generic", {
    visual: { x: 80, y: 20, width: 60, height: 40 },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Screen", clipContent: true, memberIds: [node.id] },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  editor.apply([
    { type: "createElement", element: frame },
    { type: "createElement", element: node },
  ]);
  return { editor, frame, node };
}

test("clipping preserves full geometry but limits picking and export bounds", () => {
  const { editor, frame, node } = fixture();
  const context = editor.createShapeContext();
  expect(context.clipOf?.(frame.id)).toBeNull();
  expect(editor.getBounds(node.id)?.width).toBe(60);
  expect(visibleBounds(context, node.id)).toEqual({
    x: 80,
    y: 20,
    width: 20,
    height: 40,
  });
  expect(editor.hitTest({ x: 90, y: 40 })).toBe(node.id);
  expect(editor.hitTest({ x: 120, y: 40 })).toBeNull();
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain('clipPathUnits="userSpaceOnUse"');
  expect(svg).toContain('clip-path="url(#diagra-clip-0)"');
  expect(svg).toContain('viewBox="0 0 100 100"');
});

test("nested clips intersect and fully clipped children disappear from export", () => {
  const { editor, frame, node } = fixture();
  const outer = editor.buildElement("frame", {
    semantic: { name: "Outer", clipContent: true, memberIds: [frame.id] },
    visual: { x: 0, y: 0, width: 50, height: 100 },
  });
  editor.apply([{ type: "createElement", element: outer }]);
  const context = editor.createShapeContext();
  expect(context.clipOf?.(node.id)?.width).toBe(50);
  expect(visibleBounds(context, node.id)).toBeNull();
  expect(insideClip(context, node.id, { x: 90, y: 40 })).toBe(false);
  expect(editor.exportPageSvg()).not.toContain(`data-id="${node.id}"`);
});

test("clip flags survive JSONL, reject invalid types and toggle with undo", () => {
  const { editor, frame, node } = fixture();
  const saved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  expect(() =>
    assertValidDocument({
      ...saved,
      elements: [{ ...frame, semantic: { name: "Bad", clipContent: "yes" } }],
    }),
  ).toThrow();
  editor.apply([
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: { ...(frame.semantic as object), clipContent: false },
    },
  ]);
  expect(editor.createShapeContext().clipOf?.(node.id)).toBeNull();
  editor.undo();
  expect(editor.createShapeContext().clipOf?.(node.id)?.width).toBe(100);
});

test("group members inherit their containing frame clip", () => {
  const { editor, frame, node } = fixture();
  const group = editor.buildElement("group", {
    semantic: { memberIds: [node.id] },
  });
  editor.apply([
    { type: "createElement", element: group },
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: { ...(frame.semantic as object), memberIds: [group.id] },
    },
  ]);
  expect(editor.createShapeContext().clipOf?.(node.id)?.width).toBe(100);
});

test("a preview viewport can replace only its own authored frame clip", () => {
  const { editor, frame, node } = fixture();
  const context = editor.createShapeContext();
  expect(context.clipPolygonOf?.(node.id)).not.toBeNull();
  const previewPolygons = layerClipPolygons(
    editor.store,
    context,
    new Set([frame.id]),
  );
  expect(previewPolygons(node.id)).toBeNull();
});

test("frame clips rotate in page space with rectangular and rounded artboards", () => {
  const { editor, frame, node } = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: node.id,
      visual: { x: -50, y: -50, width: 200, height: 200 },
    },
    { type: "updateVisual", id: frame.id, visual: { rotation: 45 } },
  ]);
  let context = editor.createShapeContext();
  expect(insideClip(context, node.id, { x: 50, y: -17 })).toBe(true);
  expect(insideClip(context, node.id, { x: 5, y: 5 })).toBe(false);

  editor.apply([
    {
      type: "updateVisual",
      id: frame.id,
      visual: { style: { cornerRadius: 30 } },
    },
  ]);
  context = editor.createShapeContext();
  expect(insideClip(context, node.id, { x: 50, y: -17 })).toBe(false);
  expect(context.clipPolygonOf?.(node.id)?.length).toBeGreaterThan(4);
});
