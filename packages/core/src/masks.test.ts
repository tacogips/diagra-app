import { describe, expect, test } from "bun:test";
import type { GroupSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  boxPolygon,
  clipCss,
  intersectClipPolygons,
  polygonBounds,
  polygonContains,
} from "./clipping.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { inspectDesign } from "./handoff.ts";
import {
  groupMaskCandidates,
  rasterGroupMaskCss,
  setGroupMask,
  setGroupRasterMaskMode,
} from "./masks.ts";
import { prototypeScreen } from "./prototype.ts";
import { document, makeEditor } from "./test-helpers.ts";

function fixture(maskKind = "ellipse") {
  let next = 0;
  const editor = makeEditor({
    document: document([]),
    idSource: () => `mask-${++next}`,
  });
  const mask = editor.createElement("shape.geo", {
    semantic: { geo: maskKind },
    visual: { x: 20, y: 20, width: 100, height: 100 },
  });
  const content = editor.createElement("shape.geo", {
    semantic: { geo: "rect", label: "Photo" },
    visual: {
      x: 0,
      y: 0,
      width: 160,
      height: 160,
      style: { fill: "#2563eb" },
    },
  });
  const group = editor.createElement("group", {
    semantic: { memberIds: [mask, content], maskId: mask },
  });
  return { editor, mask, content, group };
}

