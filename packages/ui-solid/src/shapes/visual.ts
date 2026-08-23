// Translation from the IR's `VisualStyle` to SVG attributes and CSS.
//
// Only fields the document actually carries are emitted; everything else is
// left to the stylesheet, so a document with no styling still looks like the
// app rather than like unstyled SVG.

import type { Visual } from "@diagra/ir";
import type { JSX } from "solid-js";

const DASH_PATTERNS: Record<string, string> = {
  solid: "",
  dashed: "6 4",
  dotted: "1 4",
};

export interface SvgStyleAttributes {
  readonly fill?: string;
  readonly stroke?: string;
  readonly "stroke-width"?: number;
  readonly "stroke-dasharray"?: string;
  readonly opacity?: number;
}

export function svgStyle(visual: Visual): SvgStyleAttributes {
  const style = visual.style;
  if (!style) {
    return {};
  }
  const dash = style.dash ? DASH_PATTERNS[style.dash] : undefined;
  return {
    ...(style.fill === undefined ? {} : { fill: style.fill }),
    ...(style.stroke === undefined ? {} : { stroke: style.stroke }),
    ...(style.strokeWidth === undefined
      ? {}
      : { "stroke-width": style.strokeWidth }),
    ...(dash ? { "stroke-dasharray": dash } : {}),
    ...(style.opacity === undefined ? {} : { opacity: style.opacity }),
  };
}

/** Text styling for the HTML label layered over a shape. */
export function labelStyle(visual: Visual): JSX.CSSProperties {
  const style = visual.style;
  if (!style) {
    return {};
  }
  return {
    ...(style.color === undefined ? {} : { color: style.color }),
    ...(style.fontSize === undefined
      ? {}
      : { "font-size": `${style.fontSize}px` }),
    ...(style.textAlign === undefined
      ? {}
      : {
          "justify-content":
            style.textAlign === "start"
              ? "flex-start"
              : style.textAlign === "end"
                ? "flex-end"
                : "center",
        }),
  };
}

/** Degrees, about the element's own centre. */
export function rotationStyle(visual: Visual): JSX.CSSProperties {
  return visual.rotation === undefined || visual.rotation === 0
    ? {}
    : { transform: `rotate(${visual.rotation}deg)` };
}
