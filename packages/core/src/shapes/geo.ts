// shape.geo: the eight primitive geometric shapes.
//
// All of them are box-driven, so bounds and resize are shared; only picking
// differs, and only where the difference is visible enough to matter (an
// ellipse's corners and a diamond's corners are large empty regions).

import type { GeoKind } from "@diagra/ir";
import {
  type Box,
  boxContains,
  diamondContains,
  ellipseContains,
} from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";

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
      case "ellipse":
        return ellipseContains(box, point);
      case "diamond":
        return diamondContains(box, point);
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
