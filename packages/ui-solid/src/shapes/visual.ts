// Translation from the IR's `VisualStyle` to SVG attributes and CSS.
//
// Only fields the document actually carries are emitted; everything else is
// left to the stylesheet, so a document with no styling still looks like the
// app rather than like unstyled SVG.

import {
  backdropEffectsCss,
  effectsCss,
  fontFeatureCss,
  fontVariationCss,
  gradientCss,
  gradientId,
  strokeGradientId,
} from "@diagra/core";
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
  readonly "stroke-linecap"?: "butt" | "round" | "square";
  readonly "stroke-linejoin"?: "miter" | "round" | "bevel";
  readonly "stroke-miterlimit"?: number;
}

export function svgStyle(
  visual: Visual,
  elementId?: string,
): SvgStyleAttributes {
  const style = visual.style;
  if (!style) {
    return {};
  }
  const dash = style.dash ? DASH_PATTERNS[style.dash] : undefined;
  return {
    ...(style.fillGradient && elementId
      ? { fill: `url(#${gradientId(elementId)})` }
      : style.fill === undefined
        ? {}
        : { fill: style.fill }),
    ...(style.strokeGradient && elementId
      ? { stroke: `url(#${strokeGradientId(elementId)})` }
      : style.stroke === undefined
        ? {}
        : { stroke: style.stroke }),
    ...(style.strokeWidth === undefined
      ? {}
      : { "stroke-width": style.strokeWidth }),
    ...(style.dash === undefined ? {} : { "stroke-dasharray": dash ?? "" }),
    ...(style.strokeCap === undefined
      ? {}
      : { "stroke-linecap": style.strokeCap }),
    ...(style.strokeJoin === undefined
      ? {}
      : { "stroke-linejoin": style.strokeJoin }),
    ...(style.strokeMiterLimit === undefined
      ? {}
      : { "stroke-miterlimit": style.strokeMiterLimit }),
  };
}

/** CSS border paint for HTML-backed layers. */
export function strokeBorderStyle(visual: Visual): JSX.CSSProperties {
  const style = visual.style;
  return style?.strokeGradient
    ? {
        "border-color": "transparent",
        "border-image-source": gradientCss(style.strokeGradient),
        "border-image-slice": 1,
        ...(style.strokeWidth === undefined
          ? {}
          : { "border-width": `${style.strokeWidth}px` }),
        "border-style":
          style.dash === "dashed"
            ? "dashed"
            : style.dash === "dotted"
              ? "dotted"
              : "solid",
      }
    : style?.stroke === undefined
      ? {}
      : {
          "border-color": style.stroke,
          ...(style.strokeWidth === undefined
            ? {}
            : { "border-width": `${style.strokeWidth}px` }),
          ...(style.dash === undefined ? {} : { "border-style": style.dash }),
        };
}

export function fillPaint(
  visual: Visual,
  fallback?: string,
): string | undefined {
  return visual.style?.fillGradient
    ? gradientCss(visual.style.fillGradient)
    : (visual.style?.fill ?? fallback);
}

/** Complete HTML background style, including deterministic sizing for SVG-backed paints. */
export function fillPaintStyle(
  visual: Visual,
  fallback?: string,
): JSX.CSSProperties {
  const style = visual.style;
  return style?.fillGradient
    ? {
        "background-color": style.fill ?? fallback,
        "background-image": gradientCss(style.fillGradient),
        "background-position": "center",
        "background-repeat": "no-repeat",
        "background-size": "100% 100%",
      }
    : { background: style?.fill ?? fallback };
}

/** Text styling for the HTML label layered over a shape. */
export function labelStyle(visual: Visual): JSX.CSSProperties {
  const style = visual.style;
  if (!style) {
    return {};
  }
  return {
    ...typographyStyle(visual),
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

export function typographyStyle(visual: Visual): JSX.CSSProperties {
  const style = visual.style;
  return {
    ...(style?.textDecoration === undefined
      ? {}
      : { "text-decoration": style.textDecoration }),
    ...(style?.fontFamily === undefined
      ? {}
      : { "font-family": style.fontFamily }),
    ...(style?.fontWeight === undefined
      ? {}
      : { "font-weight": style.fontWeight }),
    ...(style?.fontStyle === undefined
      ? {}
      : { "font-style": style.fontStyle }),
    ...(fontVariationCss(style) === undefined
      ? {}
      : { "font-variation-settings": fontVariationCss(style) }),
    ...(fontFeatureCss(style) === undefined
      ? {}
      : { "font-feature-settings": fontFeatureCss(style) }),
    ...(style?.lineHeight === undefined
      ? {}
      : { "line-height": style.lineHeight }),
    ...(style?.letterSpacing === undefined
      ? {}
      : { "letter-spacing": `${style.letterSpacing}px` }),
  };
}

/** Degrees, about the element's own centre. */
export function rotationStyle(visual: Visual): JSX.CSSProperties {
  return visual.rotation === undefined || visual.rotation === 0
    ? {}
    : { transform: `rotate(${visual.rotation}deg)` };
}

/** Appearance owned by the layer wrapper so previews can animate it once. */
export function layerAppearanceStyle(visual: Visual): JSX.CSSProperties {
  return {
    ...rotationStyle(visual),
    opacity: visual.style?.opacity ?? 1,
    filter: effectsCss(visual.style),
    "backdrop-filter": backdropEffectsCss(visual.style),
    "mix-blend-mode": visual.style?.blendMode ?? "normal",
  };
}
