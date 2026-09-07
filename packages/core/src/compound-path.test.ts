import { describe, expect, test } from "bun:test";
import type { GroupSemantic, PathSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { PathAnchorDrag, pathWorldContours } from "./compound-path-edit.ts";
import { inspectDesign } from "./handoff.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { generateMobileInterfaceCode } from "./mobile-code.ts";
import { compoundPathGeometry } from "./shapes/compound-path.ts";
import { makeEditor } from "./test-helpers.ts";

function booleanFixture(
  operation: "union" | "subtract" | "intersect" | "exclude",
) {
  const editor = makeEditor();
  const outer = editor.createElement("shape.geo", {
    semantic: { geo: "rect", label: "Outer" },
    visual: {
      x: 0,
      y: 0,
      width: 120,
      height: 100,
      style: { fill: "#ef4444", stroke: "#111827", strokeWidth: 2 },
    },
  });
  const inner = editor.createElement("shape.geo", {
    semantic: { geo: "rect", label: "Inner" },
    visual: { x: 30, y: 25, width: 60, height: 50 },
  });
  const group = editor.createElement("group", {
    semantic: { memberIds: [outer, inner], booleanOperation: operation },
  });
  return { editor, outer, inner, group };
}

describe("editable compound paths", () => {
  test("Boolean flatten preserves holes, paint, JSONL, SVG and exact picking", () => {
    const { editor, group } = booleanFixture("subtract");
    editor.selection.set([group]);
    const pathId = editor.flattenBooleanSelection();
    expect(pathId).not.toBeNull();
    const path = editor.store.get(pathId ?? "");
    expect(path?.type).toBe("draw.path");
    expect((path?.semantic as PathSemantic).contours).toHaveLength(2);
    expect(path?.visual.style).toMatchObject({
      fill: "#ef4444",
      stroke: "#111827",
      strokeWidth: 2,
    });
    expect(editor.hitTest({ x: 10, y: 10 })).toBe(pathId);
    expect(editor.hitTest({ x: 60, y: 50 })).toBeNull();
    const svg = editor.exportPageSvg({ padding: 0 });
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain("M0 0 L120 0");
    const saved = editor.getSnapshot();
    expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  });

  test("all Boolean operations resolve to deterministic non-empty contours", () => {
    for (const operation of [
      "union",
      "subtract",
      "intersect",
      "exclude",
    ] as const) {
      const { editor, group } = booleanFixture(operation);
      editor.selection.set([group]);
      const id = editor.flattenBooleanSelection();
      const element = id ? editor.store.get(id) : undefined;
      expect(element?.type).toBe("draw.path");
      expect(compoundPathGeometry(element!)?.path).toStartWith("M");
    }
  });

  test("flatten remaps parent and prototype references and undoes atomically", () => {
    const { editor, outer, inner, group } = booleanFixture("union");
    const frame = editor.createElement("frame", {
      semantic: { name: "Screen", memberIds: [group], prototypeStart: true },
      visual: { x: -20, y: -20, width: 200, height: 160 },
    });
    const target = editor.createElement("frame", {
      semantic: { name: "Target", memberIds: [] },
      visual: { x: 300, y: 0, width: 100, height: 100 },
    });
    const link = editor.createElement("edge.generic", {
      semantic: { from: group, to: target, prototype: true },
    });
    const before = editor.getSnapshot();
    editor.selection.set([group]);
    const path = editor.flattenBooleanSelection();
    if (!path) throw new Error("flatten failed");
    expect(
      (editor.store.get(frame)?.semantic as GroupSemantic).memberIds,
    ).toEqual([path]);
    expect(editor.store.get(link)?.semantic).toMatchObject({
      from: path,
      to: target,
    });
    expect(inspectDesign(editor, path)?.css).toContain("mask-image: url(");
    expect(generateInterfaceCode(editor, frame)?.css).toContain(
      "mask-image: url(",
    );
    const native = generateMobileInterfaceCode(editor, frame);
    expect(native?.swiftUi).toContain("FillStyle(eoFill: true)");
    expect(native?.jetpackCompose).toContain("PathFillType.EvenOdd");
    expect(editor.store.has(group)).toBe(false);
    expect(editor.store.has(outer)).toBe(false);
    expect(editor.store.has(inner)).toBe(false);
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
  });

  test("rotated path anchor dragging preserves other world anchors and undo", () => {
    const editor = makeEditor();
    const path = editor.createElement("draw.path", {
      semantic: {
        name: "Triangle",
        contours: [
          {
            points: [
              { x: 0, y: 0, controlOut: { x: 20, y: 0 } },
              { x: 100, y: 0 },
              { x: 50, y: 80 },
            ],
          },
        ],
        fillRule: "evenodd",
      },
      visual: { x: 100, y: 100, width: 200, height: 160, rotation: 30 },
    });
    editor.selection.set([path]);
    const before = editor.getSnapshot();
    const original = pathWorldContours(editor.store.get(path)!);
    const drag = new PathAnchorDrag(editor, () => {});
    expect(drag.start(1, path, 0, 0)).toBe(true);
    drag.finish(1, { x: 75, y: 90 });
    const changed = pathWorldContours(editor.store.get(path)!);
    expect(changed[0]?.[0]?.x).toBeCloseTo(75);
    expect(changed[0]?.[0]?.y).toBeCloseTo(90);
    expect(changed[0]?.[1]?.x).toBeCloseTo(original[0]?.[1]?.x ?? 0);
    expect(editor.store.get(path)?.visual.rotation).toBe(30);
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
    drag.dispose();
  });

  test("empty Boolean results cannot advertise or execute flattening", () => {
    const editor = makeEditor();
    const first = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const second = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const group = editor.createElement("group", {
      semantic: {
        memberIds: [first, second],
        booleanOperation: "subtract",
      },
    });
    editor.selection.set([group]);
    const before = editor.getSnapshot();
    expect(editor.flattenBooleanSelection()).toBeNull();
    expect(editor.getSnapshot()).toEqual(before);
  });
});
