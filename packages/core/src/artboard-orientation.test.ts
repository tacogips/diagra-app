import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { Editor } from "./editor.ts";
import {
  artboardOrientationIssue,
  swapArtboardOrientation,
} from "./artboard-orientation.ts";

test("orientation swaps locked proportions and reflows constrained children atomically", () => {
  const editor = new Editor();
  const child = editor.buildElement("node.generic", {
    visual: {
      x: 20,
      y: 20,
      width: 100,
      height: 40,
      horizontalConstraint: "end",
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Phone",
      platform: "ios",
      memberIds: [child.id],
      safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
    },
    visual: { x: 0, y: 0, width: 390, height: 844, aspectRatio: 390 / 844 },
  });
  editor.apply(
    [frame, child].map((element) => ({ type: "createElement", element })),
  );
  const before = editor.getSnapshot();
  expect(swapArtboardOrientation(editor, frame.id)).toBe(true);
  expect(editor.getBounds(frame.id)).toMatchObject({ width: 844, height: 390 });
  expect(editor.getBounds(child.id)?.x).toBe(474);
  expect(editor.store.get(frame.id)?.visual.aspectRatio).toBe(844 / 390);
  expect(editor.store.get(frame.id)?.semantic).toEqual(frame.semantic);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("orientation respects fixed auto layout and rejects hug or limited artboards", () => {
  const editor = new Editor();
  const child = editor.buildElement("node.generic", {
    visual: { width: 100, height: 40 },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Web",
      memberIds: [child.id],
      layout: {
        direction: "vertical",
        sizing: "fixed",
        align: "stretch",
        gap: 10,
        padding: 20,
      },
    },
    visual: { width: 600, height: 400 },
  });
  editor.apply(
    [frame, child].map((element) => ({ type: "createElement", element })),
  );
  expect(swapArtboardOrientation(editor, frame.id)).toBe(true);
  expect(editor.getBounds(child.id)?.width).toBe(360);
  editor.apply([
    { type: "updateVisual", id: frame.id, visual: { maxWidth: 500 } },
  ]);
  expect(artboardOrientationIssue(editor, frame.id)).toContain("size limits");
  const before = editor.getSnapshot();
  expect(swapArtboardOrientation(editor, frame.id)).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
  const hug = editor.createElement("frame", {
    semantic: {
      name: "Hug",
      layout: {
        direction: "vertical",
        sizing: "hug",
        align: "start",
        gap: 10,
        padding: 20,
      },
    },
  });
  expect(artboardOrientationIssue(editor, hug)).toContain("fixed");
  editor.apply([
    { type: "updateVisual", id: frame.id, visual: { locked: true } },
  ]);
  expect(artboardOrientationIssue(editor, frame.id)).toContain("Unlock");
});

test("nested orientation preserves membership and rejects parent-controlled flow dimensions", () => {
  const editor = new Editor();
  const inner = editor.buildElement("frame", {
    semantic: { name: "Nested screen" },
    visual: { x: 40, y: 40, width: 300, height: 500 },
  });
  const outer = editor.buildElement("frame", {
    semantic: { name: "Presentation", memberIds: [inner.id] },
    visual: { x: 0, y: 0, width: 1200, height: 900 },
  });
  editor.apply(
    [outer, inner].map((element) => ({ type: "createElement", element })),
  );
  expect(swapArtboardOrientation(editor, inner.id)).toBe(true);
  expect(editor.getBounds(inner.id)).toEqual({
    x: 40,
    y: 40,
    width: 500,
    height: 300,
  });
  expect(editor.store.get(outer.id)?.semantic).toEqual(outer.semantic);
  editor.apply([
    {
      type: "updateSemantic",
      id: outer.id,
      semantic: {
        name: "Presentation",
        memberIds: [inner.id],
        layout: {
          direction: "vertical",
          sizing: "fixed",
          align: "stretch",
          gap: 10,
          padding: 20,
        },
      },
    },
  ]);
  expect(artboardOrientationIssue(editor, inner.id)).toContain("absolute");
  expect(swapArtboardOrientation(editor, inner.id)).toBe(false);
  editor.apply([
    {
      type: "updateVisual",
      id: inner.id,
      visual: { layoutPosition: "absolute" },
    },
  ]);
  const before = editor.getSnapshot();
  expect(swapArtboardOrientation(editor, inner.id)).toBe(true);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});
