import type {
  Element,
  ElementId,
  FrameSemantic,
  GeoShapeSemantic,
  GroupSemantic,
} from "@diagra/ir";
import { getElementTypeDefinition } from "@diagra/ir";
import { frameParents } from "./frame-tree.ts";
import {
  type Box,
  boxContains,
  boxCenter,
  rotatePoint,
  type Vec,
} from "./geometry.ts";
import { memberIdsOf } from "./group.ts";
import { groupOf } from "./group.ts";
import { resolvedCornerRadii, roundedRectPolygon } from "./corner-radii.ts";
import type { ShapeContext } from "./shape-util.ts";
import type { Store } from "./store.ts";

const EPSILON = 1e-9;

export function intersectClip(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

export function boxPolygon(box: Box): readonly Vec[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

export function polygonBounds(points: readonly Vec[]): Box | null {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(0, Math.max(...xs) - x),
    height: Math.max(0, Math.max(...ys) - y),
  };
}

function signedArea(points: readonly Vec[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length] as Vec;
    return area + point.x * next.y - next.x * point.y;
  }, 0);
}

function cross(a: Vec, b: Vec, point: Vec): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function lineIntersection(start: Vec, end: Vec, a: Vec, b: Vec): Vec {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const edgeX = b.x - a.x;
  const edgeY = b.y - a.y;
  const denominator = dx * edgeY - dy * edgeX;
  if (Math.abs(denominator) <= EPSILON) return end;
  const t = ((a.x - start.x) * edgeY - (a.y - start.y) * edgeX) / denominator;
  return { x: start.x + dx * t, y: start.y + dy * t };
}

/** Convex polygon intersection via Sutherland-Hodgman clipping. */
export function intersectClipPolygons(
  subject: readonly Vec[],
  clip: readonly Vec[],
): readonly Vec[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const orientation = signedArea(clip) >= 0 ? 1 : -1;
  let output = [...subject];
  for (let index = 0; index < clip.length; index += 1) {
    const a = clip[index] as Vec;
    const b = clip[(index + 1) % clip.length] as Vec;
    const input = output;
    output = [];
    if (!input.length) break;
    let start = input[input.length - 1] as Vec;
    for (const end of input) {
      const endInside = orientation * cross(a, b, end) >= -EPSILON;
      const startInside = orientation * cross(a, b, start) >= -EPSILON;
      if (endInside) {
        if (!startInside) output.push(lineIntersection(start, end, a, b));
        output.push(end);
      } else if (startInside) output.push(lineIntersection(start, end, a, b));
      start = end;
    }
  }
  return output;
}

