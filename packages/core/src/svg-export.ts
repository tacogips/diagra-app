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
  getElementTypeDefinition,
  type PageId,
  type Visual,
} from "@diagra/ir";
import { type Box, unionBoxes } from "./geometry.ts";
import { createShapeContext } from "./hit-test.ts";
import { selfContained } from "./references.ts";
import type { ShapeContext, ShapeUtilRegistry } from "./shape-util.ts";
import {
  connectorDecoration,
  endpointReaderFor,
  type MarkerKind,
  resolveConnector,
} from "./shapes/connector.ts";
import {
  ERD_TABLE_HEADER_HEIGHT,
  ERD_TABLE_ROW_HEIGHT,
} from "./shapes/erdTable.ts";
import { geoOutline } from "./shapes/geo-outline.ts";
import {
  UML_CLASS_NAME_HEIGHT,
  UML_CLASS_ROW_HEIGHT,
  UML_CLASS_STEREOTYPE_HEIGHT,
  umlAttributesHeight,
  umlNameHeight,
} from "./shapes/umlClass.ts";
import type { Store } from "./store.ts";

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
}

const DEFAULT_PADDING = 16;
const SVG_NS = "http://www.w3.org/2000/svg";
const STROKE_WIDTH = 1.5;
/** Horizontal breathing room inside a shape, matching the stylesheet. */
const TEXT_PADDING = 8;
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
function styled(base: Attrs, visual: Visual): Attrs {
  const style = visual.style;
  if (!style) {
    return base;
  }
  const out: Attrs = { ...base };
  if (style.fill !== undefined) {
    out["fill"] = style.fill;
  }
  if (style.stroke !== undefined) {
    out["stroke"] = style.stroke;
  }
  if (style.strokeWidth !== undefined) {
    out["stroke-width"] = style.strokeWidth;
  }
  const dash = style.dash ? DASH_PATTERNS[style.dash] : undefined;
  if (dash) {
    out["stroke-dasharray"] = dash;
  }
  if (style.opacity !== undefined) {
    out["opacity"] = style.opacity;
  }
  return out;
}

function textStyled(base: Attrs, visual: Visual): Attrs {
  const style = visual.style;
  if (!style) {
    return base;
  }
  const out: Attrs = { ...base };
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
      body = tag("rect", {
        x: outline.x,
        y: outline.y,
        width: outline.width,
        height: outline.height,
        rx: outline.rx,
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
      "rect",
      styled(
        {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          rx: 8,
          fill: theme.surface,
          stroke: theme.ink,
          "stroke-width": STROKE_WIDTH,
        },
        element.visual,
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
    if (readField(column, "pk") === true) {
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
          "PK",
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
    case "shape.geo":
      return renderGeo(element, box, theme);
    case "node.generic":
      return renderNode(element, box, theme);
    case "erd.table":
      return renderErdTable(element, box, theme);
    case "uml.class":
      return renderUmlClass(element, box, theme);
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
  const line = tag(
    "line",
    styled(
      {
        x1: resolved.start.x,
        y1: resolved.start.y,
        x2: resolved.end.x,
        y2: resolved.end.y,
        fill: "none",
        stroke: theme.ink,
        "stroke-width": STROKE_WIDTH,
        "marker-start": markerUrl(decoration.start),
        "marker-end": markerUrl(decoration.end),
      },
      element.visual,
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
          x: (resolved.start.x + resolved.end.x) / 2,
          y: (resolved.start.y + resolved.end.y) / 2 - 6,
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

function elementGroup(element: Element, box: Box | null, body: string): string {
  const rotation = element.visual.rotation;
  const transform =
    rotation === undefined || rotation === 0 || box === null
      ? undefined
      : `rotate(${fmt(rotation)} ${fmt(box.x + box.width / 2)} ${fmt(
          box.y + box.height / 2,
        )})`;
  return wrap(
    "g",
    { "data-id": element.id, "data-type": element.type, transform },
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

  const connectors: string[] = [];
  const shapes: string[] = [];
  const boxes: Box[] = [];
  for (const element of elements) {
    const box = registry
      .getOrFallback(element.type)
      .getBounds(element, context);
    if (isEdge(element.type)) {
      const body = renderConnector(element, context, theme);
      if (body === null) {
        continue;
      }
      connectors.push(elementGroup(element, box, body));
    } else {
      if (box === null) {
        continue;
      }
      shapes.push(elementGroup(element, box, renderShape(element, box, theme)));
    }
    if (box !== null) {
      boxes.push(box);
    }
  }

  const bounds = unionBoxes(boxes);
  if (bounds === null) {
    return null;
  }
  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;

  const body = [
    markerDefs(theme),
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
  const picked = store
    .getPageElements(pageId)
    .filter((element) => ids.has(element.id));
  return renderElementsSvg(
    selfContained(picked),
    registry,
    createShapeContext(store, registry, 1),
    options,
  );
}
