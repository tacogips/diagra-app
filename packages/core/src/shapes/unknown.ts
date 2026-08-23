// Fallback ShapeUtil for element types this build does not model.
//
// Forward compatibility rule (design section 5.2): an unknown type is not an
// error. If it carries a position it stays visible, selectable and movable
// so a newer file can be opened, nudged and saved without losing the
// element; it is not resizable, because nothing here knows what its size
// would mean.

import { type Box, boxContains } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";

export const UNKNOWN_DEFAULT_WIDTH = 120;
export const UNKNOWN_DEFAULT_HEIGHT = 48;

function unknownBounds(visual: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Box | null {
  if (visual.x === undefined || visual.y === undefined) {
    // No coordinates at all: a derived-layout element (a sequence message,
    // for instance). It has no page-space box to offer.
    return null;
  }
  return {
    x: visual.x,
    y: visual.y,
    width: visual.width ?? UNKNOWN_DEFAULT_WIDTH,
    height: visual.height ?? UNKNOWN_DEFAULT_HEIGHT,
  };
}

export const unknownShapeUtil: ShapeUtil = {
  type: "unknown",
  canResize: false,
  getBounds(element) {
    return unknownBounds(element.visual);
  },
  hitTest(element, point) {
    const box = unknownBounds(element.visual);
    return box !== null && boxContains(box, point);
  },
  defaultSemantic() {
    return {};
  },
  defaultVisual() {
    return { x: 0, y: 0 };
  },
};