export function polygonContains(points: readonly Vec[], point: Vec): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index] as Vec;
    const b = points[(index + 1) % points.length] as Vec;
    const area = cross(a, b, point);
    const dot =
      (point.x - a.x) * (point.x - b.x) + (point.y - a.y) * (point.y - b.y);
    if (Math.abs(area) <= EPSILON && dot <= EPSILON) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function geoPolygon(kind: string, box: Box): readonly Vec[] | null {
  const { x, y, width, height } = box;
  switch (kind) {
    case "ellipse":
      return Array.from({ length: 32 }, (_, index) => {
        const angle = (index / 32) * Math.PI * 2;
        return {
          x: x + width / 2 + Math.cos(angle) * (width / 2),
          y: y + height / 2 + Math.sin(angle) * (height / 2),
        };
      });
    case "diamond":
      return [
        { x: x + width / 2, y },
        { x: x + width, y: y + height / 2 },
        { x: x + width / 2, y: y + height },
        { x, y: y + height / 2 },
      ];
    case "triangle":
      return [
        { x: x + width / 2, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
    case "hexagon":
      return [
        { x: x + width * 0.25, y },
        { x: x + width * 0.75, y },
        { x: x + width, y: y + height / 2 },
        { x: x + width * 0.75, y: y + height },
        { x: x + width * 0.25, y: y + height },
        { x, y: y + height / 2 },
      ];
    case "parallelogram":
      return [
        { x: x + width * 0.2, y },
        { x: x + width, y },
        { x: x + width * 0.8, y: y + height },
        { x, y: y + height },
      ];
    case "rect":
      return boxPolygon(box);
    default:
      return null;
  }
}

/** Convex geometry accepted as a deterministic cross-platform mask. */
export function maskPolygon(
  element: Element | undefined,
  context: ShapeContext,
): readonly Vec[] | null {
  const category = element
    ? getElementTypeDefinition(element.type)?.category
    : undefined;
  if (
    !element ||
    element.type === "group" ||
    category === "edge" ||
    category === "resource"
  )
    return null;
  const box = context.boundsOf(element.id);
  if (!box) return null;
  let points =
    element.type === "shape.geo"
      ? (element.semantic as GeoShapeSemantic).geo === "rect" &&
        (element.visual.style?.cornerRadii ||
          element.visual.style?.cornerRadius)
        ? roundedRectPolygon(box, resolvedCornerRadii(element.visual.style))
        : geoPolygon((element.semantic as GeoShapeSemantic).geo, box)
      : element.visual.style?.cornerRadii || element.visual.style?.cornerRadius
        ? roundedRectPolygon(box, resolvedCornerRadii(element.visual.style))
        : boxPolygon(box);
  if (!points) return null;
  const rotation = element.visual.rotation ?? 0;
  if (rotation)
    points = points.map((point) =>
      rotatePoint(point, boxCenter(box), rotation),
    );
  return points;
}

/** A raster source can mask paint even though it has no portable clip polygon. */
export function isRasterMaskSource(element: Element | undefined): boolean {
  return (
    element?.type === "image.raster" &&
    typeof (element.semantic as { src?: unknown }).src === "string" &&
    (element.semantic as { src: string }).src.trim().length > 0
  );
}

export function canProvideMask(
  element: Element | undefined,
  context: ShapeContext,
): boolean {
  return isRasterMaskSource(element) || maskPolygon(element, context) !== null;
}

function inverseRotatePoint(point: Vec, box: Box, rotation: number): Vec {
  const angle = ((rotation % 360) * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return { x: cx + dx * cosine + dy * sine, y: cy - dx * sine + dy * cosine };
}

/**
 * Tests one raster mask in page space. If the platform has not decoded the
 * source (or its pixels cannot be read), retain the existing source-box
 * fallback instead of making an asset temporarily unselectable.
 */
export function rasterMaskContains(
  element: Element,
  mode: "alpha" | "luminance",
  point: Vec,
  context: ShapeContext,
): boolean {
  const box = context.boundsOf(element.id);
  if (!box || box.width <= 0 || box.height <= 0) return false;
  const local = element.visual.rotation
    ? inverseRotatePoint(point, box, element.visual.rotation)
    : point;
  if (!boxContains(box, local)) return false;
  const crop = (
    element.semantic as {
      crop?: { x: number; y: number; width: number; height: number };
    }
  ).crop;
  const viewportX = (local.x - box.x) / box.width;
  const viewportY = (local.y - box.y) / box.height;
  const sourcePoint = crop
    ? {
        x: crop.x + viewportX * crop.width,
        y: crop.y + viewportY * crop.height,
      }
    : { x: viewportX, y: viewportY };
  const pixel = context.rasterMaskSample?.(element.id, sourcePoint);
  if (!pixel) return true;
  const alpha = Math.max(0, Math.min(1, pixel.alpha));
  if (mode === "alpha") return alpha > 0;
  return alpha * Math.max(0, Math.min(1, pixel.luminance)) > 0;
}

/** Applies decoded raster masks on every ancestor group during picking. */
export function insideRasterMasks(
  store: Store,
  element: Element,
  point: Vec,
  context: ShapeContext,
): boolean {
  const visited = new Set<ElementId>([element.id]);
  let child = element;
  while (true) {
    const parent = groupOf(store, child.id);
    if (!parent || visited.has(parent.id)) return true;
    visited.add(parent.id);
    const semantic = parent.semantic as GroupSemantic;
    const mask = semantic.maskId ? store.get(semantic.maskId) : undefined;
    if (
      semantic.maskId &&
      semantic.maskId !== child.id &&
      mask &&
      isRasterMaskSource(mask) &&
      !rasterMaskContains(mask, semantic.maskMode ?? "alpha", point, context)
    )
      return false;
    child = parent;
  }
}

export function maskSources(
  source: Store | readonly Element[],
  context?: ShapeContext,
): ReadonlySet<ElementId> {
  const out = new Set<ElementId>();
  const elements = Array.isArray(source)
    ? source
    : (source as Store).getSnapshot().elements;
  for (const element of elements) {
    if (element.type !== "group") continue;
    const semantic = element.semantic as GroupSemantic;
    if (
      semantic.maskId &&
      memberIdsOf(element).includes(semantic.maskId) &&
      (!context || canProvideMask(context.resolve(semantic.maskId), context))
    )
      out.add(semantic.maskId);
  }
  return out;
}

function parentGraph(store: Store, context: ShapeContext) {
  const parents = new Map<ElementId, Set<ElementId>>();
  const add = (child: ElementId, parent: ElementId): void => {
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child)?.add(parent);
  };
  for (const page of store.listPages()) {
    for (const [child, parent] of frameParents(store, page.id, context))
      add(child, parent);
    for (const element of store.getPageElements(page.id))
      for (const child of memberIdsOf(element))
        if (store.get(child)?.page === page.id) add(child, element.id);
  }
  return parents;
}

/** Exact convex ancestor clip polygon; null means no clipping. */
export function layerClipPolygons(
  store: Store,
  context: ShapeContext,
  ignoredFrames: ReadonlySet<ElementId> = new Set(),
) {
  const parents = parentGraph(store, context);
  const cache = new Map<ElementId, readonly Vec[] | null>();
  return (id: ElementId): readonly Vec[] | null => {
    if (cache.has(id)) return cache.get(id) ?? null;
    const seen = new Set([id]);
    const pending = [...(parents.get(id) ?? [])].map((parent) => ({
      parent,
      child: id,
    }));
    let clip: readonly Vec[] | null = null;
    while (pending.length) {
      const edge = pending.pop();
      if (!edge || seen.has(edge.parent)) continue;
      seen.add(edge.parent);
      const element = store.get(edge.parent);
      let next: readonly Vec[] | null = null;
      if (
        element?.type === "frame" &&
        (element.semantic as FrameSemantic).clipContent &&
        !ignoredFrames.has(element.id)
      ) {
        const box = context.boundsOf(edge.parent);
        if (box) {
          next =
            element.visual.style?.cornerRadii ||
            element.visual.style?.cornerRadius
              ? roundedRectPolygon(
                  box,
                  resolvedCornerRadii(element.visual.style),
                )
              : boxPolygon(box);
          if (element.visual.rotation) {
            const center = boxCenter(box);
            next = next.map((point) =>
              rotatePoint(point, center, element.visual.rotation ?? 0),
            );
          }
        }
      } else if (element?.type === "group") {
        const maskId = (element.semantic as GroupSemantic).maskId;
        if (maskId && maskId !== edge.child)
          next = maskPolygon(store.get(maskId), context);
      }
      if (next) clip = clip ? intersectClipPolygons(clip, next) : next;
      for (const parent of parents.get(edge.parent) ?? [])
        pending.push({ parent, child: edge.parent });
    }
    cache.set(id, clip);
    return clip;
  };
}

/** Bounding projection retained for layout/export-envelope calculations. */
export function frameClips(store: Store, context: ShapeContext) {
  const polygons = layerClipPolygons(store, context);
  return (id: ElementId): Box | null => {
    const polygon = polygons(id);
    return polygon
      ? (polygonBounds(polygon) ?? { x: 0, y: 0, width: 0, height: 0 })
      : null;
  };
}

export function insideClip(
  context: ShapeContext,
  id: ElementId,
  point: Vec,
): boolean {
  const polygon = context.clipPolygonOf?.(id);
  if (polygon) return polygonContains(polygon, point);
  const clip = context.clipOf?.(id);
  return (
    !clip || (clip.width > 0 && clip.height > 0 && boxContains(clip, point))
  );
}

export function visibleBounds(
  context: ShapeContext,
  id: ElementId,
): Box | null {
  const box = context.boundsOf(id);
  const clip = context.clipOf?.(id);
  if (!box || !clip) return box;
  const visible = intersectClip(box, clip);
  return visible.width > 0 && visible.height > 0 ? visible : null;
}

/** Page-space CSS polygon for a wrapper whose origin is the page origin. */
export function clipCss(
  clip: Box | readonly Vec[] | null | undefined,
): string | undefined {
  if (!clip) return undefined;
  let points = Array.isArray(clip) ? clip : boxPolygon(clip as Box);
  if (points.length < 3) return "polygon(0 0, 0 0, 0 0)";
  const first = points.reduce((best, point, index) => {
    const bestPoint = points[best] as Vec;
    return point.y < bestPoint.y - EPSILON ||
      (Math.abs(point.y - bestPoint.y) <= EPSILON && point.x < bestPoint.x)
      ? index
      : best;
  }, 0);
  points = [...points.slice(first), ...points.slice(0, first)];
  return `polygon(${points.map((point) => `${point.x}px ${point.y}px`).join(", ")})`;
}
