import type { Element, FreehandPoint, FreehandSemantic } from "@diagra/ir";
import type { Command } from "./commands.ts";
import { freehandGeometry } from "./shapes/freehand.ts";

export function strokePagePoints(element: Element): FreehandPoint[] {
  if (element.type !== "draw.freehand") return [];
  const geometry = freehandGeometry(element);
  const source = (element.semantic as FreehandSemantic).points;
  return (
    geometry?.points.map((point, index) => ({
      ...source[index],
      x: point.x + geometry.box.x,
      y: point.y + geometry.box.y,
      ...(point.controlIn
        ? {
            controlIn: {
              x: point.controlIn.x + geometry.box.x,
              y: point.controlIn.y + geometry.box.y,
            },
          }
        : {}),
      ...(point.controlOut
        ? {
            controlOut: {
              x: point.controlOut.x + geometry.box.x,
              y: point.controlOut.y + geometry.box.y,
            },
          }
        : {}),
    })) ?? []
  );
}

export function moveStrokeAnchor(
  point: FreehandPoint,
  to: { x: number; y: number },
): FreehandPoint {
  const shift = (control: { x: number; y: number }) => ({
    x: control.x + to.x - point.x,
    y: control.y + to.y - point.y,
  });
  return {
    ...point,
    ...to,
    ...(point.controlIn ? { controlIn: shift(point.controlIn) } : {}),
    ...(point.controlOut ? { controlOut: shift(point.controlOut) } : {}),
  };
}

/** Rebase the current page-space curve into a tight frame, preserving its shape. */
export function planFitStrokeBounds(element: Element): Command[] {
  if (
    element.type !== "draw.freehand" ||
    element.visual.rotation ||
    element.visual.strokeBounds === "curve"
  )
    return [];
  return planStrokePoints(
    { ...element, visual: { ...element.visual, strokeBounds: "curve" } },
    strokePagePoints(element),
  );
}

/** Closing a tight path can extend its bounds; preserve existing page-space controls. */
export function planStrokeClosed(element: Element, closed: boolean): Command[] {
  if (element.type !== "draw.freehand") return [];
  const semantic = { ...(element.semantic as FreehandSemantic), closed };
  return element.visual.strokeBounds === "curve" && !element.visual.rotation
    ? planStrokePoints({ ...element, semantic }, strokePagePoints(element))
    : [{ type: "updateSemantic", id: element.id, semantic }];
}

/** Rebase edited points without moving the unedited anchors after a resize. */
export function planStrokePoints(
  element: Element,
  points: readonly FreehandPoint[],
): Command[] {
  if (
    element.type !== "draw.freehand" ||
    element.visual.rotation ||
    points.length < 2 ||
    points.length > 20000 ||
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    return [];
  const semantic = { ...(element.semantic as FreehandSemantic), points };
  const {
    x: _x,
    y: _y,
    width: _width,
    height: _height,
    ...rest
  } = element.visual;
  const geometry = freehandGeometry({ ...element, semantic, visual: rest });
  return geometry
    ? [
        { type: "updateSemantic", id: element.id, semantic },
        {
          type: "replaceVisual",
          id: element.id,
          visual: { ...rest, ...geometry.box },
        },
      ]
    : [];
}
