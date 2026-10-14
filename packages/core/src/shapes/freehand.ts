import type { Element, FreehandPoint, FreehandSemantic } from "@nodetto/ir";
import { type Box, distanceToSegment } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";
import {
  pressureStrokeContains,
  pressureStrokeOutline,
} from "../pressure-stroke.ts";
import { flattenStroke, strokePath } from "../stroke-path.ts";
import { resolvedStrokeDashArray } from "../stroke-dash.ts";
import { strokeBounds } from "../stroke-bounds.ts";

// Store records and point arrays are immutable. Keep only the latest derived
// shape per source array so dragging does not retain every intermediate size.
const sourceBoundsCache = new WeakMap<
  readonly FreehandPoint[],
  {
    closed: boolean;
    curve: boolean;
    bounds: Box;
  }
>();

function sourceBounds(element: Element): Box | null {
  const { points, closed = false } = element.semantic as FreehandSemantic;
  if (!points.length) return null;
  const curve = element.visual.strokeBounds === "curve";
  const cached = sourceBoundsCache.get(points);
  if (cached && cached.closed === closed && cached.curve === curve)
    return cached.bounds;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    for (const sample of [point, point.controlIn, point.controlOut]) {
      if (!sample) continue;
      minX = Math.min(minX, sample.x);
      minY = Math.min(minY, sample.y);
      maxX = Math.max(maxX, sample.x);
      maxY = Math.max(maxY, sample.y);
    }
  }
  if (element.visual.strokeBounds === "curve") {
    const tight = strokeBounds(
      points,
      (element.semantic as FreehandSemantic).closed,
    );
    if (tight) {
      minX = tight.x;
      minY = tight.y;
      maxX = tight.x + tight.width;
      maxY = tight.y + tight.height;
    }
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const bounds = { x: minX, y: minY, width, height };
  sourceBoundsCache.set(points, { closed, curve, bounds });
  return bounds;
}

function freehandBox(element: Element): Box | null {
  const bounds = sourceBounds(element);
  return bounds
    ? {
        x: element.visual.x ?? bounds.x,
        y: element.visual.y ?? bounds.y,
        width: element.visual.width ?? bounds.width,
        height: element.visual.height ?? bounds.height,
      }
    : null;
}

function computeFreehandGeometry(element: Element) {
  const points = (element.semantic as FreehandSemantic).points;
  const source = sourceBounds(element);
  const box = freehandBox(element);
  if (!source || !box) return null;
  const { x: minX, y: minY, width, height } = source;
  const map = (point: { x: number; y: number }) => ({
    x: ((point.x - minX) * box.width) / width,
    y: ((point.y - minY) * box.height) / height,
  });
  const mapped = points.map((point) => ({
    ...point,
    ...map(point),
    ...(point.controlIn ? { controlIn: map(point.controlIn) } : {}),
    ...(point.controlOut ? { controlOut: map(point.controlOut) } : {}),
  }));
  const tight = strokeBounds(
    mapped,
    (element.semantic as FreehandSemantic).closed,
  );
  const pressureOutline = !resolvedStrokeDashArray(element.visual.style).length
    ? pressureStrokeOutline(
        mapped,
        (element.semantic as FreehandSemantic).closed === true,
        element.visual.style?.strokeWidth ?? 2,
      )
    : null;
  const curveBounds = pressureOutline
    ? tight
      ? {
          x: Math.min(tight.x, pressureOutline.bounds.x),
          y: Math.min(tight.y, pressureOutline.bounds.y),
          width:
            Math.max(
              tight.x + tight.width,
              pressureOutline.bounds.x + pressureOutline.bounds.width,
            ) - Math.min(tight.x, pressureOutline.bounds.x),
          height:
            Math.max(
              tight.y + tight.height,
              pressureOutline.bounds.y + pressureOutline.bounds.height,
            ) - Math.min(tight.y, pressureOutline.bounds.y),
        }
      : pressureOutline.bounds
    : tight;
  return {
    box,
    curveBounds: curveBounds
      ? {
          ...curveBounds,
          x: curveBounds.x + box.x,
          y: curveBounds.y + box.y,
        }
      : box,
    points: mapped,
    path: strokePath(mapped, (element.semantic as FreehandSemantic).closed),
    pressureOutline,
  };
}
type Geometry = NonNullable<ReturnType<typeof computeFreehandGeometry>>;
const geometryCache = new WeakMap<
  readonly FreehandPoint[],
  {
    closed: boolean;
    curve: boolean;
    strokeWidth: number;
    dashed: boolean;
    geometry: Geometry;
  }
