import type { Element, FreehandSemantic } from "@diagra/ir";
import { distanceToSegment } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";
import {
  pressureStrokeContains,
  pressureStrokeOutline,
} from "../pressure-stroke.ts";
import { flattenStroke, strokePath } from "../stroke-path.ts";
import { strokeBounds } from "../stroke-bounds.ts";

export function freehandGeometry(element: Element) {
  const points = (element.semantic as FreehandSemantic).points;
  if (!points.length) return null;
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
  const box = {
    x: element.visual.x ?? minX,
    y: element.visual.y ?? minY,
    width: element.visual.width ?? width,
    height: element.visual.height ?? height,
  };
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
  const pressureOutline =
    element.visual.style?.dash === undefined ||
    element.visual.style.dash === "solid"
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
export const freehandShapeUtil: ShapeUtil = {
  type: "draw.freehand",
  canResize: true,
  getBounds: (element) => freehandGeometry(element)?.box ?? null,
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
