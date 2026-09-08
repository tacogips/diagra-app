import type { ElementId, GroupSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { frameParents } from "./frame-tree.ts";
import { cornerRadiiCss, resolvedCornerRadii } from "./corner-radii.ts";
import { strokeDashCss } from "./stroke-dash.ts";
import { backdropEffectsCss, effectsCss } from "./effects.ts";
import { gradientCss } from "./gradient.ts";
import {
  colorTokenCssName,
  measurementHandoff,
  numberTokenCssName,
  paletteHandoff,
  textStyleCssName,
  typographyCssValue,
  typographyHandoff,
} from "./token-handoff.ts";
import { layoutHandoff } from "./layout-handoff.ts";
import { booleanGeometry, booleanMaskCss } from "./boolean-operations.ts";
import { groupOf } from "./group.ts";
import { fontFeatureCss, fontVariationCss } from "./font-settings.ts";
import { compoundPathMaskCss } from "./shapes/compound-path.ts";

/** CSS strings cannot terminate their declaration or introduce new rules. */
function cssString(value: string): string {
  return `"${value.replace(/[\\"\n\r\f<>]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}"`;
}

function cssColor(value: string): string | null {
  // Only literal hex colors and safe keywords are emitted. The full stored
  // value remains in JSON; arbitrary CSS functions/URLs are not executable.
  return /^(#[\da-f]{3,8}|transparent|currentColor|[a-z]+)$/i.test(value)
    ? value
    : null;
}

/** Read-only, deterministic handoff; coordinates are unrotated design units. */
export function inspectDesign(editor: Editor, id: ElementId) {
  const element = editor.store.get(id);
  if (!element) return null;
  const context = editor.createShapeContext();
  const bounds = context.boundsOf(id);
  const parentId =
    groupOf(editor.store, id)?.id ??
    frameParents(editor.store, element.page, context).get(id) ??
    null;
  const parentBounds = parentId ? context.boundsOf(parentId) : null;
  const relativeBounds = bounds && {
    ...bounds,
    x: bounds.x - (parentBounds?.x ?? 0),
    y: bounds.y - (parentBounds?.y ?? 0),
  };
  const clipPolygon = context.clipPolygonOf?.(id);
  const declarations: string[] = [];
  const linkedDeclarations: string[] = [];
  const notes = [
    "CSS is an absolute-positioned starting point, not generated application code.",
    "Only stored styles are included; theme defaults, shape geometry and text wrapping may differ.",
    "Auto layout is emitted separately; non-layout resize constraints remain in JSON for implementation in the target UI.",
  ];
  const add = (
    key: string,
    value: string | number | undefined,
    linked?: string,
  ): void => {
    if (value !== undefined) {
      declarations.push(`${key}: ${value};`);
      linkedDeclarations.push(`${key}: ${linked ?? value};`);
    }
  };
  const px = (value: number | undefined): string | undefined =>
    value === undefined ? undefined : `${Number(value.toFixed(4))}px`;
  const linkedPx = (
    field: keyof NonNullable<typeof element.visual.numberTokens>,
    value: number,
  ) => {
    const tokenId = element.visual.numberTokens?.[field];
    const token = tokenId ? editor.store.get(tokenId) : undefined;
    return token?.type === "design.token" &&
      (token.semantic as { kind?: unknown }).kind === "number"
      ? `var(${numberTokenCssName(token.id)}, ${px(value)})`
      : undefined;
  };
  if (relativeBounds) {
    add("position", "absolute");
    add("box-sizing", "border-box");
    add("left", px(relativeBounds.x));
    add("top", px(relativeBounds.y));
    add(
      "width",
      px(relativeBounds.width),
      linkedPx("width", relativeBounds.width),
    );
    add(
      "height",
      px(relativeBounds.height),
      linkedPx("height", relativeBounds.height),
    );
  }
  for (const [property, field] of [
    ["min-width", "minWidth"],
    ["max-width", "maxWidth"],
    ["min-height", "minHeight"],
    ["max-height", "maxHeight"],
  ] as const) {
    const value = element.visual[field];
    if (value !== undefined) add(property, px(value), linkedPx(field, value));
  }
  add("aspect-ratio", element.visual.aspectRatio);
  if (bounds && clipPolygon) {
    const polygon =
      clipPolygon.length >= 3
        ? clipPolygon
            .map(
              (point) =>
                `${Number((point.x - bounds.x).toFixed(4))}px ${Number((point.y - bounds.y).toFixed(4))}px`,
            )
            .join(", ")
        : "0 0, 0 0, 0 0";
    add("clip-path", `polygon(${polygon})`);
  }
  const style = element.visual.style;
  if (element.type === "group" && (element.semantic as GroupSemantic).isolate)
    add("isolation", "isolate");
  const boolean = booleanGeometry(element, context);
  if (boolean) {
    add("mask-image", booleanMaskCss(boolean));
    add("mask-repeat", "no-repeat");
    add("mask-size", "100% 100%");
  }
  const compoundPathMask = compoundPathMaskCss(element);
  if (compoundPathMask) {
    add("mask-image", compoundPathMask);
    add("mask-repeat", "no-repeat");
    add("mask-size", "100% 100%");
  }
  const textStyle = element.visual.textStyle
    ? editor.store.get(element.visual.textStyle)
    : undefined;
  const linkedTypography =
    textStyle?.type === "design.text-style" ? textStyle.id : null;
  const linkedType = (
    field: Parameters<typeof textStyleCssName>[1],
    value: Parameters<typeof typographyCssValue>[1],
  ): string | undefined =>
    linkedTypography
      ? `var(${textStyleCssName(linkedTypography, field)}, ${typographyCssValue(field, value)})`
      : undefined;
  if (style?.fillGradient)
    add("background-image", gradientCss(style.fillGradient));
  if (style?.strokeGradient) {
    add("border-image-source", gradientCss(style.strokeGradient));
    add("border-image-slice", "1");
  }
  add("filter", effectsCss(style));
  add("backdrop-filter", backdropEffectsCss(style));
  for (const [key, value, field] of [
    ["background-color", style?.fill, "fill"],
    ["border-color", style?.stroke, "stroke"],
    ["color", style?.color, "color"],
  ] as const) {
    if (value === undefined) continue;
    const color = cssColor(value);
    const tokenId = element.visual.colorTokens?.[field];
    const token = tokenId ? editor.store.get(tokenId) : undefined;
    const linked =
      token?.type === "design.token" &&
      (token.semantic as { kind?: unknown }).kind === "color"
        ? `var(${colorTokenCssName(token.id)}, ${color})`
        : undefined;
    if (color) add(key, color, linked);
    else notes.push(`${key} omitted from CSS; see the stored value in JSON.`);
  }
  if (style?.strokeWidth !== undefined) {
    add(
      "border-width",
      px(style.strokeWidth),
      linkedPx("strokeWidth", style.strokeWidth),
    );
    add("border-style", style.dash ?? "solid");
  }
  const dash = strokeDashCss(style);
  if (dash !== undefined) add("stroke-dasharray", dash);
  if (style?.strokeDashOffset !== undefined)
    add("stroke-dashoffset", String(style.strokeDashOffset));
  add("stroke-linecap", style?.strokeCap);
  add("stroke-linejoin", style?.strokeJoin);
  if (style?.strokeMiterLimit !== undefined)
    add("stroke-miterlimit", String(style.strokeMiterLimit));
  if (style?.cornerRadii) {
    const radii = resolvedCornerRadii(style);
    add(
      "border-radius",
      cornerRadiiCss(radii),
      (
        [
          ["cornerTopLeft", radii.topLeft],
          ["cornerTopRight", radii.topRight],
          ["cornerBottomRight", radii.bottomRight],
          ["cornerBottomLeft", radii.bottomLeft],
        ] as const
      )
        .map(([field, value]) => linkedPx(field, value) ?? px(value))
        .join(" "),
    );
  } else if (style?.cornerRadius !== undefined)
    add(
      "border-radius",
      px(style.cornerRadius),
      linkedPx("cornerRadius", style.cornerRadius),
    );
  add("opacity", style?.opacity);
  if (style?.fontSize !== undefined)
    add(
      "font-size",
      px(style.fontSize),
      linkedType("fontSize", style.fontSize) ??
        linkedPx("fontSize", style.fontSize),
    );
  if (style?.fontFamily !== undefined)
    add(
      "font-family",
      cssString(style.fontFamily),
      linkedType("fontFamily", style.fontFamily),
    );
  if (style?.fontWeight !== undefined)
    add(
      "font-weight",
      style.fontWeight,
      linkedType("fontWeight", style.fontWeight),
    );
  if (style?.fontStyle !== undefined)
    add(
      "font-style",
      style.fontStyle,
      linkedType("fontStyle", style.fontStyle),
    );
  if (style?.fontVariations)
    add(
      "font-variation-settings",
      fontVariationCss(style),
      linkedType("fontVariations", style.fontVariations),
    );
  if (style?.fontFeatures)
    add(
      "font-feature-settings",
      fontFeatureCss(style),
      linkedType("fontFeatures", style.fontFeatures),
    );
  if (style?.textDecoration !== undefined)
    add(
      "text-decoration",
      style.textDecoration,
      linkedType("textDecoration", style.textDecoration),
    );
  if (style?.lineHeight !== undefined)
    add(
      "line-height",
      style.lineHeight,
      linkedType("lineHeight", style.lineHeight),
    );
  if (element.type === "text.note" && style?.verticalAlign) {
    add("display", "flex");
    add("flex-direction", "column");
    add(
      "justify-content",
      style.verticalAlign === "middle"
        ? "safe center"
        : style.verticalAlign === "bottom"
          ? "safe flex-end"
          : "flex-start",
    );
  }
  if (element.type === "text.note" && element.visual.textResize) {
    add(
      "white-space",
      element.visual.textResize === "auto-width" ? "pre" : "pre-wrap",
    );
    if (element.visual.textResize !== "fixed")
      notes.push(
        "Text auto-size dimensions use deterministic estimated glyph metrics; verify with the production font.",
      );
  }
  if (style?.letterSpacing !== undefined)
    add(
      "letter-spacing",
      px(style.letterSpacing),
      linkedType("letterSpacing", style.letterSpacing) ??
        linkedPx("letterSpacing", style.letterSpacing),
    );
  if (style?.textAlign)
    add(
      "text-align",
      style.textAlign === "middle" ? "center" : style.textAlign,
      linkedType("textAlign", style.textAlign),
    );
  if (element.visual.rotation)
    add("transform", `rotate(${element.visual.rotation}deg)`);
  if (style?.blendMode) add("mix-blend-mode", style.blendMode);
  if (context.isHidden?.(id)) add("display", "none");
  return {
    id,
    type: element.type,
    page: element.page,
    parentFrame: parentId,
    bounds,
    relativeBounds,
    visual: element.visual,
    semantic: element.semantic,
    css: declarations.join("\n"),
    linkedCss: linkedDeclarations.join("\n"),
    palette: paletteHandoff(editor),
    measurements: measurementHandoff(editor),
    typography: typographyHandoff(editor),
    layout: layoutHandoff(editor, id),
    notes,
  };
}
