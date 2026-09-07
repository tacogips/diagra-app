import type { Element, FreehandPoint, PathSemantic } from "@diagra/ir";
import { distanceToSegment, type Vec } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";
import { flattenStroke, strokePath } from "../stroke-path.ts";

export interface CompoundPathGeometry {
  readonly box: { x: number; y: number; width: number; height: number };
  readonly contours: readonly (readonly FreehandPoint[])[];
  readonly path: string;
}

function mapPoint(
  point: FreehandPoint,
  map: (point: Vec) => Vec,
): FreehandPoint {
  return {
    ...point,
    ...map(point),
    ...(point.controlIn ? { controlIn: map(point.controlIn) } : {}),
    ...(point.controlOut ? { controlOut: map(point.controlOut) } : {}),
  };
}

export function compoundPathGeometry(
  element: Element,
): CompoundPathGeometry | null {
  if (element.type !== "draw.path") return null;
  const contours = (element.semantic as PathSemantic).contours;
  if (!contours.length || contours.some((contour) => contour.points.length < 3))
    return null;
  const samples = contours.flatMap((contour) =>
    contour.points.flatMap((point) =>
      [point, point.controlIn, point.controlOut].filter(
        (sample): sample is Vec => sample !== undefined,
      ),
    ),
  );
  if (!samples.length) return null;
  const minX = Math.min(...samples.map((point) => point.x));
  const minY = Math.min(...samples.map((point) => point.y));
  const maxX = Math.max(...samples.map((point) => point.x));
  const maxY = Math.max(...samples.map((point) => point.y));
  const sourceWidth = Math.max(1, maxX - minX);
  const sourceHeight = Math.max(1, maxY - minY);
  const box = {
    x: element.visual.x ?? minX,
    y: element.visual.y ?? minY,
    width: element.visual.width ?? sourceWidth,
    height: element.visual.height ?? sourceHeight,
  };
  const map = (point: Vec): Vec => ({
    x: ((point.x - minX) * box.width) / sourceWidth,
    y: ((point.y - minY) * box.height) / sourceHeight,
  });
  const mapped = contours.map((contour) =>
    contour.points.map((point) => mapPoint(point, map)),
  );
  return {
    box,
    contours: mapped,
    path: mapped.map((contour) => strokePath(contour, true)).join(" "),
  };
}

/** CSS mask preserving every compound contour, including holes and curves. */
export function compoundPathMaskCss(element: Element): string | undefined {
  const geometry = compoundPathGeometry(element);
  if (!geometry) return undefined;
  const rule = (element.semantic as PathSemantic).fillRule;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${geometry.box.width} ${geometry.box.height}"><path d="${geometry.path}" fill="white" fill-rule="${rule}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function winding(contour: readonly Vec[], point: Vec): number {
  let value = 0;
  for (let index = 0; index < contour.length; index++) {
    const a = contour[index];
    const b = contour[(index + 1) % contour.length];
    if (!a || !b) continue;
    const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && cross > 0) value++;
    if (a.y > point.y && b.y <= point.y && cross < 0) value--;
  }
  return value;
}

export const compoundPathShapeUtil: ShapeUtil = {
  type: "draw.path",
  canResize: true,
  getBounds: (element) => compoundPathGeometry(element)?.box ?? null,
  hitTest(element, point, context) {
    const geometry = compoundPathGeometry(element);
    if (!geometry) return false;
    const local = { x: point.x - geometry.box.x, y: point.y - geometry.box.y };
    const contours = geometry.contours.map((contour) =>
      flattenStroke(contour, true, 0.5 / context.zoom),
    );
    const rule = (element.semantic as PathSemantic).fillRule;
    const inside =
      rule === "evenodd"
        ? contours.filter((contour) => winding(contour, local) !== 0).length %
            2 ===
          1
        : contours.reduce(
            (total, contour) => total + winding(contour, local),
            0,
          ) !== 0;
    const fill = element.visual.style?.fill;
    if (
      inside &&
      (element.visual.style?.fillGradient ||
        (fill !== undefined && fill !== "none" && fill !== "transparent"))
    )
      return true;
    const tolerance = Math.max(
      4 / context.zoom,
      (element.visual.style?.strokeWidth ?? 1) / 2,
    );
    return contours.some((contour) =>
      contour.some(
        (sample, index) =>
          distanceToSegment(
            local,
            sample,
            contour[(index + 1) % contour.length] ?? sample,
          ) <= tolerance,
      ),
    );
  },
  resize: (_element, box) => ({ visual: { ...box } }),
  defaultSemantic: () => ({
    contours: [
      {
        points: [
          { x: 50, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ],
    fillRule: "evenodd",
  }),
  defaultVisual: () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    style: { fill: "#1d2a2e" },
  }),
};
