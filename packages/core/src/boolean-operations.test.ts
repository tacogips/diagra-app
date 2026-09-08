import { describe, expect, test } from "bun:test";
import type { BooleanOperation, GroupSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  booleanGeometry,
  booleanGeometryContains,
  booleanMaskCss,
  booleanSourceGeometry,
  booleanSourcePolygon,
  setGroupBooleanOperation,
} from "./boolean-operations.ts";
import { inspectDesign } from "./handoff.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { generateMobileInterfaceCode } from "./mobile-code.ts";
import { prototypeScreen } from "./prototype.ts";
import { makeEditor } from "./test-helpers.ts";

function fixture(operation: BooleanOperation = "union") {
  const editor = makeEditor();
  const first = editor.createElement("shape.geo", {
    semantic: { geo: "rect", label: "First" },
    visual: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      style: { fill: "#ef4444" },
    },
  });
  const second = editor.createElement("shape.geo", {
    semantic: { geo: "ellipse", label: "Second" },
    visual: {
      x: 50,
      y: 0,
      width: 100,
      height: 100,
      style: { fill: "#2563eb" },
    },
  });
  const group = editor.createElement("group", {
    semantic: { memberIds: [first, second], booleanOperation: operation },
  });
  return { editor, first, second, group };
}

describe("non-destructive Boolean groups", () => {
  test("all four operations share ordered rotated outline geometry", () => {
    const expected: Readonly<
      Record<BooleanOperation, readonly [boolean, boolean, boolean]>
    > = {
      union: [true, true, true],
      subtract: [true, false, false],
      intersect: [false, true, false],
      exclude: [true, false, true],
    };
    for (const operation of [
      "union",
      "subtract",
      "intersect",
      "exclude",
    ] as const) {
      const { editor, group } = fixture(operation);
      const geometry = booleanGeometry(
        editor.store.get(group)!,
        editor.createShapeContext(),
      );
      expect(geometry?.bounds).toEqual({ x: 0, y: 0, width: 149, height: 100 });
      expect(
        [
          { x: 25, y: 50 },
          { x: 75, y: 50 },
          { x: 125, y: 50 },
        ].map((point) =>
          geometry ? booleanGeometryContains(geometry, point) : false,
        ),
      ).toEqual([...expected[operation]]);
    }
  });

  test("subtract holes do not pick hidden source geometry", () => {
    const { editor, group } = fixture("subtract");
    expect(editor.hitTest({ x: 25, y: 50 })).toBe(group);
    expect(editor.hitTest({ x: 75, y: 50 })).toBeNull();
  });

  test("rotated, concave and closed freehand operands retain real outlines", () => {
    const editor = makeEditor();
    const rotated = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 0, y: 0, width: 100, height: 100, rotation: 45 },
    });
    const star = editor.createElement("shape.geo", {
      semantic: { geo: "star" },
      visual: { x: 120, y: 0, width: 100, height: 100 },
    });
    const closed = editor.createElement("draw.freehand", {
      semantic: {
        points: [
          { x: 0, y: 120 },
          { x: 100, y: 120 },
          { x: 50, y: 200 },
        ],
        closed: true,
      },
    });
    const open = editor.createElement("draw.freehand", {
      semantic: {
        points: [
          { x: 120, y: 120 },
          { x: 220, y: 200 },
        ],
      },
    });
    const context = editor.createShapeContext();
    expect(
      booleanSourcePolygon(editor.store.get(rotated), context)?.[0]?.y,
    ).toBeCloseTo(-20.7107, 3);
    expect(
      booleanSourcePolygon(editor.store.get(star), context)?.length,
    ).toBeGreaterThan(8);
    expect(
      booleanSourcePolygon(editor.store.get(closed), context)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(booleanSourcePolygon(editor.store.get(open), context)).toBeNull();
  });

  test("solid open strokes expand with caps, joins, curves and pressure", () => {
    const editor = makeEditor();
    const square = editor.createElement("draw.freehand", {
      semantic: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 80 },
        ],
      },
      visual: {
        style: {
          stroke: "#111827",
          strokeWidth: 20,
          strokeCap: "square",
          strokeJoin: "miter",
          strokeMiterLimit: 4,
        },
      },
    });
    const pressure = editor.createElement("draw.freehand", {
      semantic: {
        points: [
          { x: 140, y: 0, pressure: 0 },
          {
            x: 240,
            y: 0,
            pressure: 1,
            controlIn: { x: 210, y: 60 },
          },
        ],
      },
      visual: { rotation: 10, style: { strokeWidth: 20 } },
    });
    const dashed = editor.createElement("draw.freehand", {
      semantic: {
        points: [
          { x: 0, y: 120 },
          { x: 100, y: 120 },
        ],
      },
      visual: { style: { strokeWidth: 10, dash: "dashed" } },
    });
    const context = editor.createShapeContext();
    const squareGeometry = booleanSourceGeometry(
      editor.store.get(square),
      context,
    );
    expect(squareGeometry).not.toBeNull();
    expect(squareGeometry?.flat(2).some((point) => point.x <= -9.999)).toBe(
      true,
    );
    expect(squareGeometry?.flat(2).some((point) => point.x >= 109.999)).toBe(
      true,
    );
    expect(
      booleanSourceGeometry(editor.store.get(pressure), context)?.flat(2)
        .length,
    ).toBeGreaterThan(30);
    expect(
      booleanSourceGeometry(editor.store.get(dashed), context),
    ).not.toBeNull();

    const cutter = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 90, y: -20, width: 40, height: 40 },
    });
    const intersection = editor.createElement("group", {
      semantic: {
        memberIds: [square, cutter],
        booleanOperation: "intersect",
      },
    });
    const geometry = booleanGeometry(editor.store.get(intersection)!, context);
    if (!geometry) throw new Error("missing expanded-stroke Boolean geometry");
    expect(booleanGeometryContains(geometry, { x: 95, y: 0 })).toBe(true);
    expect(booleanGeometryContains(geometry, { x: 70, y: 0 })).toBe(false);
    editor.selection.set([intersection]);
    const flattened = editor.flattenBooleanSelection();
    const flattenedElement = editor.store.get(flattened ?? "");
    expect(flattenedElement?.type).toBe("draw.path");
    expect(flattenedElement?.visual.style?.fill).toBe("#111827");
    expect(flattenedElement?.visual.style?.stroke).toBeUndefined();
    expect(flattenedElement?.visual.style?.strokeWidth).toBeUndefined();
  });

  test("open-stroke Boolean geometry distinguishes cap and join styles", () => {
    const geometryFor = (
      strokeCap: "butt" | "round" | "square",
      strokeJoin: "miter" | "round" | "bevel",
    ) => {
      const editor = makeEditor();
      const stroke = editor.createElement("draw.freehand", {
        semantic: {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
        },
        visual: {
          style: {
            strokeWidth: 20,
            strokeCap,
            strokeJoin,
            strokeMiterLimit: 4,
          },
        },
      });
      const distant = editor.createElement("shape.geo", {
        semantic: { geo: "rect" },
        visual: { x: 200, y: 0, width: 10, height: 10 },
      });
      const group = editor.createElement("group", {
        semantic: { memberIds: [stroke, distant], booleanOperation: "union" },
      });
      const geometry = booleanGeometry(
        editor.store.get(group)!,
        editor.createShapeContext(),
      );
      if (!geometry) throw new Error("missing cap/join geometry");
      return geometry;
    };
    expect(
      booleanGeometryContains(geometryFor("butt", "bevel"), { x: -5, y: 0 }),
    ).toBe(false);
    expect(
      booleanGeometryContains(geometryFor("round", "bevel"), { x: -5, y: 0 }),
    ).toBe(true);
    expect(
      booleanGeometryContains(geometryFor("square", "bevel"), { x: -5, y: 0 }),
    ).toBe(true);
    expect(
      booleanGeometryContains(geometryFor("butt", "miter"), { x: 108, y: -8 }),
    ).toBe(true);
    expect(
      booleanGeometryContains(geometryFor("butt", "round"), { x: 108, y: -8 }),
    ).toBe(false);
    expect(
      booleanGeometryContains(geometryFor("butt", "bevel"), { x: 108, y: -8 }),
    ).toBe(false);
  });

  test("nested Boolean groups and compound holes remain exact operands", () => {
    const editor = makeEditor();
    const outer = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 0, y: 0, width: 120, height: 100 },
    });
    const hole = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 30, y: 25, width: 60, height: 50 },
    });
    const nested = editor.createElement("group", {
      semantic: {
        memberIds: [outer, hole],
        booleanOperation: "subtract",
      },
    });
    const island = editor.createElement("shape.geo", {
      semantic: { geo: "ellipse" },
      visual: { x: 150, y: 20, width: 60, height: 60 },
    });
    const parent = editor.createElement("group", {
      semantic: {
        memberIds: [nested, island],
        booleanOperation: "union",
      },
    });
    const geometry = booleanGeometry(
      editor.store.get(parent)!,
      editor.createShapeContext(),
    );
    if (!geometry) throw new Error("missing nested geometry");
    expect(geometry.operands[0]).toHaveLength(1);
    expect(geometry.operands[0]?.[0]).toHaveLength(2);
    expect(booleanGeometryContains(geometry, { x: 10, y: 10 })).toBe(true);
    expect(booleanGeometryContains(geometry, { x: 60, y: 50 })).toBe(false);
    expect(booleanGeometryContains(geometry, { x: 180, y: 50 })).toBe(true);
    expect(booleanMaskCss(geometry)).toContain("fill-rule%3D%22evenodd%22");

    editor.selection.set([parent]);
    const flattened = editor.flattenBooleanSelection();
    expect(flattened).not.toBeNull();
    expect(editor.store.has(nested)).toBe(false);
    expect(editor.store.has(outer)).toBe(false);
    expect(editor.store.has(hole)).toBe(false);
    expect(editor.store.has(island)).toBe(false);
    expect(
      (
        editor.store.get(flattened ?? "")?.semantic as {
          contours?: unknown[];
        }
      ).contours,
    ).toHaveLength(3);
    const extra = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 230, y: 0, width: 40, height: 40 },
    });
    editor.selection.set([flattened ?? "", extra]);
    expect(editor.booleanSelection("union")).not.toBeNull();
  });

  test("non-zero compound paths retain opposite-winding holes and same-winding fills", () => {
    const editor = makeEditor();
    const path = editor.createElement("draw.path", {
      semantic: {
        name: "Non-zero mark",
        fillRule: "nonzero",
        contours: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
            ],
          },
          {
            points: [
              { x: 25, y: 25 },
              { x: 25, y: 75 },
              { x: 75, y: 75 },
              { x: 75, y: 25 },
            ],
          },
        ],
      },
      visual: { style: { fill: "#ef4444" } },
    });
    const geometry = booleanSourceGeometry(
      editor.store.get(path),
      editor.createShapeContext(),
    );
    expect(geometry).toHaveLength(1);
    expect(geometry?.[0]).toHaveLength(2);
    const island = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 120, y: 20, width: 30, height: 30 },
    });
    const group = editor.createElement("group", {
      semantic: { memberIds: [path, island], booleanOperation: "union" },
    });
    const grouped = booleanGeometry(
      editor.store.get(group)!,
      editor.createShapeContext(),
    );
    if (!grouped) throw new Error("missing non-zero Boolean geometry");
    expect(booleanGeometryContains(grouped, { x: 10, y: 10 })).toBe(true);
    expect(booleanGeometryContains(grouped, { x: 50, y: 50 })).toBe(false);
    expect(booleanGeometryContains(grouped, { x: 130, y: 30 })).toBe(true);
    const sameWinding = editor.createElement("draw.path", {
      semantic: {
        name: "Non-zero filled mark",
        fillRule: "nonzero",
        contours: [
          {
            points: [
              { x: 150, y: 0 },
              { x: 250, y: 0 },
              { x: 250, y: 100 },
              { x: 150, y: 100 },
            ],
          },
          {
            points: [
              { x: 175, y: 25 },
              { x: 225, y: 25 },
              { x: 225, y: 75 },
              { x: 175, y: 75 },
            ],
          },
        ],
      },
      visual: { style: { fill: "#ef4444" } },
    });
    const filled = booleanSourceGeometry(
      editor.store.get(sameWinding),
      editor.createShapeContext(),
    );
    expect(filled).toHaveLength(1);
    expect(filled?.[0]).toHaveLength(1);

    const overlapping = editor.createElement("draw.path", {
      semantic: {
        name: "Ambiguous non-zero mark",
        fillRule: "nonzero",
        contours: [
          {
            points: [
              { x: 300, y: 0 },
              { x: 400, y: 0 },
              { x: 400, y: 100 },
              { x: 300, y: 100 },
            ],
          },
          {
            points: [
              { x: 350, y: 50 },
              { x: 450, y: 50 },
              { x: 450, y: 150 },
              { x: 350, y: 150 },
            ],
          },
        ],
      },
    });
    const merged = booleanSourceGeometry(
      editor.store.get(overlapping),
      editor.createShapeContext(),
    );
    expect(merged).toHaveLength(1);
    expect(merged?.[0]).toHaveLength(1);

    const crossingSemantic = editor.store.get(overlapping)?.semantic as {
      readonly contours: readonly {
        readonly points: readonly { readonly x: number; readonly y: number }[];
      }[];
    };
    const oppositeCrossing = editor.createElement("draw.path", {
      semantic: {
        ...crossingSemantic,
        fillRule: "nonzero",
        contours: [
          crossingSemantic.contours[0],
          {
            points: [...(crossingSemantic.contours[1]?.points ?? [])].reverse(),
          },
        ],
      },
    });
    const canceled = booleanSourceGeometry(
      editor.store.get(oppositeCrossing),
      editor.createShapeContext(),
    );
    expect(canceled).toHaveLength(2);
    expect(canceled?.every((polygon) => polygon)).toBe(true);
  });

  test("SVG export and CSS use the same non-destructive mask", () => {
    const { editor, group } = fixture("exclude");
    const geometry = booleanGeometry(
      editor.store.get(group)!,
      editor.createShapeContext(),
    );
    if (!geometry) throw new Error("missing Boolean geometry");
    expect(booleanMaskCss(geometry)).toStartWith('url("data:image/svg+xml,');
    expect(inspectDesign(editor, group)?.css).toContain("mask-image: url(");
    const svg = editor.exportPageSvg({ padding: 0 });
    expect(svg).toContain("data-boolean-operation");
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('mask="url(#diagra-boolean-0)"');
    expect(svg).toContain('viewBox="0 0 150 100"');
  });

  test("operation edits clear masks, round-trip, and undo atomically", () => {
    const { editor, first, group } = fixture("union");
    editor.apply([
      {
        type: "updateSemantic",
        id: group,
        semantic: { memberIds: [first], maskId: first },
      },
    ]);
    expect(setGroupBooleanOperation(editor, group, "subtract")).toBe(false);
    const second = editor.createElement("shape.geo", {
      semantic: { geo: "rect" },
      visual: { x: 20, y: 20, width: 20, height: 20 },
    });
    editor.apply([
      {
        type: "updateSemantic",
        id: group,
        semantic: { memberIds: [first, second], maskId: first },
      },
    ]);
    expect(setGroupBooleanOperation(editor, group, "subtract")).toBe(true);
    expect(editor.store.get(group)?.semantic).toEqual({
      memberIds: [first, second],
      booleanOperation: "subtract",
    });
    const saved = editor.getSnapshot();
    expect(parseDocument(serializeDocument(saved))).toEqual(saved);
    editor.undo();
    expect(editor.store.get(group)?.semantic as GroupSemantic).toEqual({
      memberIds: [first, second],
      maskId: first,
    });
  });

  test("deleting a member detaches an operation that no longer has two inputs", () => {
    const { editor, first, second, group } = fixture("intersect");
    editor.apply([{ type: "deleteElements", ids: [second] }]);
    expect(editor.store.get(group)?.semantic).toEqual({ memberIds: [first] });
    editor.undo();
    expect(editor.store.get(group)?.semantic).toEqual({
      memberIds: [first, second],
      booleanOperation: "intersect",
    });
  });

  test("prototype hotspots and implementation handoff retain the operation", () => {
    const { editor, group } = fixture("subtract");
    const source = editor.createElement("frame", {
      semantic: { name: "Source", memberIds: [group], prototypeStart: true },
      visual: { x: -20, y: -20, width: 200, height: 140 },
    });
    const target = editor.createElement("frame", {
      semantic: { name: "Target", memberIds: [] },
      visual: { x: 300, y: 0, width: 200, height: 140 },
    });
    editor.createElement("edge.generic", {
      semantic: { from: group, to: target, prototype: true },
    });
    expect(prototypeScreen(editor, source)?.links[0]?.hitMask).toStartWith(
      'url("data:image/svg+xml,',
    );
    expect(generateInterfaceCode(editor, source)?.css).toContain(
      "mask-image: url(",
    );
    const native = generateMobileInterfaceCode(editor, source);
    expect(native?.swiftUi).toContain("DiagraBooleanMask");
    expect(native?.swiftUi).toContain("FillStyle(eoFill: true)");
    expect(native?.jetpackCompose).toContain("PathFillType.EvenOdd");
    expect(native?.jetpackCompose).toContain(".clip(GenericShape");
    expect(native?.notes).toContain(
      "Boolean groups resolve nested compound silhouettes to even-odd SwiftUI Canvas and Jetpack Compose clip paths; verify clipping on the target OS and GPU.",
    );
  });
});
