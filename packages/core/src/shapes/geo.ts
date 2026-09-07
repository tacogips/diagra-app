// shape.geo: the eight primitive geometric shapes.
//
// All of them are box-driven, so bounds and resize are shared; only picking
// differs, and only where the difference is visible enough to matter (an
// ellipse's corners and a diamond's corners are large empty regions).

import type { GeoKind } from "@diagra/ir";
import {
  resolvedCornerRadii,
  unevenRoundedBoxContains,
} from "../corner-radii.ts";
import {
  type Box,
  boxContains,
  ellipseContains,
  roundedBoxContains,
} from "../geometry.ts";
import { polygonContains } from "../clipping.ts";
import type { ShapeUtil } from "../shape-util.ts";
import { geoOutlinePolygon } from "./outline.ts";

export const GEO_DEFAULT_WIDTH = 160;
export const GEO_DEFAULT_HEIGHT = 100;

export function geoBounds(visual: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Box {
  return {
    x: visual.x ?? 0,
    y: visual.y ?? 0,
    width: visual.width ?? GEO_DEFAULT_WIDTH,
    height: visual.height ?? GEO_DEFAULT_HEIGHT,
  };
}

function geoKindOf(semantic: unknown): GeoKind | undefined {
  if (typeof semantic !== "object" || semantic === null) {
    return undefined;
  }
  const geo = (semantic as Record<string, unknown>)["geo"];
  return typeof geo === "string" ? (geo as GeoKind) : undefined;
}

export const geoShapeUtil: ShapeUtil = {
  type: "shape.geo",
  canResize: true,
  getBounds(element) {
    return geoBounds(element.visual);
  },
  hitTest(element, point) {
    const box = geoBounds(element.visual);
    switch (geoKindOf(element.semantic)) {
      case "rect":
        return element.visual.style?.cornerRadii
          ? unevenRoundedBoxContains(
              box,
              point,
              resolvedCornerRadii(element.visual.style),
            )
          : roundedBoxContains(
              box,
              point,
              element.visual.style?.cornerRadius ?? 0,
            );
      case "ellipse":
        return ellipseContains(
          {
            x: box.x + 1,
            y: box.y + 1,
            width: Math.max(0, box.width - 2),
            height: Math.max(0, box.height - 2),
          },
          point,
        );
      case "diamond":
      case "triangle":
      case "hexagon":
      case "parallelogram":
      case "cylinder":
      case "star": {
        const polygon = geoOutlinePolygon(
          geoKindOf(element.semantic) ?? "rect",
          box,
        );
        return polygon
          ? polygonContains(polygon, point)
          : boxContains(box, point);
      }
      default:
        return boxContains(box, point);
    }
  },
  resize(_element, box) {
    return {
      visual: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  },
  defaultSemantic() {
    return { geo: "rect", label: "" };
  },
  defaultVisual() {
    return { x: 0, y: 0, width: GEO_DEFAULT_WIDTH, height: GEO_DEFAULT_HEIGHT };
  },
};
