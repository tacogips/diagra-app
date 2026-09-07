// node.generic: a labelled box, the neutral node type edges connect.

import { type Box, roundedBoxContains } from "../geometry.ts";
import {
  resolvedCornerRadii,
  unevenRoundedBoxContains,
} from "../corner-radii.ts";
import type { ShapeUtil } from "../shape-util.ts";

export const NODE_DEFAULT_WIDTH = 140;
export const NODE_DEFAULT_HEIGHT = 60;

export function nodeBounds(visual: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Box {
  return {
    x: visual.x ?? 0,
    y: visual.y ?? 0,
    width: visual.width ?? NODE_DEFAULT_WIDTH,
    height: visual.height ?? NODE_DEFAULT_HEIGHT,
  };
}

export const nodeShapeUtil: ShapeUtil = {
  type: "node.generic",
  canResize: true,
  getBounds(element) {
    return nodeBounds(element.visual);
  },
  hitTest(element, point) {
    if (element.visual.style?.cornerRadii)
      return unevenRoundedBoxContains(
        nodeBounds(element.visual),
        point,
        resolvedCornerRadii(element.visual.style, 8),
      );
    return roundedBoxContains(
      nodeBounds(element.visual),
      point,
      element.visual.style?.cornerRadius ?? 0,
    );
  },
  resize(_element, box) {
    return {
      visual: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  },
  defaultSemantic() {
    return { label: "Node" };
  },
  defaultVisual() {
    return {
      x: 0,
      y: 0,
      width: NODE_DEFAULT_WIDTH,
      height: NODE_DEFAULT_HEIGHT,
    };
  },
};
