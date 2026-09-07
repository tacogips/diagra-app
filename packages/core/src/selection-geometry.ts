import { type Element, getElementTypeDefinition } from "@diagra/ir";
import { type Box, boxCenter, rotatePoint, type Vec } from "./geometry.ts";
import { boxPolygon, intersectClip, polygonContains } from "./clipping.ts";
import type { ShapeContext } from "./shape-util.ts";
import { elementOutlinePolygon } from "./shapes/outline.ts";

function cross(a: Vec, b: Vec, c: Vec): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsOverlap(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const onSegment = (start: Vec, end: Vec, point: Vec): boolean =>
    point.x >= Math.min(start.x, end.x) - 1e-9 &&
    point.x <= Math.max(start.x, end.x) + 1e-9 &&
    point.y >= Math.min(start.y, end.y) - 1e-9 &&
    point.y <= Math.max(start.y, end.y) + 1e-9;
  if (Math.abs(abC) <= 1e-9 && onSegment(a, b, c)) return true;
  if (Math.abs(abD) <= 1e-9 && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) <= 1e-9 && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) <= 1e-9 && onSegment(c, d, b)) return true;
  return abC * abD < 0 && cdA * cdB < 0;
}

function polygonsOverlap(a: readonly Vec[], b: readonly Vec[]): boolean {
  if (a.some((point) => polygonContains(b, point))) return true;
  if (b.some((point) => polygonContains(a, point))) return true;
  for (let aIndex = 0; aIndex < a.length; aIndex += 1) {
    const aStart = a[aIndex];
    const aEnd = a[(aIndex + 1) % a.length];
    if (!aStart || !aEnd) continue;
    for (let bIndex = 0; bIndex < b.length; bIndex += 1) {
      const bStart = b[bIndex];
      const bEnd = b[(bIndex + 1) % b.length];
      if (bStart && bEnd && segmentsOverlap(aStart, aEnd, bStart, bEnd))
        return true;
    }
  }
  return false;
}

/** Marquee overlap against a visible outline, with oriented-box fallback. */
export function overlapsVisibleElement(
  element: Element,
  rect: Box,
  context: ShapeContext,
): boolean {
  const box = context.boundsOf(element.id);
  if (!box) return false;
  const clip = context.clipOf?.(element.id);
  if (
    clip &&
    (clip.width <= 0 ||
      clip.height <= 0 ||
      rect.x > clip.x + clip.width ||
      clip.x > rect.x + rect.width ||
      rect.y > clip.y + clip.height ||
      clip.y > rect.y + rect.height)
  )
    return false;
  const query = clip ? intersectClip(rect, clip) : rect;
  const rotation =
    element.type === "group" ||
    getElementTypeDefinition(element.type)?.category === "edge"
      ? 0
      : (element.visual.rotation ?? 0);
  const outline = elementOutlinePolygon(element, context);
  if (outline) {
    const center = boxCenter(box);
    const pageOutline = rotation
      ? outline.map((point) => rotatePoint(point, center, rotation))
      : outline;
    return polygonsOverlap(pageOutline, boxPolygon(query));
  }
  const angle = ((rotation % 360) * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const a = boxCenter(box);
  const b = boxCenter(query);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Separating-axis test: the query's two axes and the layer's two axes.
  for (const [x, y] of [
    [1, 0],
    [0, 1],
    [cosine, sine],
    [-sine, cosine],
  ] as const) {
    const layerRadius =
      (Math.abs(x * cosine + y * sine) * box.width) / 2 +
      (Math.abs(-x * sine + y * cosine) * box.height) / 2;
    const queryRadius =
      (Math.abs(x) * query.width) / 2 + (Math.abs(y) * query.height) / 2;
    if (Math.abs(dx * x + dy * y) > layerRadius + queryRadius + 1e-9)
      return false;
  }
  return true;
}
