// text.note: free-standing text. A box like any other; the text wraps
// inside it and the renderer clips whatever does not fit.

import { type Box, boxContains } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";

export const TEXT_NOTE_DEFAULT_WIDTH = 200;
export const TEXT_NOTE_DEFAULT_HEIGHT = 48;

export function textNoteBounds(visual: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Box {
  return {
    x: visual.x ?? 0,
    y: visual.y ?? 0,
    width: visual.width ?? TEXT_NOTE_DEFAULT_WIDTH,
    height: visual.height ?? TEXT_NOTE_DEFAULT_HEIGHT,
  };
}

export function textNoteText(semantic: unknown): string {
  if (typeof semantic !== "object" || semantic === null) {
    return "";
  }
  const text = (semantic as Record<string, unknown>)["text"];
  return typeof text === "string" ? text : "";
}

export const textNoteShapeUtil: ShapeUtil = {
  type: "text.note",
  canResize: true,
  getBounds(element) {
    return textNoteBounds(element.visual);
  },
  hitTest(element, point) {
    return boxContains(textNoteBounds(element.visual), point);
  },
  resize(_element, box) {
    return {
      visual: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  },
  defaultSemantic() {
    return { text: "" };
  },
  defaultVisual() {
    return {
      x: 0,
      y: 0,
      width: TEXT_NOTE_DEFAULT_WIDTH,
      height: TEXT_NOTE_DEFAULT_HEIGHT,
    };
  },
};
