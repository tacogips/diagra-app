import type { Element, FreehandPoint, FreehandSemantic } from "@diagra/ir";
import { boxCenter, rotatePoint, type Vec } from "./geometry.ts";
import { freehandGeometry } from "./shapes/freehand.ts";
import {
  planStrokePoints,
  strokePagePoints,
  planFitStrokeBounds,
  planStrokeClosed,
} from "./stroke-edit.ts";

function mapPoint(
  point: FreehandPoint,
  transform: (point: Vec) => Vec,
): FreehandPoint {
  return {
    ...point,
    ...transform(point),
    ...(point.controlIn ? { controlIn: transform(point.controlIn) } : {}),
    ...(point.controlOut ? { controlOut: transform(point.controlOut) } : {}),
  };
}

export function strokeWorldPoints(element: Element): FreehandPoint[] {
  const box = freehandGeometry(element)?.box;
  const points = strokePagePoints(element);
  return box && element.visual.rotation
    ? points.map((point) =>
        mapPoint(point, (at) =>
          rotatePoint(at, boxCenter(box), element.visual.rotation ?? 0),
        ),
      )
    : points;
}

/** Preserve the original rotation while rebasing edited world-space controls. */
export function planStrokeWorldPoints(
  element: Element,
  points: readonly FreehandPoint[],
) {
  return planWorldChange(element, points, element);
}

export function planFitStrokeWorldBounds(element: Element) {
  if (!element.visual.rotation) return planFitStrokeBounds(element);
  if (
    element.type !== "draw.freehand" ||
    element.visual.strokeBounds === "curve"
  )
    return [];
  return planWorldChange(element, strokeWorldPoints(element), {
    ...element,
    visual: { ...element.visual, strokeBounds: "curve" },
  });
}

export function planStrokeWorldClosed(element: Element, closed: boolean) {
  if (!element.visual.rotation) return planStrokeClosed(element, closed);
  if (
    element.type !== "draw.freehand" ||
    Boolean((element.semantic as FreehandSemantic).closed) === closed
  )
    return [];
  return planWorldChange(element, strokeWorldPoints(element), {
    ...element,
    semantic: { ...(element.semantic as FreehandSemantic), closed },
  });
}

function planWorldChange(
  element: Element,
  points: readonly FreehandPoint[],
  target: Element,
) {
  const rotation = element.visual.rotation ?? 0;
  if (!rotation) return planStrokePoints(target, points);
  const box = freehandGeometry(element)?.box;
  if (!box) return [];
  const center = boxCenter(box);
  const local = points.map((point) =>
    mapPoint(point, (at) => rotatePoint(at, center, -rotation)),
  );
  const commands = planStrokePoints(
    { ...target, visual: { ...target.visual, rotation: 0 } },
    local,
  );
  return commands.map((command) => {
    if (command.type !== "replaceVisual") return command;
    const visual = command.visual;
    const next = {
      x: visual.x ?? 0,
      y: visual.y ?? 0,
      width: visual.width ?? 1,
      height: visual.height ?? 1,
    };
    const nextCenter = boxCenter(next);
    const worldCenter = rotatePoint(nextCenter, center, rotation);
    return {
      ...command,
      visual: {
        ...visual,
        rotation,
        x: next.x + worldCenter.x - nextCenter.x,
        y: next.y + worldCenter.y - nextCenter.y,
      },
    };
  });
}
