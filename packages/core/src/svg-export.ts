// Deterministic SVG export of a page or a selection.
//
// String concatenation rather than DOM construction, because this package
// must run wherever the core runs — a Bun test, a worker, a headless export
// — and because a serializer that owns every byte can promise the one thing
// an export needs to promise: the same document renders to the same file.
//
// It is a second renderer, not the Solid one reused. The canvas draws box
// shapes as HTML so the browser can clip and ellipsize text for it; an SVG
// file has no such help, so the geometry that both agree on lives in the
// core (`geoOutline`, the bounds helpers, `connectorDecoration`) and the
// per-type text layout is written out here against the same constants.

import {
  type Element,
  type ElementId,
  type ErdColumn,
  type ErdTableSemantic,
  type FillGradient,
  type ImageSemantic,
  type LayerEffect,
  type PathSemantic,
  type GroupSemantic,
  type TextMark,
  getElementTypeDefinition,
  type PageId,
  type Visual,
} from "@diagra/ir";
import { type Box, boxCenter, rotatedBox, unionBoxes } from "./geometry.ts";
import { croppedImageBox } from "./image-crop.ts";
import { resolvedCornerRadii, roundedRectPath } from "./corner-radii.ts";
import { createShapeContext } from "./hit-test.ts";
import { intersectClip } from "./clipping.ts";
import { effectsBounds, layerEffects } from "./effects.ts";
import { fontFeatureCss, fontVariationCss } from "./font-settings.ts";
import {
  booleanGeometry,
  booleanMaskDefinition,
} from "./boolean-operations.ts";
import {
  angularGradientPatches,
  diamondGradientPatches,
  gradientId,
  linearGradientVector,
  sampleGradient,
  strokeGradientId,
} from "./gradient.ts";
import { selfContained } from "./references.ts";
import { memberIdsOf } from "./group.ts";
import { richTextSegments, safeTextLinkHref } from "./rich-text.ts";
import { expandContainers } from "./frame-tree.ts";
import type { ShapeContext, ShapeUtilRegistry } from "./shape-util.ts";
import {
  connectorDefaultDash,
  connectorDecoration,
  endpointReaderFor,
  type MarkerKind,
  resolveConnector,
} from "./shapes/connector.ts";
import {
  ERD_TABLE_HEADER_HEIGHT,
  ERD_TABLE_ROW_HEIGHT,
  erdColumnKey,
} from "./shapes/erdTable.ts";
import { geoOutline } from "./shapes/geo-outline.ts";
import { textNoteText } from "./shapes/textNote.ts";
import { compoundPathGeometry } from "./shapes/compound-path.ts";
import {
  UML_CLASS_NAME_HEIGHT,
  UML_CLASS_ROW_HEIGHT,
  UML_CLASS_STEREOTYPE_HEIGHT,
  umlAttributesHeight,
  umlNameHeight,
} from "./shapes/umlClass.ts";
import type { Store } from "./store.ts";
import {
  TEXT_NOTE_LINE_HEIGHT,
  TEXT_NOTE_PADDING_X,
  TEXT_NOTE_PADDING_Y,
  wrapTextLines,
} from "./text-layout.ts";

export { wrapTextLines } from "./text-layout.ts";

/** Colours and type, mirroring the app stylesheet's custom properties. */
export interface SvgTheme {
  readonly ink: string;
  readonly muted: string;
  readonly line: string;
  readonly surface: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly fontFamily: string;
  readonly fontSize: number;
}

export const DEFAULT_SVG_THEME: SvgTheme = {
  ink: "#1d2a2e",
  muted: "#596366",
  line: "#d8d2c3",
  surface: "#fffdf8",
  accent: "#335c67",
  accentSoft: "#dbe6e8",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: 13,
};

export interface SvgExportOptions {
  /** Page units of empty space around the content. Defaults to 16. */
  readonly padding?: number;
  /** Paint behind the diagram. `null` (the default) leaves it transparent. */
  readonly background?: string | null;
  readonly theme?: Partial<SvgTheme>;
  /** Exact page-space viewport; ignores padding and clips overflow. */
  readonly viewport?: Box;
}

const DEFAULT_PADDING = 16;
const SVG_NS = "http://www.w3.org/2000/svg";
const STROKE_WIDTH = 1.5;
/** Horizontal breathing room inside a shape, matching the stylesheet. */
const TEXT_PADDING = TEXT_NOTE_PADDING_X;
const ROW_PADDING = 10;
/** Grid columns of an ERD row: a 26-unit key column, then a 6-unit gap. */
const ERD_NAME_OFFSET = ROW_PADDING + 26 + 6;

const DASH_PATTERNS: Record<string, string> = {
  solid: "",
  dashed: "6 4",
  dotted: "1 4",
};

const MARKER_IDS: Record<MarkerKind, string> = {
  arrow: "diagra-arrow",
  triangle: "diagra-triangle",
  diamondOpen: "diagra-diamond-open",
  diamondFilled: "diagra-diamond-filled",
  dot: "diagra-dot",
};

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Two decimals, with no trailing zeros and no negative zero, so the same
 * geometry always spells itself the same way.
 */