describe("layer masks", () => {
  test("ellipse masks clip picking to exact convex geometry", () => {
    const { editor, mask, content } = fixture();
    const context = editor.createShapeContext();
    expect(context.isMaskSource?.(mask)).toBe(true);
    expect(context.clipPolygonOf?.(content)).toHaveLength(32);
    expect(editor.hitTest({ x: 70, y: 70 })).toBe(content);
    expect(editor.hitTest({ x: 22, y: 22 })).toBeNull();
    expect(editor.hitTest({ x: 70, y: 20 })).toBe(content);
  });

  test("SVG and web handoff omit mask paint and retain polygon clipping", () => {
    const { editor, mask, content, group } = fixture("diamond");
    const frame = editor.createElement("frame", {
      semantic: { name: "Screen", memberIds: [group] },
      visual: { x: 0, y: 0, width: 200, height: 200 },
    });
    const svg = editor.exportPageSvg({ padding: 0 });
    expect(svg).not.toContain(`data-id="${mask}"`);
    expect(svg).toContain("<clipPath");
    expect(svg).toContain("<polygon");
    expect(svg).toContain(`data-id="${content}"`);
    const code = generateInterfaceCode(editor, frame);
    expect(code?.html).not.toContain(`data-diagra-id="${mask}"`);
    expect(code?.css).toContain("clip-path: polygon(");

    const target = editor.createElement("frame", {
      semantic: { name: "Target", memberIds: [] },
      visual: { x: 300, y: 0, width: 200, height: 200 },
    });
    editor.createElement("edge.generic", {
      semantic: { from: content, to: target, prototype: true },
    });
    const screen = prototypeScreen(editor, frame);
    expect(screen?.elements.some((element) => element.id === mask)).toBe(false);
    expect(screen?.elements.some((element) => element.id === content)).toBe(
      true,
    );
    expect(screen?.links[0]?.clipPolygon).toHaveLength(4);
  });

  test("rotated masks compose with rectangular frame clipping", () => {
    const { editor, mask, content, group } = fixture("rect");
    editor.apply([
      { type: "updateVisual", id: mask, visual: { rotation: 45 } },
    ]);
    editor.createElement("frame", {
      semantic: {
        name: "Crop",
        clipContent: true,
        memberIds: [group],
      },
      visual: { x: 40, y: 40, width: 60, height: 60 },
    });
    const polygon = editor.createShapeContext().clipPolygonOf?.(content) ?? [];
    expect(polygon.length).toBeGreaterThanOrEqual(4);
    const bounds = polygonBounds(polygon);
    expect(bounds?.x).toBeCloseTo(40);
    expect(bounds?.y).toBeCloseTo(40);
    expect(bounds?.width).toBeCloseTo(60);
    expect(bounds?.height).toBeCloseTo(60);
    expect(polygonContains(polygon, { x: 50, y: 50 })).toBe(true);
    expect(polygonContains(polygon, { x: 30, y: 50 })).toBe(false);
  });

  test("mask assignment validates geometry, persists and undoes", () => {
    const { editor, mask, group } = fixture();
    expect(setGroupMask(editor, group, null)).toBe(true);
    expect(groupMaskCandidates(editor, group).map((item) => item.id)).toContain(
      mask,
    );
    expect(setGroupMask(editor, group, mask)).toBe(true);
    const saved = editor.getSnapshot();
    expect(parseDocument(serializeDocument(saved))).toEqual(saved);
    expect(setGroupMask(editor, group, "missing")).toBe(false);
    editor.undo();
    expect(
      (editor.store.get(group)?.semantic as GroupSemantic).maskId,
    ).toBeUndefined();
  });

  test("deleting a mask detaches the role while preserving other members", () => {
    const { editor, mask, content, group } = fixture();
    editor.deleteElements([mask]);
    expect(editor.store.get(group)?.semantic).toEqual({ memberIds: [content] });
    expect(editor.hitTest({ x: 5, y: 5 })).toBe(content);
  });

  test("raster sources become mask candidates and retain alpha/luminance mode", () => {
    const { editor, content, group } = fixture();
    const image = editor.createElement("image.raster", {
      semantic: {
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        alt: "Mask",
      },
      visual: { x: 10, y: 10, width: 80, height: 80 },
    });
    editor.apply([
      {
        type: "updateSemantic",
        id: group,
        semantic: {
          memberIds: [image, content],
        },
      },
    ]);
    expect(groupMaskCandidates(editor, group).map((item) => item.id)).toContain(
      image,
    );
    expect(setGroupMask(editor, group, image)).toBe(true);
    expect((editor.store.get(group)?.semantic as GroupSemantic).maskMode).toBe(
      "alpha",
    );
    expect(setGroupRasterMaskMode(editor, group, "luminance")).toBe(true);
    expect((editor.store.get(group)?.semantic as GroupSemantic).maskMode).toBe(
      "luminance",
    );
    const css = rasterGroupMaskCss(editor, group);
    expect(css).toContain("data:image/svg+xml,");
    expect(decodeURIComponent(css ?? "")).toContain('href="data:image/png');
    expect(decodeURIComponent(css ?? "")).toContain("viewBox=");
    const svg = editor.exportPageSvg({ padding: 0 });
    expect(svg).toContain('mask-type="luminance"');
    expect(svg).toContain('mask="url(#diagra-raster-mask-0)"');
    const handoff = inspectDesign(editor, group);
    expect(handoff?.css).toContain("mask-image: url(");
    expect(handoff?.css).toContain("mask-mode: luminance;");
    expect(setGroupMask(editor, group, null)).toBe(true);
    expect(editor.store.get(group)?.semantic).toEqual({
      memberIds: [image, content],
    });
    expect(setGroupMask(editor, group, image)).toBe(true);
    editor.deleteElements([image]);
    expect(editor.store.get(group)?.semantic).toEqual({
      memberIds: [content],
    });
  });

  test("decoded raster pixels constrain alpha and luminance picking", () => {
    const { editor, mask, content, group } = fixture();
    editor.deleteElements([mask]);
    const image = editor.createElement("image.raster", {
      semantic: {
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        alt: "Decoded mask",
      },
      visual: { x: 20, y: 20, width: 100, height: 100 },
    });
    editor.apply([
      {
        type: "updateSemantic",
        id: group,
        semantic: {
          memberIds: [image, content],
          maskId: image,
          maskMode: "alpha",
        },
      },
    ]);
    const alphaContext = {
      ...editor.createShapeContext(),
      rasterMaskSample: (_id: string, point: { x: number; y: number }) => ({
        alpha: point.x >= 0.5 ? 1 : 0,
        luminance: 1,
      }),
    };
    expect(editor.hitTest({ x: 40, y: 70 }, alphaContext)).toBeNull();
    expect(editor.hitTest({ x: 90, y: 70 }, alphaContext)).toBe(content);
    editor.apply([
      {
        type: "updateSemantic",
        id: group,
        semantic: {
          memberIds: [image, content],
          maskId: image,
          maskMode: "luminance",
        },
      },
    ]);
    const luminanceContext = {
      ...editor.createShapeContext(),
      rasterMaskSample: () => ({ alpha: 1, luminance: 0 }),
    };
    expect(editor.hitTest({ x: 90, y: 70 }, luminanceContext)).toBeNull();
  });

  test("decoded raster sampling maps crop coordinates through rotation", () => {
    const { editor, mask, content, group } = fixture();
    editor.deleteElements([mask]);
    const image = editor.createElement("image.raster", {
      semantic: {
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        alt: "Cropped mask",
        crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.5 },
      },
      visual: { x: 20, y: 20, width: 100, height: 100, rotation: 90 },
    });
    editor.apply([
      {
        type: "updateSemantic",
        id: group,
        semantic: { memberIds: [image, content], maskId: image },
      },
    ]);
    let sampled: { x: number; y: number } | undefined;
    const context = {
      ...editor.createShapeContext(),
      rasterMaskSample: (_id: string, point: { x: number; y: number }) => {
        sampled = point;
        return { alpha: 1, luminance: 1 };
      },
    };
    expect(editor.hitTest({ x: 70, y: 100 }, context)).toBe(content);
    expect(sampled?.x).toBeCloseTo(0.65);
    expect(sampled?.y).toBeCloseTo(0.35);
  });

  test("concave and decorative geometry is rejected until exact clipping exists", () => {
    const { editor, group } = fixture();
    const star = editor.createElement("shape.geo", {
      semantic: { geo: "star" },
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    editor.apply([
      {
        type: "updateSemantic",
        id: group,
        semantic: {
          ...(editor.store.get(group)?.semantic as GroupSemantic),
          memberIds: [
            ...(editor.store.get(group)?.semantic as GroupSemantic).memberIds,
            star,
          ],
        },
      },
    ]);
    expect(setGroupMask(editor, group, star)).toBe(false);
  });
});

test("convex intersection and CSS serialization are deterministic", () => {
  const intersection = intersectClipPolygons(
    boxPolygon({ x: 0, y: 0, width: 100, height: 100 }),
    boxPolygon({ x: 50, y: 25, width: 100, height: 50 }),
  );
  expect(polygonBounds(intersection)).toEqual({
    x: 50,
    y: 25,
    width: 50,
    height: 50,
  });
  expect(clipCss(intersection)).toBe(
    "polygon(50px 25px, 100px 25px, 100px 75px, 50px 75px)",
  );
});
