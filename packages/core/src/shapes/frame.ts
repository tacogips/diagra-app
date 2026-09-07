import { type Box, boxContains } from "../geometry.ts";
import {
  resolvedCornerRadii,
  unevenRoundedBoxContains,
} from "../corner-radii.ts";
import type { ShapeUtil } from "../shape-util.ts";
import type { FramePlatform, FrameSemantic, SafeAreaInsets } from "@diagra/ir";

export interface FramePreset {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly platform: FramePlatform;
  readonly safeArea?: SafeAreaInsets;
}

/** Editable design dimensions, in canvas units rather than hardware pixels. */
export const FRAME_PRESETS = {
  web: { name: "Web desktop", width: 1440, height: 900, platform: "web" },
  iphone: {
    name: "iPhone",
    width: 390,
    height: 844,
    platform: "ios",
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  android: {
    name: "Android",
    width: 360,
    height: 800,
    platform: "android",
    safeArea: { top: 24, right: 0, bottom: 24, left: 0 },
  },
  tablet: {
    name: "Tablet",
    width: 768,
    height: 1024,
    platform: "ios",
    safeArea: { top: 24, right: 0, bottom: 20, left: 0 },
  },
  paper: {
    name: "A4 document",
    width: 794,
    height: 1123,
    platform: "document",
  },
} as const satisfies Record<string, FramePreset>;

export type FramePresetKey = keyof typeof FRAME_PRESETS;

/** Clamp portable safe-area insets into a usable content rectangle. */
export function safeAreaContentBox(bounds: Box, insets: SafeAreaInsets): Box {
  const left = Math.min(Math.max(0, insets.left), bounds.width);
  const right = Math.min(Math.max(0, insets.right), bounds.width - left);
  const top = Math.min(Math.max(0, insets.top), bounds.height);
  const bottom = Math.min(Math.max(0, insets.bottom), bounds.height - top);
  return {
    x: bounds.x + left,
    y: bounds.y + top,
    width: bounds.width - left - right,
    height: bounds.height - top - bottom,
  };
}

export function frameBounds(visual: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Box {
  return {
    x: visual.x ?? 0,
    y: visual.y ?? 0,
    width: visual.width ?? 390,
    height: visual.height ?? 844,
  };
}

export const frameShapeUtil: ShapeUtil = {
  type: "frame",
  canResize: true,
  getBounds: (element) => frameBounds(element.visual),
  // The interior stays available for marquee selection and drawing.
  hitTest(element, point) {
    const box = frameBounds(element.visual);
    return (
      (element.visual.style?.cornerRadii
        ? unevenRoundedBoxContains(
            box,
            point,
            resolvedCornerRadii(element.visual.style),
          )
        : boxContains(box, point)) &&
      (point.x <= box.x + 8 ||
        point.x >= box.x + box.width - 8 ||
        point.y <=
          box.y +
            ((element.semantic as FrameSemantic).showTitle === false
              ? 8
              : 24) ||
        point.y >= box.y + box.height - 8)
    );
  },
  resize(_element, box) {
    return { visual: { ...box } };
  },
  defaultSemantic: () => ({ name: "Frame" }),
  defaultVisual: () => ({
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    style: { fill: "#ffffff", stroke: "#cbd5e1", strokeWidth: 1 },
  }),
};
