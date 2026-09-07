import type {
  Element,
  FreehandSemantic,
  GeoKind,
  GeoShapeSemantic,
  PathSemantic,
} from "@diagra/ir";
import { resolvedCornerRadii, roundedRectPolygon } from "../corner-radii.ts";
import type { Box, Vec } from "../geometry.ts";
import type { ShapeContext } from "../shape-util.ts";
import { flattenStroke } from "../stroke-path.ts";
import { freehandGeometry } from "./freehand.ts";
import { compoundPathGeometry } from "./compound-path.ts";
import { geoOutline } from "./geo-outline.ts";

function parsePoints(source: string, box: Box): readonly Vec[] | null {
  const points: Vec[] = [];
  for (const pair of source.split(" ")) {
    const [x, y] = pair.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x: box.x + (x ?? 0), y: box.y + (y ?? 0) });
  }
  return points.length >= 3 ? points : null;
}

function ellipsePoints(
  center: Vec,
  radiusX: number,
  radiusY: number,
  from = 0,
  to = Math.PI * 2,
  segments = 32,
): Vec[] {
  const closed = Math.abs(to - from - Math.PI * 2) <= 1e-9;
  return Array.from({ length: segments + (closed ? 0 : 1) }, (_, index) => {
    const angle = from + ((to - from) * index) / segments;
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    };
  });
}

/** Unrotated page-space polygon matching a rendered geometric primitive. */
export function geoOutlinePolygon(
  kind: GeoKind | string,
  box: Box,
): readonly Vec[] | null {
  const outline = geoOutline(kind, box.width, box.height);
  if (outline.kind === "polygon") return parsePoints(outline.points, box);
  if (outline.kind === "ellipse")
    return ellipsePoints(
      { x: box.x + outline.cx, y: box.y + outline.cy },
      outline.rx,
      outline.ry,
    );
  if (outline.kind === "cylinder") {
    const centerX = box.x + outline.cap.cx;
    const topCenterY = box.y + outline.cap.cy;
    const bottomCenterY = box.y + box.height - outline.cap.cy;
    return [
      ...ellipsePoints(
        { x: centerX, y: topCenterY },
        outline.cap.rx,
        outline.cap.ry,
        Math.PI,
        Math.PI * 2,
        16,
      ),
      ...ellipsePoints(
        { x: centerX, y: bottomCenterY },
        outline.cap.rx,
        outline.cap.ry,
        0,
        Math.PI,
        16,
      ),
    ];
  }
  return null;
}

/**
 * Unrotated page-space outline used by picking, hotspots and connectors.
 * `null` means the ordinary rectangular bounds remain the interaction region.
 */
export function elementOutlinePolygon(
  element: Element,
  context: ShapeContext,
): readonly Vec[] | null {
  const box = context.boundsOf(element.id);
  if (!box) return null;
  if (element.type === "shape.geo") {
    const kind = (element.semantic as GeoShapeSemantic).geo;
    if (
      kind === "rect" &&
      (element.visual.style?.cornerRadii || element.visual.style?.cornerRadius)
    )
      return roundedRectPolygon(box, resolvedCornerRadii(element.visual.style));
    return geoOutlinePolygon(kind, box);
  }
  if (element.type === "draw.freehand") {
    if ((element.semantic as FreehandSemantic).closed !== true) return null;
    const geometry = freehandGeometry(element);
    return geometry
      ? flattenStroke(geometry.points, true, 0.5).map((point) => ({
          x: geometry.box.x + point.x,
          y: geometry.box.y + point.y,
        }))
      : null;
  }
  if (element.type === "draw.path") {
    const semantic = element.semantic as PathSemantic;
    const geometry = compoundPathGeometry(element);
    const contour = geometry?.contours[0];
    if (semantic.contours.length !== 1 || !geometry || !contour) return null;
    return flattenStroke(contour, true, 0.5).map((point) => ({
      x: geometry.box.x + point.x,
      y: geometry.box.y + point.y,
    }));
  }
  return element.visual.style?.cornerRadii || element.visual.style?.cornerRadius
    ? roundedRectPolygon(box, resolvedCornerRadii(element.visual.style))
    : null;
}
