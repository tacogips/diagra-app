import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { constrainAxis } from "./constraints.ts";
import { rotateElement } from "./rotation.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

test("axis rules preserve margins, center, stretch and scale", () => {
  expect(constrainAxis(20, 40, 100, 200, "end")).toEqual({
    position: 120,
    size: 40,
  });
  expect(constrainAxis(20, 40, 100, 200, "center")).toEqual({
    position: 70,
    size: 40,
  });
  expect(constrainAxis(20, 40, 100, 200, "stretch")).toEqual({
    position: 20,
    size: 140,
  });
  expect(constrainAxis(20, 40, 100, 200, "scale")).toEqual({
    position: 40,
    size: 80,
  });
  expect(constrainAxis(20, 40, 100, 1, "stretch").size).toBe(1);
});

test("nested responsive resizing is atomic and survives JSONL", () => {
  const editor = makeEditor();
  const child = editor.buildElement("node.generic", {
    visual: {
      x: 50,
      y: 50,
      width: 100,
      height: 40,
      horizontalConstraint: "end",
      verticalConstraint: "center",
    },
  });
  const inner = editor.buildElement("frame", {
    semantic: { name: "Inner", memberIds: [child.id] },
    visual: {
      x: 20,
      y: 20,
      width: 200,
      height: 200,
      horizontalConstraint: "stretch",
      verticalConstraint: "stretch",
    },
  });
  const outer = editor.buildElement("frame", {
    semantic: { name: "Outer", memberIds: [inner.id] },
    visual: { x: 0, y: 0, width: 400, height: 400 },
  });
  editor.apply(
    [child, inner, outer].map((element) => ({
      type: "createElement",
      element,
    })),
  );
  const before = editor.getSnapshot();
  editor.resizeElement(outer.id, { x: 0, y: 0, width: 600, height: 600 });
  expect(editor.getBounds(inner.id)?.width).toBe(400);
  expect(editor.getBounds(child.id)?.x).toBe(250);
  expect(editor.getBounds(child.id)?.y).toBe(150);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("auto layout controls its children instead of end anchoring", () => {
  const editor = makeEditor();
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
      name: "Stack",
      memberIds: [child.id],
      layout: {
        direction: "vertical",
        gap: 10,
        padding: 20,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 0, y: 0, width: 200, height: 200 },
  });
  editor.apply(
    [child, frame].map((element) => ({ type: "createElement", element })),
  );
  editor.resizeElement(frame.id, { x: 0, y: 0, width: 400, height: 200 });
  expect(editor.getBounds(child.id)?.x).toBe(20);
});

test("absolute auto-layout members retain responsive constraints", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        index: "a0",
        semantic: {
          name: "Card",
          memberIds: ["flow", "badge"],
          layout: {
            direction: "vertical",
            gap: 10,
            padding: 20,
            sizing: "fixed",
            align: "start",
          },
        },
        visual: { x: 100, y: 100, width: 400, height: 300 },
      }),
      element({
        id: "flow",
        type: "shape.geo",
        index: "a1",
        semantic: { geo: "rect" },
        visual: { x: 120, y: 120, width: 100, height: 40 },
      }),
      element({
        id: "badge",
        type: "shape.geo",
        index: "a2",
        semantic: { geo: "ellipse" },
        visual: {
          x: 450,
          y: 220,
          width: 30,
          height: 30,
          layoutPosition: "absolute",
          horizontalConstraint: "end",
          verticalConstraint: "center",
        },
      }),
    ]),
  });
  editor.apply([
    {
      type: "updateVisual",
      id: "frame",
      visual: { width: 600, height: 500 },
    },
  ]);
  expect(editor.getBounds("flow")).toMatchObject({ x: 120, y: 120 });
  expect(editor.getBounds("badge")).toMatchObject({ x: 650, y: 320 });
});

test("constraints resize through a rotated frame's local axes", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        index: "a1",
        semantic: { name: "Frame", memberIds: ["child"] },
        visual: { x: 0, y: 0, width: 200, height: 100 },
      }),
      element({
        id: "child",
        type: "shape.geo",
        index: "a2",
        semantic: { geo: "rect" },
        visual: {
          x: 20,
          y: 20,
          width: 40,
          height: 20,
          horizontalConstraint: "end",
          verticalConstraint: "start",
        },
      }),
    ]),
  });
  expect(rotateElement(editor, "frame", 90)).toBe(true);
  const rotated = editor.getSnapshot();
  editor.resizeElement("frame", { x: 0, y: 0, width: 300, height: 100 });
  expect(editor.store.get("child")?.visual).toMatchObject({
    x: 150,
    y: 30,
    width: 40,
    height: 20,
    rotation: 90,
  });
  editor.undo();
  expect(editor.getSnapshot()).toEqual(rotated);
});

test("responsive stretch preserves a child's stored aspect ratio", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "frame",
        type: "frame",
        index: "a1",
        semantic: { name: "Frame", memberIds: ["child"] },
        visual: { x: 0, y: 0, width: 200, height: 100 },
      }),
      element({
        id: "child",
        type: "shape.geo",
        index: "a2",
        semantic: { geo: "rect" },
        visual: {
          x: 20,
          y: 20,
          width: 40,
          height: 20,
          aspectRatio: 2,
          horizontalConstraint: "stretch",
          verticalConstraint: "start",
        },
      }),
    ]),
  });
  editor.resizeElement("frame", { x: 0, y: 0, width: 400, height: 100 });
  expect(editor.getBounds("child")).toEqual({
    x: 20,
    y: 20,
    width: 240,
    height: 120,
  });
});
