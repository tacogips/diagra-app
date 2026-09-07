// Declared key orders for deterministic serialization.
//
// The IR declares the order; `@diagra/io` applies it. Keys listed in `keys`
// are emitted first in that order; any remaining key (including fields this
// build does not model) is emitted afterwards sorted lexicographically, so
// unknown fields are preserved and still land in a stable position.

export interface KeyOrder {
  readonly keys: readonly string[];
  /**
   * Key orders for nested values. For an array value the order applies to
   * each item; for an object value it applies to the object itself.
   */
  readonly children?: Readonly<Record<string, KeyOrder>>;
  /**
   * Keys holding page-space coordinates. Writers round these to
   * {@link COORDINATE_PRECISION} so floating-point noise never reaches a
   * git diff. Only declared keys are rounded: other numbers (text offsets,
   * pen pressure, opacity) keep full precision.
   */
  readonly coordinates?: readonly string[];
}

/** Coordinates are serialized to 0.01 units. Design section 6. */
export const COORDINATE_PRECISION = 0.01;

export const VISUAL_STYLE_KEY_ORDER: KeyOrder = {
  keys: [
    "fill",
    "fillGradient",
    "stroke",
    "strokeGradient",
    "strokeWidth",
    "strokeCap",
    "strokeJoin",
    "strokeMiterLimit",
    "strokeDashArray",
    "strokeDashOffset",
    "cornerRadius",
    "cornerRadii",
    "dash",
    "opacity",
    "blendMode",
    "color",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "fontVariations",
    "fontFeatures",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "textDecoration",
    "verticalAlign",
    "effects",
    "shadow",
  ],
  children: {
    cornerRadii: {
      keys: ["topLeft", "topRight", "bottomRight", "bottomLeft"],
    },
    fillGradient: {
      keys: ["type", "angle", "centerX", "centerY", "radius", "stops"],
      children: { stops: { keys: ["offset", "color", "opacity"] } },
    },
    strokeGradient: {
      keys: ["type", "angle", "centerX", "centerY", "radius", "stops"],
      children: { stops: { keys: ["offset", "color", "opacity"] } },
    },
    effects: {
      keys: ["type", "x", "y", "blur", "color", "opacity", "enabled"],
    },
    fontVariations: { keys: ["tag", "value"] },
    fontFeatures: { keys: ["tag", "value"] },
    shadow: { keys: ["x", "y", "blur", "color", "opacity"] },
  },
};

// `rotation` is quantized alongside the geometry: it is in degrees (see
// `Visual.rotation`), so 0.01 units is 0.01 degrees - below anything a
// renderer can show, and it keeps rotated elements out of noisy diffs.
export const VISUAL_KEY_ORDER: KeyOrder = {
  keys: [
    "x",
    "y",
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "aspectRatio",
    "textResize",
    "rotation",
    "hidden",
    "locked",
    "prototypeFixed",
    "horizontalConstraint",
    "verticalConstraint",
    "componentKey",
    "layerName",
    "layoutGrow",
    "layoutPosition",
    "strokeBounds",
    "colorTokens",
    "numberTokens",
    "textStyle",
    "style",
  ],
  children: { style: VISUAL_STYLE_KEY_ORDER },
  coordinates: [
    "x",
    "y",
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "rotation",
  ],
};
