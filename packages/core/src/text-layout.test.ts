import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  assertValidDocument,
  type Document,
  type TextResizeMode,
} from "@diagra/ir";
import { bindSelectionNumber, createNumberToken } from "./number-tokens.ts";
import { inspectDesign } from "./handoff.ts";
import { MAX_AUTO_TEXT_SIZE, measureTextNote } from "./text-layout.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

test("auto width measures explicit lines with shared typography metrics", () => {
  const note = element({
    id: "note",
    type: "text.note",
    semantic: { text: "Hello\nworld" },
    visual: {
      width: 200,
      height: 48,
      textResize: "auto-width",
      style: { fontSize: 20, lineHeight: 1.5, letterSpacing: 2 },
    },
  });
  expect(measureTextNote(note, "auto-width")).toEqual({
    width: 81,
    height: 72,
  });
});

test("automatic text sizing obeys portable min/max limits", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: { text: "Tiny" },
    visual: {
      textResize: "auto-width",
      minWidth: 120,
      maxHeight: 20,
    },
  });
  editor.apply([{ type: "createElement", element: note }]);
  expect(editor.getBounds(note.id)).toMatchObject({ width: 120, height: 20 });

  editor.apply([
    {
      type: "updateVisual",
      id: note.id,
      visual: { maxWidth: 140 },
    },
  ]);
  editor.setText(note.id, "A deliberately much longer label");
  expect(editor.getBounds(note.id)?.width).toBe(140);
});

test("automatic measurement remains finite for extreme typography", () => {
  const note = element({
    id: "extreme",
    type: "text.note",
    semantic: { text: "large" },
    visual: { style: { fontSize: Number.MAX_VALUE } },
  });
  expect(measureTextNote(note, "auto-width")).toEqual({
    width: MAX_AUTO_TEXT_SIZE,
    height: MAX_AUTO_TEXT_SIZE,
  });
});

test("auto height wraps to the stored width and follows text and typography", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: { text: "short" },
    visual: {
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      textResize: "auto-height",
      style: { fontSize: 10 },
    },
  });
  const sibling = editor.buildElement("node.generic", {
    visual: { x: 0, y: 200, width: 100, height: 40 },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Stack",
      memberIds: [note.id, sibling.id],
      layout: {
        direction: "vertical",
        gap: 10,
        padding: 10,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 0, y: 0, width: 200, height: 300 },
  });
  editor.apply(
    [frame, note, sibling].map((created) => ({
      type: "createElement" as const,
      element: created,
    })),
  );
  expect(editor.getBounds(note.id)?.height).toBe(24);
  expect(editor.getBounds(sibling.id)?.y).toBe(44);
  const before = editor.getSnapshot();

  editor.setText(note.id, "one two three four five six seven");
  expect(editor.getBounds(note.id)?.height).toBe(48);
  expect(editor.getBounds(sibling.id)?.y).toBe(68);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  expect(inspectDesign(editor, note.id)).toMatchObject({
    css: expect.stringContaining("white-space: pre-wrap;"),
    notes: expect.arrayContaining([
      expect.stringContaining("deterministic estimated glyph metrics"),
    ]),
  });
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);

  editor.selection.set([note.id]);
  editor.setSelectionStyle({ fontSize: 20, lineHeight: 1.5 });
  expect(editor.getBounds(note.id)?.height).toBe(42);
  expect(editor.getBounds(sibling.id)?.y).toBe(62);
});

test("text sizing owns its axes, detaches conflicting tokens and manual resize fixes the box", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: { text: "Responsive label" },
    visual: { x: 0, y: 0, width: 120, height: 40 },
  });
  editor.apply([{ type: "createElement", element: note }]);
  const width = createNumberToken(editor, "Text width", 160);
  const height = createNumberToken(editor, "Text height", 60);
  if (!width || !height) throw new Error("missing tokens");
  editor.selection.set([note.id]);
  bindSelectionNumber(editor, "width", width);
  bindSelectionNumber(editor, "height", height);

  expect(editor.setSelectionTextResize("auto-height")).toBe(true);
  expect(editor.store.get(note.id)?.visual.numberTokens).toEqual({ width });
  expect(editor.store.get(note.id)?.visual.width).toBe(160);
  expect(editor.store.get(note.id)?.visual.height).not.toBe(60);
  expect(bindSelectionNumber(editor, "height", height)).toBe(false);
  expect(editor.setSelectionTextResize("auto-width")).toBe(true);
  expect(editor.store.get(note.id)?.visual.numberTokens).toBeUndefined();

  editor.resizeElement(note.id, { x: 10, y: 20, width: 300, height: 90 });
  expect(editor.store.get(note.id)?.visual).toMatchObject({
    x: 10,
    y: 20,
    width: 300,
    height: 90,
    textResize: "fixed",
  });
});

test("owned text axes take precedence over stretch and fill allocation", () => {
  const editor = makeEditor();
  const autoWidth = editor.buildElement("text.note", {
    semantic: { text: "Fit" },
    visual: {
      width: 20,
      height: 20,
      textResize: "auto-width",
      layoutGrow: 1,
    },
  });
  const autoHeight = editor.buildElement("text.note", {
    semantic: { text: "Wrap to the available row width" },
    visual: { width: 50, height: 20, textResize: "auto-height" },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Responsive copy",
      memberIds: [autoWidth.id, autoHeight.id],
      layout: {
        direction: "vertical",
        gap: 10,
        padding: 10,
        sizing: "fixed",
        align: "stretch",
      },
    },
    visual: { x: 0, y: 0, width: 300, height: 300 },
  });
  editor.apply(
    [frame, autoWidth, autoHeight].map((created) => ({
      type: "createElement" as const,
      element: created,
    })),
  );
  expect(editor.getBounds(autoWidth.id)?.width).toBeCloseTo(37.45);
  expect(editor.getBounds(autoWidth.id)?.height).toBeCloseTo(27.6);
  expect(editor.getBounds(autoHeight.id)?.width).toBe(280);
  expect(editor.getBounds(autoHeight.id)?.height).toBeCloseTo(27.6);
});

test("responsive constraints do not stretch auto-owned text axes", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note", {
    semantic: { text: "Intrinsic" },
    visual: {
      x: 10,
      y: 10,
      width: 40,
      height: 20,
      textResize: "auto-width",
      horizontalConstraint: "stretch",
      verticalConstraint: "stretch",
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Screen", memberIds: [note.id] },
    visual: { x: 0, y: 0, width: 200, height: 100 },
  });
  editor.apply(
    [frame, note].map((created) => ({
      type: "createElement" as const,
      element: created,
    })),
  );
  const before = editor.getBounds(note.id);
  editor.resizeElement(frame.id, { x: 0, y: 0, width: 400, height: 300 });
  expect(editor.getBounds(note.id)).toEqual(before);
});

test("text sizing rejects invalid commands and documents", () => {
  const editor = makeEditor();
  const note = editor.buildElement("text.note");
  editor.apply([{ type: "createElement", element: note }]);
  expect(() =>
    editor.apply([
      {
        type: "updateVisual",
        id: note.id,
        visual: { textResize: "elastic" as TextResizeMode },
      },
    ]),
  ).toThrow();
  expect(() =>
    assertValidDocument({
      ...document(),
      elements: [
        {
          ...note,
          visual: { textResize: "elastic" as TextResizeMode },
        },
      ],
    } as Document),
  ).toThrow();
});