>();

export function freehandGeometry(element: Element): Geometry | null {
  const { points, closed = false } = element.semantic as FreehandSemantic;
  const box = freehandBox(element);
  if (!box) return null;
  const curve = element.visual.strokeBounds === "curve";
  const strokeWidth = element.visual.style?.strokeWidth ?? 2;
  const dashed = resolvedStrokeDashArray(element.visual.style).length > 0;
  const cached = geometryCache.get(points);
  if (
    cached &&
    cached.closed === closed &&
    cached.curve === curve &&
    cached.strokeWidth === strokeWidth &&
    cached.dashed === dashed &&
    cached.geometry.box.width === box.width &&
    cached.geometry.box.height === box.height
  ) {
    const geometry = cached.geometry;
    if (geometry.box.x === box.x && geometry.box.y === box.y) return geometry;
    return {
      ...geometry,
      box,
      curveBounds: {
        ...geometry.curveBounds,
        x: geometry.curveBounds.x + box.x,
        y: geometry.curveBounds.y + box.y,
      },
    };
  }
  // Cache in local coordinates to avoid cancellation/precision loss when
  // translating artwork with large world-space coordinates.
  const geometry = computeFreehandGeometry({
    ...element,
    visual: { ...element.visual, x: 0, y: 0 },
  });
  if (geometry)
    geometryCache.set(points, { closed, curve, strokeWidth, dashed, geometry });
  return geometry
    ? {
        ...geometry,
        box,
        curveBounds: {
          ...geometry.curveBounds,
          x: geometry.curveBounds.x + box.x,
          y: geometry.curveBounds.y + box.y,
        },
      }
    : null;
}

export const freehandShapeUtil: ShapeUtil = {
  type: "draw.freehand",
  canResize: true,
  getBounds: freehandBox,
  hitTest(element, point, context) {
    const geometry = freehandGeometry(element);
    if (!geometry) return false;
    const local = { x: point.x - geometry.box.x, y: point.y - geometry.box.y };
    const tolerance = Math.max(
      4 / context.zoom,
      (element.visual.style?.strokeWidth ?? 2) / 2,
    );
    const closed = (element.semantic as FreehandSemantic).closed === true;
    const samples = flattenStroke(geometry.points, closed, 0.5 / context.zoom);
    if (
      closed &&
      (element.visual.style?.fillGradient ||
        (element.visual.style?.fill &&
          element.visual.style.fill !== "none" &&
          element.visual.style.fill !== "transparent"))
    ) {
      // Nonzero winding agrees with SVG's default fill rule.
      let winding = 0;
      for (let i = 0; i < samples.length; i++) {
        const a = samples[i];
        const b = samples[(i + 1) % samples.length];
        if (!a || !b) continue;
        const cross =
          (b.x - a.x) * (local.y - a.y) - (local.x - a.x) * (b.y - a.y);
        if (a.y <= local.y && b.y > local.y && cross > 0) winding++;
        if (a.y > local.y && b.y <= local.y && cross < 0) winding--;
      }
      if (winding !== 0) return true;
    }
    if (geometry.pressureOutline)
      return pressureStrokeContains(
        local,
        geometry.pressureOutline,
        4 / context.zoom,
      );
    return samples.some(
      (sample, index) =>
        distanceToSegment(local, sample, samples[index + 1] ?? sample) <=
        tolerance,
    );
  },
  resize: (_element, box) => ({ visual: { ...box } }),
  defaultSemantic: () => ({ points: [] }),
  defaultVisual: () => ({ style: { stroke: "#1d2a2e", strokeWidth: 2 } }),
};