function fmt(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

type Attrs = Record<string, string | number | undefined>;

function serializeAttrs(map: Attrs): string {
  let out = "";
  for (const [name, value] of Object.entries(map)) {
    if (value === undefined) {
      continue;
    }
    const text = typeof value === "number" ? fmt(value) : value;
    out += ` ${name}="${escapeXml(text)}"`;
  }
  return out;
}

function tag(name: string, map: Attrs): string {
  return `<${name}${serializeAttrs(map)} />`;
}

function wrap(name: string, map: Attrs, children: string): string {
  return `<${name}${serializeAttrs(map)}>${children}</${name}>`;
}

function text(map: Attrs, content: string): string {
  return wrap("text", map, escapeXml(content));
}

/** Document styling wins over the theme, field by field. */
function styled(base: Attrs, visual: Visual, elementId?: string): Attrs {
  const style = visual.style;
  if (!style) {
    return base;
  }
  const out: Attrs = { ...base };
  if (style.fillGradient && elementId)
    out["fill"] = `url(#${gradientId(elementId)})`;
  else if (style.fill !== undefined) {
    out["fill"] = style.fill;
  }
  if (style.strokeGradient && elementId)
    out["stroke"] = `url(#${strokeGradientId(elementId)})`;
  else if (style.stroke !== undefined) {
    out["stroke"] = style.stroke;
  }
  if (style.strokeWidth !== undefined) {
    out["stroke-width"] = style.strokeWidth;
  }
  if (style.strokeCap !== undefined) out["stroke-linecap"] = style.strokeCap;
  if (style.strokeJoin !== undefined) out["stroke-linejoin"] = style.strokeJoin;
  if (style.strokeMiterLimit !== undefined)
    out["stroke-miterlimit"] = style.strokeMiterLimit;
  if (style.dash !== undefined) {
    const dash = DASH_PATTERNS[style.dash];
    if (dash) out["stroke-dasharray"] = dash;
    else out["stroke-dasharray"] = undefined;
  }
  if (style.opacity !== undefined) {
    out["opacity"] = style.opacity;
  }
  return out;
}

function gradientDefinition(
  id: string,
  gradient: FillGradient,
  box: Box,
): string {
  const stops = gradient.stops
    .map((stop) =>
      tag("stop", {
        offset: stop.offset,
        "stop-color": stop.color,
        "stop-opacity": stop.opacity ?? 1,
      }),
    )
    .join("");
  if (gradient.type === "linear") {
    const vector = linearGradientVector(gradient.angle, box.width, box.height);
    return wrap(
      "linearGradient",
      {
        id,
        gradientUnits: "userSpaceOnUse",
        x1: box.x + vector.x1 * box.width,
        y1: box.y + vector.y1 * box.height,
        x2: box.x + vector.x2 * box.width,
        y2: box.y + vector.y2 * box.height,
      },
      stops,
    );
  }
  if (gradient.type === "angular" || gradient.type === "diamond") {
    const outside = sampleGradient(gradient.stops, 1);
    const background =
      gradient.type === "diamond"
        ? tag("rect", {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            fill: outside.color,
            "fill-opacity": outside.opacity,
          })
        : "";
    const patches =
      gradient.type === "angular"
        ? angularGradientPatches(gradient, box.width, box.height, box.x, box.y)
        : diamondGradientPatches(gradient, box.width, box.height, box.x, box.y);
    return wrap(
      "pattern",
      {
        id,
        patternUnits: "userSpaceOnUse",
        x: box.x,
        y: box.y,
        width: Math.abs(box.width) || 1,
        height: Math.abs(box.height) || 1,
      },
      `${background}${patches
        .map((patch) =>
          tag("polygon", {
            points: patch.points,
            fill: patch.color,
            "fill-opacity": patch.opacity,
          }),
        )
        .join("")}`,
    );
  }
  const width = Math.abs(box.width);
  const height = Math.abs(box.height);
  const base = width || height || 1;
  const cx = box.x + gradient.centerX * box.width;
  const cy = box.y + gradient.centerY * box.height;
  const scaleX = width ? 1 : 1 / base;
  const scaleY = height ? height / base : 1 / base;
  return wrap(
    "radialGradient",
    {
      id,
      gradientUnits: "userSpaceOnUse",
      cx,
      cy,
      r: gradient.radius * base,
      gradientTransform: `translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(scaleX)} ${fmt(scaleY)}) translate(${fmt(-cx)} ${fmt(-cy)})`,
    },
    stops,
  );
}

function effectPrimitives(effects: readonly LayerEffect[]): string {
  const enabled = effects.filter((effect) => effect.enabled !== false);
  const backdrop = enabled.filter(
    (effect) => effect.type === "background-blur",
  );
  const content = enabled.filter((effect) => effect.type !== "background-blur");
  const primitives: string[] = [];
  let backdropInput = "BackgroundImage";
  for (const [index, effect] of backdrop.entries()) {
    const result = `diagra-backdrop-${index}`;
    primitives.push(
      tag("feGaussianBlur", {
        in: backdropInput,
        stdDeviation: effect.blur,
        result,
      }),
    );
    backdropInput = result;
  }
  if (backdrop.length) {
    primitives.push(
      tag("feComposite", {
        in: backdropInput,
        in2: "SourceAlpha",
        operator: "in",
        result: "diagra-backdrop-clipped",
      }),
    );
  }
  let contentInput = "SourceGraphic";
  for (const [index, effect] of content.entries()) {
    const result = `diagra-content-${index}`;
    primitives.push(
      effect.type === "drop-shadow"
        ? tag("feDropShadow", {
            in: contentInput,
            dx: effect.x,
            dy: effect.y,
            stdDeviation: effect.blur,
            "flood-color": effect.color,
            "flood-opacity": effect.opacity,
            result,
          })
        : tag("feGaussianBlur", {
            in: contentInput,
            stdDeviation: effect.blur,
            result,
          }),
    );
    contentInput = result;
  }
  if (backdrop.length) {
    primitives.push(
      wrap(
        "feMerge",
        {},
        tag("feMergeNode", { in: "diagra-backdrop-clipped" }) +
          tag("feMergeNode", { in: contentInput }),
      ),
    );
  }
  return primitives.join("");
}

function textStyled(base: Attrs, visual: Visual): Attrs {
  const style = visual.style;
  if (!style) {
    return base;
  }
  const out: Attrs = { ...base };
  if (style.fontFamily !== undefined) out["font-family"] = style.fontFamily;
  if (style.fontWeight !== undefined) out["font-weight"] = style.fontWeight;
  if (style.fontStyle !== undefined) out["font-style"] = style.fontStyle;
  if (fontVariationCss(style) !== undefined)
    out["font-variation-settings"] = fontVariationCss(style);
  if (fontFeatureCss(style) !== undefined)
    out["font-feature-settings"] = fontFeatureCss(style);
  if (style.textDecoration !== undefined)
    out["text-decoration"] = style.textDecoration;
  if (style.letterSpacing !== undefined)
    out["letter-spacing"] = style.letterSpacing;
  if (style.color !== undefined) {
    out["fill"] = style.color;
  }
  if (style.fontSize !== undefined) {
    out["font-size"] = style.fontSize;
  }
  return out;
}

function readField(source: unknown, field: string): unknown {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  return (source as Record<string, unknown>)[field];
}

function readString(source: unknown, field: string): string {
  const value = readField(source, field);
  return typeof value === "string" ? value : "";
}

function readList(source: unknown, field: string): readonly unknown[] {
  const value = readField(source, field);
  return Array.isArray(value) ? value : [];
}

/** A label centred in `box`, honouring the element's text styling. */
function centredLabel(
  box: Box,
  label: string,
  visual: Visual,
  theme: SvgTheme,
): string {
  if (label === "") {
    return "";
  }
  const anchor = visual.style?.textAlign ?? "middle";
  const x =
    anchor === "start"
      ? box.x + TEXT_PADDING
      : anchor === "end"
        ? box.x + box.width - TEXT_PADDING
        : box.x + box.width / 2;
  return text(
    textStyled(
      {
        x,
        y: box.y + box.height / 2,
        "text-anchor": anchor,
        "dominant-baseline": "central",
        fill: theme.ink,
        "font-size": theme.fontSize,
      },
      visual,
    ),
    label,
  );
}

function markerDefs(theme: SvgTheme): string {
  const filled: Attrs = { fill: theme.ink, stroke: "none" };
  const hollow: Attrs = {
    fill: theme.surface,
    stroke: theme.ink,
    "stroke-width": 1.2,
  };
  const marker = (
    id: string,
    viewBox: string,
    refX: number,
    refY: number,
    size: readonly [number, number],
    body: string,
  ): string =>
    wrap(
      "marker",
      {
        id,
        viewBox,
        refX,
        refY,
        markerWidth: size[0],
        markerHeight: size[1],
        markerUnits: "userSpaceOnUse",
        orient: "auto-start-reverse",
      },
      body,
    );
  return wrap(
    "defs",
    {},
    [
      marker(
        MARKER_IDS.arrow,
        "0 0 10 10",
        9,
        5,
        [8, 8],
        tag("path", { d: "M 0 1 L 10 5 L 0 9 z", ...filled }),
      ),
      marker(
        MARKER_IDS.triangle,
        "0 0 12 12",
        11,
        6,
        [14, 14],
        tag("path", { d: "M 0 0 L 12 6 L 0 12 z", ...hollow }),
      ),
      marker(
        MARKER_IDS.diamondOpen,
        "0 0 16 10",
        1,
        5,
        [16, 10],
        tag("path", { d: "M 0 5 L 8 0 L 16 5 L 8 10 z", ...hollow }),
      ),
      marker(
        MARKER_IDS.diamondFilled,
        "0 0 16 10",
        1,
        5,
        [16, 10],
        tag("path", { d: "M 0 5 L 8 0 L 16 5 L 8 10 z", ...filled }),
      ),
      marker(
        MARKER_IDS.dot,
        "0 0 8 8",
        4,
        4,
        [7, 7],
        tag("circle", { cx: 4, cy: 4, r: 3, ...filled }),
      ),
    ].join(""),
  );
}

function markerUrl(kind: MarkerKind | null): string | undefined {
  return kind === null ? undefined : `url(#${MARKER_IDS[kind]})`;
}

function renderGeo(element: Element, box: Box, theme: SvgTheme): string {
  const outline = geoOutline(
    readString(element.semantic, "geo") || "rect",
    box.width,
    box.height,
  );
  const shape = styled(
    { fill: theme.surface, stroke: theme.ink, "stroke-width": STROKE_WIDTH },
    element.visual,
    element.id,
  );
  let body: string;
  switch (outline.kind) {
    case "ellipse":
      body = tag("ellipse", {
        cx: outline.cx,
        cy: outline.cy,
        rx: outline.rx,
        ry: outline.ry,
        ...shape,
      });
      break;
    case "polygon":
      body = tag("polygon", { points: outline.points, ...shape });
      break;
    case "cylinder":
      body =
        tag("path", { d: outline.path, ...shape }) +
        tag("ellipse", {
          cx: outline.cap.cx,
          cy: outline.cap.cy,
          rx: outline.cap.rx,
          ry: outline.cap.ry,
          ...shape,
        });
      break;
    default:
      body = element.visual.style?.cornerRadii
        ? tag("path", {
            d: roundedRectPath(
              {
                x: outline.x,
                y: outline.y,
                width: outline.width,
                height: outline.height,
              },
              resolvedCornerRadii(element.visual.style),
            ),
            ...shape,
          })
        : tag("rect", {
            x: outline.x,
            y: outline.y,
            width: outline.width,
            height: outline.height,
            rx: element.visual.style?.cornerRadius ?? outline.rx,
            ...shape,
          });
      break;
  }
  return (
    wrap("g", { transform: `translate(${fmt(box.x)} ${fmt(box.y)})` }, body) +
    centredLabel(
      box,
      readString(element.semantic, "label"),
      element.visual,
      theme,
    )
  );
}

function renderNode(element: Element, box: Box, theme: SvgTheme): string {
  return (
    tag(
      element.visual.style?.cornerRadii ? "path" : "rect",
      styled(
        element.visual.style?.cornerRadii
          ? {
              d: roundedRectPath(
                box,
                resolvedCornerRadii(element.visual.style, 8),
              ),
              fill: theme.surface,
              stroke: theme.ink,
              "stroke-width": STROKE_WIDTH,
            }
          : {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              rx: element.visual.style?.cornerRadius ?? 8,
              fill: theme.surface,
              stroke: theme.ink,
              "stroke-width": STROKE_WIDTH,
            },
        element.visual,
        element.id,
      ),
    ) +
    centredLabel(
      box,
      readString(element.semantic, "label"),
      element.visual,
      theme,
    )
  );
}

function renderSequenceParticipant(
  element: Element,
  box: Box,
  theme: SvgTheme,
): string {
  const head = { x: box.x, y: box.y, width: box.width, height: 56 };
  return (
    tag("line", {
      x1: box.x + box.width / 2,
      y1: box.y + head.height,
      x2: box.x + box.width / 2,
      y2: box.y + box.height,
      stroke: theme.muted,
      "stroke-width": 1,
      "stroke-dasharray": "5 4",
    }) +
    tag(
      "rect",
      styled(
        {
          ...head,
          rx: 8,
          fill: theme.surface,
          stroke: theme.ink,
          "stroke-width": STROKE_WIDTH,
        },
        element.visual,
        element.id,
      ),
    ) +
    centredLabel(
      head,
      readString(element.semantic, "name"),
      element.visual,
      theme,
    )
  );
}

function renderSequenceActivation(
  element: Element,
  box: Box,
  theme: SvgTheme,
): string {
  return tag(
    "rect",
    styled(
      {
        ...box,
        fill: theme.surface,
        stroke: theme.ink,
        "stroke-width": 1,
      },
      element.visual,
      element.id,
    ),
  );
}

function renderErdTable(element: Element, box: Box, theme: SvgTheme): string {
  const columns = readList(element.semantic, "columns");
  const parts: string[] = [
    tag(
      "rect",
      styled(
        {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          rx: 6,
          fill: theme.surface,
          stroke: theme.ink,
          "stroke-width": STROKE_WIDTH,
        },
        element.visual,
        element.id,
      ),
    ),
    tag("rect", {
      x: box.x,
      y: box.y,
      width: box.width,
      height: ERD_TABLE_HEADER_HEIGHT,
      fill: theme.accentSoft,
    }),
    tag("line", {
      x1: box.x,
      y1: box.y + ERD_TABLE_HEADER_HEIGHT,
      x2: box.x + box.width,
      y2: box.y + ERD_TABLE_HEADER_HEIGHT,
      stroke: theme.ink,
      "stroke-width": STROKE_WIDTH,
    }),
    text(
      {
        x: box.x + ROW_PADDING,
        y: box.y + ERD_TABLE_HEADER_HEIGHT / 2,
        "dominant-baseline": "central",
        fill: theme.ink,
        "font-size": theme.fontSize,
        "font-weight": 700,
      },
      readString(element.semantic, "tableName"),
    ),
  ];
  for (const [at, column] of columns.entries()) {
    const middle =
      box.y +
      ERD_TABLE_HEADER_HEIGHT +
      at * ERD_TABLE_ROW_HEIGHT +
      ERD_TABLE_ROW_HEIGHT / 2;
    const key = erdColumnKey(
      element.semantic as Partial<ErdTableSemantic>,
      column as Partial<ErdColumn>,
    );
    if (key) {
      parts.push(
        text(
          {
            x: box.x + ROW_PADDING,
            y: middle,
            "dominant-baseline": "central",
            fill: theme.accent,
            "font-size": 10,
            "font-weight": 700,
          },
          key,
        ),
      );
    }
    parts.push(
      text(
        {
          x: box.x + ERD_NAME_OFFSET,
          y: middle,
          "dominant-baseline": "central",
          fill: theme.ink,
          "font-size": 12,
        },
        readString(column, "name"),
      ),
      text(
        {
          x: box.x + box.width - ROW_PADDING,
          y: middle,
          "text-anchor": "end",
          "dominant-baseline": "central",
          fill: theme.muted,
          "font-size": 12,
        },
        readString(column, "dataType") +
          (readField(column, "nullable") === true ? "?" : ""),
      ),
    );
  }
  return parts.join("");
}

function umlVisibility(member: unknown): string {
  const value = readString(member, "visibility");
  return value === "" ? "+" : value;
}

function umlAttributeText(attribute: unknown): string {
  const type = readString(attribute, "type");
  return `${umlVisibility(attribute)} ${readString(attribute, "name")}${
    type === "" ? "" : `: ${type}`
  }`;
}

function umlMethodText(method: unknown): string {
  const parameters = readList(method, "parameters")
    .map((parameter) => {
      const type = readString(parameter, "type");
      const name = readString(parameter, "name");
      return type === "" ? name : `${name}: ${type}`;
    })
    .join(", ");
  const returns = readString(method, "returnType");
  return `${umlVisibility(method)} ${readString(method, "name")}(${parameters})${
    returns === "" ? "" : `: ${returns}`
  }`;
}

function renderUmlClass(element: Element, box: Box, theme: SvgTheme): string {
  const semantic = element.semantic;
  const nameHeight = umlNameHeight(semantic);
  const attributesHeight = umlAttributesHeight(semantic);
  const stereotype = readString(semantic, "stereotype");
  const parts: string[] = [
    tag(
      "rect",
      styled(
        {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          fill: theme.surface,
          stroke: theme.ink,
          "stroke-width": STROKE_WIDTH,
        },
        element.visual,
        element.id,
      ),
    ),
    tag("line", {
      x1: box.x,
      y1: box.y + nameHeight,
      x2: box.x + box.width,
      y2: box.y + nameHeight,
      stroke: theme.ink,
      "stroke-width": STROKE_WIDTH,
    }),
    tag("line", {
      x1: box.x,
      y1: box.y + nameHeight + attributesHeight,
      x2: box.x + box.width,
      y2: box.y + nameHeight + attributesHeight,
      stroke: theme.line,
      "stroke-width": 1,
    }),
  ];
  if (stereotype !== "") {
    parts.push(
      text(
        {
          x: box.x + box.width / 2,
          y: box.y + UML_CLASS_STEREOTYPE_HEIGHT / 2,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          fill: theme.muted,
          "font-size": 10,
        },
        `«${stereotype}»`,
      ),
    );
  }
  // The stereotype line sits above the name; what is left of the band is
  // always one `UML_CLASS_NAME_HEIGHT` row, whether or not it is there.
  parts.push(
    text(
      {
        x: box.x + box.width / 2,
        y:
          box.y +
          (nameHeight - UML_CLASS_NAME_HEIGHT) +
          UML_CLASS_NAME_HEIGHT / 2,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        fill: theme.ink,
        "font-size": theme.fontSize,
        "font-weight": 700,
      },
      readString(semantic, "name"),
    ),
  );

  const row = (
    top: number,
    at: number,
    content: string,
    member: unknown,
  ): string =>
    text(
      {
        x: box.x + TEXT_PADDING,
        y: top + at * UML_CLASS_ROW_HEIGHT + UML_CLASS_ROW_HEIGHT / 2,
        "dominant-baseline": "central",
        fill: theme.ink,
        "font-size": 12,
        "text-decoration":
          readField(member, "static") === true ? "underline" : undefined,
        "font-style":
          readField(member, "abstract") === true ? "italic" : undefined,
      },
      content,
    );

  for (const [at, attribute] of readList(semantic, "attributes").entries()) {
    parts.push(
      row(box.y + nameHeight, at, umlAttributeText(attribute), attribute),
    );
  }
  for (const [at, method] of readList(semantic, "methods").entries()) {
    parts.push(
      row(
        box.y + nameHeight + attributesHeight,
        at,
        umlMethodText(method),
        method,
      ),
    );
  }
  return parts.join("");
}

/** Line height as a multiple of the font size, matching the stylesheet. */
const LINE_HEIGHT = TEXT_NOTE_LINE_HEIGHT;
/** Vertical inset of a text note's first line, matching the note view. */
const NOTE_PADDING_Y = TEXT_NOTE_PADDING_Y;

/**
 * A text note: optional fill, then the wrapped lines from the top of the
 * box, clipped to the lines that fit entirely, the way the canvas clips.
 */
function renderTextNote(element: Element, box: Box, theme: SvgTheme): string {
  const style = element.visual.style;
  const parts: string[] = [];
  if (style?.fill !== undefined || style?.fillGradient !== undefined) {
    parts.push(
      tag(
        "rect",
        styled(
          {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            fill: style.fill,
            stroke: "none",
          },
          element.visual,
          element.id,
        ),
      ),
    );
  }
  const fontSize = style?.fontSize ?? theme.fontSize;
  const lineHeight = fontSize * (style?.lineHeight ?? LINE_HEIGHT);
  const anchor = style?.textAlign ?? "start";
  const x =
    anchor === "start"
      ? box.x + TEXT_PADDING
      : anchor === "end"
        ? box.x + box.width - TEXT_PADDING
        : box.x + box.width / 2;
  const lines = wrapTextLines(
    textNoteText(element.semantic),
    Math.max(1, box.width - TEXT_PADDING * 2),
    fontSize,
    style?.letterSpacing ?? 0,
  );
  const freeHeight = Math.max(
    0,
    box.height - NOTE_PADDING_Y * 2 - lines.length * lineHeight,
  );
  const verticalOffset =
    style?.verticalAlign === "bottom"
      ? freeHeight
      : style?.verticalAlign === "middle"
        ? freeHeight / 2
        : 0;
  const source = textNoteText(element.semantic);
  const richSegments = richTextSegments(element.semantic);
  const hasRichText = richSegments.some((segment) => segment.marks.length > 0);
  let sourceCursor = 0;
  const markedLine = (line: string, start: number): string => {
    const end = start + line.length;
    const content = richSegments
      .filter((segment) => segment.end > start && segment.start < end)
      .map((segment) => {
        const value = source.slice(
          Math.max(start, segment.start),
          Math.min(end, segment.end),
        );
        const kinds = new Set(segment.marks.map((mark) => mark.kind));
        const attrs: Attrs = {
          ...(kinds.has("bold") ? { "font-weight": 700 } : {}),
          ...(kinds.has("italic") ? { "font-style": "italic" } : {}),
          ...(kinds.has("code")
            ? {
                "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
              }
            : {}),
          ...(kinds.has("strike") || kinds.has("underline") || kinds.has("link")
            ? {
                "text-decoration":
                  `${kinds.has("link") || kinds.has("underline") ? "underline" : ""}${kinds.has("strike") ? " line-through" : ""}`.trim(),
              }
            : {}),
          ...(kinds.has("link") ? { fill: theme.accent } : {}),
        };
        const span = wrap("tspan", attrs, escapeXml(value));
        const link = segment.marks.find(
          (mark): mark is TextMark & { readonly href: string } =>
            mark.kind === "link" &&
            typeof mark.href === "string" &&
            safeTextLinkHref(mark.href) !== null,
        );
        return link
          ? wrap(
              "a",
              {
                href: safeTextLinkHref(link.href) ?? undefined,
                rel: "noopener noreferrer",
              },
              span,
            )
          : span;
      })
      .join("");
    return hasRichText && content ? content : escapeXml(line);
  };
  for (const [at, line] of lines.entries()) {
    const top = box.y + NOTE_PADDING_Y + verticalOffset + at * lineHeight;
    if (top + lineHeight > box.y + box.height + 0.01) {
      break;
    }
    const found = source.indexOf(line, sourceCursor);
    const lineStart = found >= 0 ? found : sourceCursor;
    sourceCursor = lineStart + line.length;
    if (line === "") {
      continue;
    }
    parts.push(
      wrap(
        "text",
        textStyled(
          {
            x,
            y: top + lineHeight / 2,
            "xml:space": "preserve",
            style: "white-space: pre;",
            "text-anchor": anchor,
            "dominant-baseline": "central",
            fill: theme.ink,
            "font-size": fontSize,
          },
          element.visual,
        ),
        markedLine(line, lineStart),
      ),
    );
  }
  return parts.join("");
}

/**
 * Anything this build does not draw, drawn anyway: a dashed placeholder at
 * the element's own bounds, so an export of a newer document shows that
 * something is there rather than silently losing it.
 */
function renderUnsupported(
  element: Element,
  box: Box,
  theme: SvgTheme,
): string {
  return (
    tag("rect", {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rx: 4,
      fill: "none",
      stroke: theme.muted,
      "stroke-width": 1,
      "stroke-dasharray": DASH_PATTERNS["dashed"] as string,
    }) +
    text(
      {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        fill: theme.muted,
        "font-size": 11,
      },
      `unsupported: ${element.type}`,
    )
  );
}

function renderShape(element: Element, box: Box, theme: SvgTheme): string {
  switch (element.type) {
    case "draw.path": {
      const geometry = compoundPathGeometry(element);
      if (!geometry) return "";
      return tag(
        "path",
        styled(
          {
            d: geometry.path,
            transform: `translate(${fmt(box.x)} ${fmt(box.y)})`,
            fill: theme.ink,
            stroke: "none",
            "fill-rule": (element.semantic as PathSemantic).fillRule,
          },
          element.visual,
          element.id,
        ),
      );
    }
    case "draw.freehand": {
      const geometry = freehandGeometry(element);
      if (!geometry) return "";
      if (geometry.pressureOutline) {
        const style = element.visual.style;
        const hasFill =
          (element.semantic as { closed?: boolean }).closed === true &&
          Boolean(
            style?.fillGradient ||
              (style?.fill &&
                style.fill !== "none" &&
                style.fill !== "transparent"),
          );
        const paths: string[] = [];
        if (hasFill) {
          const fill = styled(
            { d: geometry.path, stroke: "none" },
            element.visual,
            element.id,
          );
          fill["stroke"] = "none";
          fill["stroke-width"] = undefined;
          fill["stroke-dasharray"] = undefined;
          fill["stroke-linecap"] = undefined;
          fill["stroke-linejoin"] = undefined;
          fill["stroke-miterlimit"] = undefined;
          fill["opacity"] = undefined;
          paths.push(tag("path", fill));
        }
        const outline = styled(
          { d: geometry.pressureOutline.path, fill: "none", stroke: theme.ink },
          element.visual,
          element.id,
        );
        outline["fill"] = outline["stroke"] ?? theme.ink;
        outline["fill-rule"] = "evenodd";
        outline["stroke"] = "none";
        outline["stroke-width"] = undefined;
        outline["stroke-dasharray"] = undefined;
        outline["stroke-linecap"] = undefined;
        outline["stroke-linejoin"] = undefined;
        outline["stroke-miterlimit"] = undefined;
        outline["opacity"] = undefined;
        paths.push(tag("path", outline));
        return wrap(
          "g",
          {
            transform: `translate(${fmt(box.x)} ${fmt(box.y)})`,
            opacity: style?.opacity,
          },
          paths.join(""),
        );
      }
      return tag(
        "path",
        styled(
          {
            d: geometry.path,
            transform: `translate(${fmt(box.x)} ${fmt(box.y)})`,
            fill: "none",
            stroke: theme.ink,
            "stroke-width": 2,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
          },
          element.visual,
          element.id,
        ),
      );
    }
    case "image.raster": {
      const semantic = element.semantic as ImageSemantic;
      const imageBox = semantic.crop
        ? croppedImageBox(semantic.crop, {
            x: 0,
            y: 0,
            width: box.width,
            height: box.height,
          })
        : box;
      const image = tag("image", {
        ...imageBox,
        href: semantic.src,
        "aria-label": semantic.alt,
        opacity: element.visual.style?.opacity ?? 1,
        preserveAspectRatio: semantic.crop
          ? "none"
          : semantic.fit === "fill"
            ? "none"
            : semantic.fit === "cover"
              ? "xMidYMid slice"
              : "xMidYMid meet",
      });
      const painted = semantic.crop
        ? wrap("svg", { ...box, overflow: "hidden" }, image)
        : image;
      if (
        !element.visual.style?.cornerRadii &&
        !element.visual.style?.cornerRadius
      )
        return painted;
      const clipId = `${gradientId(element.id)}-corners`;
      return (
        wrap(
          "defs",
          {},
          wrap(
            "clipPath",
            { id: clipId, clipPathUnits: "userSpaceOnUse" },
            tag("path", {
              d: roundedRectPath(
                box,
                resolvedCornerRadii(element.visual.style),
              ),
            }),
          ),
        ) + wrap("g", { "clip-path": `url(#${clipId})` }, painted)
      );
    }
    case "frame":
      return (
        tag(
          element.visual.style?.cornerRadii ? "path" : "rect",
          styled(
            element.visual.style?.cornerRadii
              ? {
                  d: roundedRectPath(
                    box,
                    resolvedCornerRadii(element.visual.style),
                  ),
                  fill: "#ffffff",
                  stroke: "#cbd5e1",
                  "stroke-width": 1,
                }
              : {
                  ...box,
                  rx: element.visual.style?.cornerRadius ?? 0,
                  fill: "#ffffff",
                  stroke: "#cbd5e1",
                  "stroke-width": 1,
                },
            element.visual,
            element.id,
          ),
        ) +
        ((element.semantic as { showTitle?: boolean }).showTitle === false
          ? ""
          : text(
              textStyled(
                {
                  x: box.x + 8,
                  y: box.y + 16,
                  fill: theme.ink,
                  "font-size": 12,
                },
                element.visual,
              ),
              readString(element.semantic, "name"),
            ))
      );
    case "shape.geo":
      return renderGeo(element, box, theme);
    case "node.generic":
      return renderNode(element, box, theme);
    case "sequence.participant":
      return renderSequenceParticipant(element, box, theme);
    case "sequence.activation":
      return renderSequenceActivation(element, box, theme);
    case "erd.table":
      return renderErdTable(element, box, theme);
    case "uml.class":
      return renderUmlClass(element, box, theme);
    case "text.note":
      return renderTextNote(element, box, theme);
    default:
      return renderUnsupported(element, box, theme);
  }
}

function renderConnector(
  element: Element,
  context: ShapeContext,
  theme: SvgTheme,
): string | null {
  const resolved = resolveConnector(
    element,
    context,
    endpointReaderFor(element.type),
  );
  if (!resolved) {
    return null;
  }
  const decoration = connectorDecoration(element);
  const common = {
    fill: "none",
    stroke: theme.ink,
    "stroke-width": STROKE_WIDTH,
    "marker-start": markerUrl(decoration.start),
    "marker-end": markerUrl(decoration.end),
    "stroke-dasharray": connectorDefaultDash(element),
  };
  const line =
    resolved.points.length > 2
      ? tag("polyline", {
          ...styled(
            {
              points: resolved.points
                .map((point) => `${fmt(point.x)},${fmt(point.y)}`)
                .join(" "),
              ...common,
            },
            element.visual,
            element.id,
          ),
          fill: "none",
        })
      : tag(
          "line",
          styled(
            {
              x1: resolved.start.x,
              y1: resolved.start.y,
              x2: resolved.end.x,
              y2: resolved.end.y,
              ...common,
            },
            element.visual,
            element.id,
          ),
        );
  if (decoration.label === "") {
    return line;
  }
  return (
    line +
    text(
      textStyled(
        {
          x: resolved.labelPoint.x,
          y: resolved.labelPoint.y - 6,
          "text-anchor": "middle",
          fill: theme.muted,
          "font-size": 11,
        },
        element.visual,
      ),
      decoration.label,
    )
  );
}

function elementGroup(
  element: Element,
  box: Box | null,
  body: string,
  filter?: string,
): string {
  const rotation = isEdge(element.type) ? 0 : element.visual.rotation;
  const transform =
    rotation === undefined || rotation === 0 || box === null
      ? undefined
      : `rotate(${fmt(rotation)} ${fmt(box.x + box.width / 2)} ${fmt(
          box.y + box.height / 2,
        )})`;
  return wrap(
    "g",
    {
      "data-id": element.id,
      "data-type": element.type,
      transform,
      filter,
      style: element.visual.style?.blendMode
        ? `mix-blend-mode: ${element.visual.style.blendMode};`
        : undefined,
    },
    body,
  );
}

function isEdge(type: string): boolean {
  return getElementTypeDefinition(type)?.category === "edge";
}

/**
 * Render `elements` (bottom to top) as a standalone SVG document, or `null`
 * when none of them contributed any geometry.
 *
 * Connectors go in their own layer first so a line never covers the shape it
 * points at, exactly like the canvas stacks its layers.
 */
export function renderElementsSvg(
  elements: readonly Element[],
  registry: ShapeUtilRegistry,
  context: ShapeContext,
  options: SvgExportOptions = {},
): string | null {
  const theme: SvgTheme = { ...DEFAULT_SVG_THEME, ...(options.theme ?? {}) };
  const padding = options.padding ?? DEFAULT_PADDING;
  const background = options.background ?? null;

  const rendered = new Map<ElementId, string>();
  const renderedKinds = new Map<ElementId, "connector" | "shape">();
  const groups = new Map<ElementId, Element>();
  const boxes: Box[] = [];
  const clips: string[] = [];
  const effects: string[] = [];
  const gradients: string[] = [];
  const booleanMasks: string[] = [];
  for (const element of elements) {
    if (
      element.visual.hidden ||
      context.isHidden?.(element.id) ||
      context.isMaskSource?.(element.id)
    )
      continue;
    if (element.type === "group") {
      groups.set(element.id, element);
      continue;
    }
    const box = registry
      .getOrFallback(element.type)
      .getBounds(element, context);
    const clip = context.clipOf?.(element.id);
    const clipPolygon = context.clipPolygonOf?.(element.id);
    if (box && element.visual.style?.fillGradient)
      gradients.push(
        gradientDefinition(
          gradientId(element.id),
          element.visual.style.fillGradient,
          box,
        ),
      );
    if (box && element.visual.style?.strokeGradient)
      gradients.push(
        gradientDefinition(
          strokeGradientId(element.id),
          element.visual.style.strokeGradient,
          box,
        ),
      );
    const elementEffects = layerEffects(element.visual.style);
    const drawingBox =
      element.type === "draw.freehand" && !element.visual.rotation
        ? (freehandGeometry(element)?.curveBounds ?? box)
        : box;
    const expanded = drawingBox
      ? effectsBounds(
          {
            ...drawingBox,
            width: Math.max(1, drawingBox.width),
            height: Math.max(1, drawingBox.height),
          },
          element.visual.style,
        )
      : null;
    // Filters use the element's unrotated user space. Only the resulting
    // envelope rotates into page space, around the original element center
    // (not the expanded shadow's center), before ancestor clipping.
    const pageBounds =
      expanded && box && !isEdge(element.type)
        ? rotatedBox(expanded, element.visual.rotation ?? 0, boxCenter(box))
        : expanded;
    const visible =
      clip && pageBounds ? intersectClip(pageBounds, clip) : pageBounds;
    if (clip && (!visible || visible.width <= 0 || visible.height <= 0))
      continue;
    let filter: string | undefined;
    if (elementEffects.some((effect) => effect.enabled !== false) && expanded) {
      const id = `diagra-shadow-${effects.length}`;
      filter = `url(#${id})`;
      effects.push(
        wrap(
          "filter",
          {
            id,
            filterUnits: "userSpaceOnUse",
            ...expanded,
            "color-interpolation-filters": "sRGB",
          },
          effectPrimitives(elementEffects),
        ),
      );
    }
    const clipped = (body: string): string => {
      if (!clip) return body;
      const id = `diagra-clip-${clips.length}`;
      clips.push(
        wrap(
          "clipPath",
          { id, clipPathUnits: "userSpaceOnUse" },
          clipPolygon && clipPolygon.length >= 3
            ? tag("polygon", {
                points: clipPolygon
                  .map((point) => `${point.x},${point.y}`)
                  .join(" "),
              })
            : tag("rect", { ...clip }),
        ),
      );
      return wrap("g", { "clip-path": `url(#${id})` }, body);
    };
    if (isEdge(element.type)) {
      const body = renderConnector(element, context, theme);
      if (body === null) {
        continue;
      }
      rendered.set(
        element.id,
        clipped(elementGroup(element, box, body, filter)),
      );
      renderedKinds.set(element.id, "connector");
    } else {
      if (box === null) {
        continue;
      }
      rendered.set(
        element.id,
        clipped(
          elementGroup(element, box, renderShape(element, box, theme), filter),
        ),
      );
      renderedKinds.set(element.id, "shape");
    }
    if (visible !== null) {
      boxes.push(visible);
    }
  }

  const bounds = options.viewport ?? unionBoxes(boxes);
  if (bounds === null) {
    return null;
  }
  if (
    options.viewport &&
    (!Object.values(options.viewport).every(Number.isFinite) ||
      bounds.width <= 0 ||
      bounds.height <= 0)
  )
    return null;
  const groupParents = new Map<ElementId, ElementId>();
  for (const group of groups.values()) {
    for (const member of memberIdsOf(group)) {
      if (
        member !== group.id &&
        (rendered.has(member) || groups.has(member)) &&
        !groupParents.has(member)
      )
        groupParents.set(member, group.id);
    }
  }
  const renderUnit = (
    element: Element,
    ancestors: ReadonlySet<ElementId>,
  ): string => {
    const leaf = rendered.get(element.id);
    if (leaf !== undefined) return leaf;
    if (element.type !== "group" || ancestors.has(element.id)) return "";
    const nextAncestors = new Set(ancestors).add(element.id);
    const body = memberIdsOf(element)
      .map((id) => {
        const child = groups.get(id) ?? elements.find((item) => item.id === id);
        return child ? renderUnit(child, nextAncestors) : "";
      })
      .join("");
    if (!body) return "";
    const semantic = element.semantic as GroupSemantic;
    const boolean = booleanGeometry(element, context);
    const booleanMask = boolean
      ? `diagra-boolean-${booleanMasks.length}`
      : undefined;
    if (boolean && booleanMask)
      booleanMasks.push(booleanMaskDefinition(booleanMask, boolean));
    const styles = [
      element.visual.style?.blendMode
        ? `mix-blend-mode: ${element.visual.style.blendMode};`
        : "",
      semantic.isolate ? "isolation: isolate;" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return wrap(
      "g",
      {
        "data-id": element.id,
        "data-type": "group",
        "data-boolean-operation": boolean?.operation,
        opacity: element.visual.style?.opacity,
        style: styles || undefined,
        mask: booleanMask ? `url(#${booleanMask})` : undefined,
      },
      body,
    );
  };
  const roots = elements.filter(
    (element) =>
      (rendered.has(element.id) || groups.has(element.id)) &&
      !groupParents.has(element.id),
  );
  const connectors = roots
    .filter((element) => renderedKinds.get(element.id) === "connector")
    .map((element) => renderUnit(element, new Set()));
  const shapes = roots
    .filter((element) => renderedKinds.get(element.id) !== "connector")
    .map((element) => renderUnit(element, new Set()));
  const margin = options.viewport ? 0 : padding;
  const x = bounds.x - margin;
  const y = bounds.y - margin;
  const width = bounds.width + margin * 2;
  const height = bounds.height + margin * 2;

  const body = [
    markerDefs(theme),
    gradients.length ? wrap("defs", {}, gradients.join("")) : "",
    clips.length ? wrap("defs", {}, clips.join("")) : "",
    effects.length ? wrap("defs", {}, effects.join("")) : "",
    booleanMasks.length ? wrap("defs", {}, booleanMasks.join("")) : "",
    background === null
      ? ""
      : tag("rect", { x, y, width, height, fill: background }),
    wrap("g", { "data-layer": "connectors" }, connectors.join("")),
    wrap("g", { "data-layer": "shapes" }, shapes.join("")),
  ]
    .filter((part) => part !== "")
    .join("\n");

  return `${wrap(
    "svg",
    {
      xmlns: SVG_NS,
      width,
      height,
      viewBox: `${fmt(x)} ${fmt(y)} ${fmt(width)} ${fmt(height)}`,
      ...(options.viewport ? { overflow: "hidden" } : {}),
      "font-family": theme.fontFamily,
      "font-size": theme.fontSize,
    },
    `\n${body}\n`,
  )}\n`;
}

export function renderPageSvg(
  store: Store,
  registry: ShapeUtilRegistry,
  pageId: PageId,
  options: SvgExportOptions = {},
): string | null {
  return renderElementsSvg(
    store.getPageElements(pageId),
    registry,
    createShapeContext(store, registry, 1),
    options,
  );
}

/**
 * The selected subset of a page, in the page's own z-order, trimmed so a
 * connector whose endpoints were not both selected is left out rather than
 * exported as a line to nowhere.
 */
export function renderSelectionSvg(
  store: Store,
  registry: ShapeUtilRegistry,
  pageId: PageId,
  ids: ReadonlySet<ElementId>,
  options: SvgExportOptions = {},
): string | null {
  const context = createShapeContext(store, registry, 1);
  const expanded = new Set(expandContainers(store, ids, context));
  const picked = store
    .getPageElements(pageId)
    .filter((element) => expanded.has(element.id));
  return renderElementsSvg(selfContained(picked), registry, context, options);
}

/** Exact-size artboard asset, with descendants but without its editor title. */
export function renderArtboardSvg(
  store: Store,
  registry: ShapeUtilRegistry,
  id: ElementId,
  options: SvgExportOptions = {},
): string | null {
  const frame = store.get(id);
  if (!frame || frame.type !== "frame") return null;
  const context = createShapeContext(store, registry, 1);
  if (context.isHidden?.(id)) return null;
  const box = context.boundsOf(id);
  if (!box) return null;
  const viewport = rotatedBox(box, frame.visual.rotation ?? 0);
  const ids = new Set(expandContainers(store, [id], context));
  const elements = selfContained(
    store.getPageElements(frame.page).filter((element) => ids.has(element.id)),
  ).map((element) =>
    element.id === id
      ? {
          ...element,
          semantic: { ...(element.semantic as object), showTitle: false },
        }
      : element,
  );
  return renderElementsSvg(elements, registry, context, {
    ...options,
    viewport,
  });
}
import { freehandGeometry } from "./shapes/freehand.ts";
