import type {
  AccessibilityRole,
  BlendMode,
  Element,
  ElementId,
  FillGradient,
  FrameLayout,
  FrameSemantic,
  GeoShapeSemantic,
  GroupSemantic,
  ImageSemantic,
  PathSemantic,
  VisualStyle,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import type { Box } from "./geometry.ts";
import { linearGradientVector } from "./gradient.ts";
import { resolvedCornerRadii } from "./corner-radii.ts";
import { collectInterfaceTree, type InterfaceTree } from "./interface-tree.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { maskPolygon } from "./clipping.ts";
import { richTextSegments, safeTextLinkHref } from "./rich-text.ts";
import { collectResponsiveFamily } from "./responsive-family.ts";
import { swiftString, kotlinString as quoted } from "./native-string.ts";
import {
  booleanGeometry,
  booleanResultGeometry,
} from "./boolean-operations.ts";
import { compoundPathGeometry } from "./shapes/compound-path.ts";
import { resolvedStrokeDashArray } from "./stroke-dash.ts";

export interface MobileAssetReference {
  readonly elementId: ElementId;
  readonly resourceName: string;
  readonly mediaType: string;
}

export interface MobileInterfaceCode {
  readonly rootId: ElementId;
  readonly swiftUi: string;
  readonly jetpackCompose: string;
  readonly assets: readonly MobileAssetReference[];
  readonly notes: readonly string[];
}

export interface MobileCodeOptions {
  readonly swiftViewName?: string;
  readonly composeFunctionName?: string;
  readonly includeSwiftImports?: boolean;
  readonly includeSwiftSupport?: boolean;
  readonly includeComposeImports?: boolean;
}

export interface AdaptiveMobileBreakpoint {
  readonly rootId: ElementId;
  readonly name: string;
  readonly platform?: FrameSemantic["platform"];
  readonly width: number;
  readonly swiftViewName: string;
  readonly composeFunctionName: string;
}

export interface AdaptiveMobileInterfaceCode {
  readonly sourceRootId: ElementId;
  readonly breakpoints: readonly AdaptiveMobileBreakpoint[];
  readonly swiftUi: string;
  readonly jetpackCompose: string;
  readonly assets: readonly MobileAssetReference[];
  readonly manifest: string;
  readonly notes: readonly string[];
}

function number(value: number): string {
  return String(Number(value.toFixed(4)));
}

function identifier(value: string, fallback: string): string {
  const words = value.match(/[A-Za-z0-9]+/g) ?? [];
  const joined = words
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join("");
  const safe = joined || fallback;
  return /^\d/.test(safe) ? `Design${safe}` : safe;
}

function resourceName(element: Element): string {
  const safe = element.id
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `diagra_${safe || "asset"}`;
}

function hexColor(value: string | undefined, fallback = "#000000"): string {
  return /^#[\da-f]{6}$/i.test(value ?? "") ? (value as string) : fallback;
}

function channels(value: string): readonly [number, number, number] {
  const color = hexColor(value);
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function swiftColor(value: string, opacity = 1): string {
  const [red, green, blue] = channels(value);
  const base = `Color(red: ${number(red / 255)}, green: ${number(green / 255)}, blue: ${number(blue / 255)})`;
  return opacity === 1 ? base : `${base}.opacity(${number(opacity)})`;
}

function composeColor(value: string, opacity = 1): string {
  const [red, green, blue] = channels(value);
  const alpha = Math.round(opacity * 255);
  const argb = [alpha, red, green, blue]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `Color(0x${argb})`;
}

const NATIVE_BLEND_NAMES: Readonly<Record<BlendMode, string>> = {
  normal: "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "colorDodge",
  "color-burn": "colorBurn",
  "hard-light": "hardLight",
  "soft-light": "softLight",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

function nativeBlendName(mode: BlendMode): string {
  return NATIVE_BLEND_NAMES[mode];
}

function swiftStops(gradient: FillGradient): string {
  return gradient.stops
    .map(
      (stop) =>
        `.init(color: ${swiftColor(stop.color, stop.opacity)}, location: ${number(stop.offset)})`,
    )
    .join(", ");
}

function composeStops(gradient: FillGradient): string {
  return gradient.stops
    .map(
      (stop) =>
        `${number(stop.offset)}f to ${composeColor(stop.color, stop.opacity)}`,
    )
    .join(", ");
}

function swiftPaint(
  gradient: FillGradient | undefined,
  fallback: string | undefined,
  box: Box,
): string {
  if (!gradient) return swiftColor(hexColor(fallback, "#ffffff"));
  const stops = `Gradient(stops: [${swiftStops(gradient)}])`;
  if (gradient.type === "linear") {
    const vector = linearGradientVector(gradient.angle, box.width, box.height);
    return `LinearGradient(gradient: ${stops}, startPoint: UnitPoint(x: ${number(vector.x1)}, y: ${number(vector.y1)}), endPoint: UnitPoint(x: ${number(vector.x2)}, y: ${number(vector.y2)}))`;
  }
  if (gradient.type === "radial")
    return `RadialGradient(gradient: ${stops}, center: UnitPoint(x: ${number(gradient.centerX)}, y: ${number(gradient.centerY)}), startRadius: 0, endRadius: ${number(gradient.radius * Math.max(box.width, box.height, 1))})`;
  if (gradient.type === "angular")
    return `AngularGradient(gradient: ${stops}, center: UnitPoint(x: ${number(gradient.centerX)}, y: ${number(gradient.centerY)}), startAngle: .degrees(${number(gradient.angle)}), endAngle: .degrees(${number(gradient.angle + 360)}))`;
  return swiftColor(gradient.stops[0]?.color ?? hexColor(fallback, "#ffffff"));
}

function composePaint(
  gradient: FillGradient | undefined,
  fallback: string | undefined,
  box: Box,
): string {
  if (!gradient) return composeColor(hexColor(fallback, "#ffffff"));
  const stops = `arrayOf(${composeStops(gradient)})`;
  if (gradient.type === "linear") {
    const vector = linearGradientVector(gradient.angle, box.width, box.height);
    return `Brush.linearGradient(colorStops = ${stops}, start = Offset(${number(vector.x1 * box.width)}f, ${number(vector.y1 * box.height)}f), end = Offset(${number(vector.x2 * box.width)}f, ${number(vector.y2 * box.height)}f))`;
  }
  if (gradient.type === "radial")
    return `Brush.radialGradient(colorStops = ${stops}, center = Offset(${number(gradient.centerX * box.width)}f, ${number(gradient.centerY * box.height)}f), radius = ${number(gradient.radius * Math.max(box.width, box.height, 1))}f)`;
  if (gradient.type === "angular")
    return `Brush.sweepGradient(colorStops = ${stops}, center = Offset(${number(gradient.centerX * box.width)}f, ${number(gradient.centerY * box.height)}f))`;
  return composeColor(
    gradient.stops[0]?.color ?? hexColor(fallback, "#ffffff"),
  );
}

function editableText(editor: Editor, element: Element): string {
  return editor.getText(element.id) ?? "";
}

function swiftTextExpression(editor: Editor, element: Element): string {
  const text = editableText(editor, element);
  if (element.type !== "text.note") return `Text(${swiftString(text)})`;
  const segments = richTextSegments(element.semantic);
  if (!segments.some((segment) => segment.marks.length > 0))
    return `Text(${swiftString(text)})`;
  return `(${segments
    .map((segment) => {
      const kinds = new Set(segment.marks.map((mark) => mark.kind));
      return [
        `Text(${swiftString(segment.text)})`,
        ...(kinds.has("bold") ? [".bold()"] : []),
        ...(kinds.has("italic") ? [".italic()"] : []),
        ...(kinds.has("code") ? [".monospaced()"] : []),
        ...(kinds.has("strike") ? [".strikethrough()"] : []),
        ...(kinds.has("underline") && !kinds.has("link")
          ? [".underline()"]
          : []),
        ...(kinds.has("link")
          ? [".foregroundStyle(.blue)", ".underline()"]
          : []),
      ].join("");
    })
    .join(" + ")})`;
}

function composeTextExpression(editor: Editor, element: Element): string {
  const text = editableText(editor, element);
  if (element.type !== "text.note") return quoted(text);
  const segments = richTextSegments(element.semantic);
  if (!segments.some((segment) => segment.marks.length > 0))
    return quoted(text);
  const lines = ["buildAnnotatedString {"];
  for (const segment of segments) {
    const kinds = new Set(segment.marks.map((mark) => mark.kind));
    const styles = [
      ...(kinds.has("bold") ? ["fontWeight = FontWeight.Bold"] : []),
      ...(kinds.has("italic") ? ["fontStyle = FontStyle.Italic"] : []),
      ...(kinds.has("code") ? ["fontFamily = FontFamily.Monospace"] : []),
      ...(kinds.has("strike") || kinds.has("underline") || kinds.has("link")
        ? [
            `textDecoration = ${kinds.has("strike") && (kinds.has("underline") || kinds.has("link")) ? "TextDecoration.combine(listOf(TextDecoration.LineThrough, TextDecoration.Underline))" : kinds.has("strike") ? "TextDecoration.LineThrough" : "TextDecoration.Underline"}`,
          ]
        : []),
      ...(kinds.has("link") ? ["color = Color.Blue"] : []),
    ];
    if (styles.length) {
      lines.push(
        `    withStyle(style = SpanStyle(${styles.join(", ")})) { append(${quoted(segment.text)}) }`,
      );
    } else {
      lines.push(`    append(${quoted(segment.text)})`);
    }
  }
  for (const segment of segments) {
    const link = segment.marks.find(
      (mark) => mark.kind === "link" && safeTextLinkHref(mark.href),
    );
    const href = safeTextLinkHref(link?.href);
    if (href)
      lines.push(
        `    addStringAnnotation(tag = "URL", annotation = ${quoted(href)}, start = ${segment.start}, end = ${segment.end})`,
      );
  }
  lines.push("}");
  return lines.join("\n");
}

function swiftWeight(value: number): string {
  if (value >= 900) return ".black";
  if (value >= 800) return ".heavy";
  if (value >= 700) return ".bold";
  if (value >= 600) return ".semibold";
  if (value >= 500) return ".medium";
  if (value >= 400) return ".regular";
  if (value >= 300) return ".light";
  if (value >= 200) return ".thin";
  return ".ultraLight";
}

function layoutOf(element: Element | null): FrameLayout | undefined {
  return element?.type === "frame"
    ? (element.semantic as FrameSemantic).layout
    : undefined;
}

function normalizedMaskPoints(
  editor: Editor,
  element: Element,
): readonly { readonly x: number; readonly y: number }[] | null {
  if (element.type !== "group") return null;
  const maskId = (element.semantic as GroupSemantic).maskId;
  const box = editor.getBounds(element.id);
  if (!maskId || !box || box.width <= 0 || box.height <= 0) return null;
  const context = editor.createShapeContext();
  const points = maskPolygon(editor.store.get(maskId), context);
  return (
    points?.map((point) => ({
      x: (point.x - box.x) / box.width,
      y: (point.y - box.y) / box.height,
    })) ?? null
  );
}

type RasterMaskPlacement = {
  readonly resource: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly cropX: number;
  readonly cropY: number;
  readonly cropWidth: number;
  readonly cropHeight: number;
  readonly rotation: number;
  readonly luminance: boolean;
};

function rasterMaskPlacement(
  editor: Editor,
  element: Element,
): RasterMaskPlacement | null {
  if (element.type !== "group") return null;
  const semantic = element.semantic as GroupSemantic;
  const source = semantic.maskId
    ? editor.store.get(semantic.maskId)
    : undefined;
  const groupBox = editor.getBounds(element.id);
  const sourceBox = source ? editor.getBounds(source.id) : null;
  if (
    source?.type !== "image.raster" ||
    !groupBox ||
    !sourceBox ||
    groupBox.width <= 0 ||
    groupBox.height <= 0
  )
    return null;
  const crop = (source.semantic as ImageSemantic).crop;
  return {
    resource: resourceName(source),
    x: (sourceBox.x - groupBox.x) / groupBox.width,
    y: (sourceBox.y - groupBox.y) / groupBox.height,
    width: sourceBox.width / groupBox.width,
    height: sourceBox.height / groupBox.height,
    cropX: crop?.x ?? 0,
    cropY: crop?.y ?? 0,
    cropWidth: crop?.width ?? 1,
    cropHeight: crop?.height ?? 1,
    rotation: source.visual.rotation ?? 0,
    luminance: semantic.maskMode === "luminance",
  };
}

function swiftRasterMaskModifier(
  editor: Editor,
  element: Element,
): string | null {
  const mask = rasterMaskPlacement(editor, element);
  if (!mask) return null;
  return `.mask(DiagraRasterMask(asset: ${swiftString(mask.resource)}, x: ${number(mask.x)}, y: ${number(mask.y)}, width: ${number(mask.width)}, height: ${number(mask.height)}, cropX: ${number(mask.cropX)}, cropY: ${number(mask.cropY)}, cropWidth: ${number(mask.cropWidth)}, cropHeight: ${number(mask.cropHeight)}, rotation: ${number(mask.rotation)}, luminance: ${mask.luminance}))`;
}

function composeRasterMaskModifier(
  editor: Editor,
  element: Element,
): string | null {
  const mask = rasterMaskPlacement(editor, element);
  if (!mask) return null;
  return `.diagraRasterMask(resource = R.drawable.${mask.resource}, x = ${number(mask.x)}f, y = ${number(mask.y)}f, width = ${number(mask.width)}f, height = ${number(mask.height)}f, cropX = ${number(mask.cropX)}f, cropY = ${number(mask.cropY)}f, cropWidth = ${number(mask.cropWidth)}f, cropHeight = ${number(mask.cropHeight)}f, rotation = ${number(mask.rotation)}f, luminance = ${mask.luminance})`;
}

function swiftMaskModifier(editor: Editor, element: Element): string | null {
  const raster = swiftRasterMaskModifier(editor, element);
  if (raster) return raster;
  const points = normalizedMaskPoints(editor, element);
  if (!points?.length) return null;
  return `.mask(DiagraPolygon(points: [${points
    .map((point) => `.init(x: ${number(point.x)}, y: ${number(point.y)})`)
    .join(", ")}]))`;
}

function normalizedBooleanPolygons(
  editor: Editor,
  element: Element,
): readonly (readonly { readonly x: number; readonly y: number }[])[] | null {
  const box = editor.getBounds(element.id);
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const geometry = booleanGeometry(element, editor.createShapeContext());
  if (!geometry) return null;
  return booleanResultGeometry(geometry)
    .flat()
    .map((polygon) =>
      polygon.map((point) => ({
        x: (point.x - box.x) / box.width,
        y: (point.y - box.y) / box.height,
      })),
    );
}

function swiftBooleanModifier(editor: Editor, element: Element): string | null {
  const polygons = normalizedBooleanPolygons(editor, element);
  if (!polygons?.length) return null;
  const value = polygons
    .map(
      (polygon) =>
        `[${polygon
          .map((point) => `.init(x: ${number(point.x)}, y: ${number(point.y)})`)
          .join(", ")}]`,
    )
    .join(", ");
  return `.mask(DiagraBooleanMask(polygons: [${value}]))`;
}

function composeMaskModifier(editor: Editor, element: Element): string | null {
  const raster = composeRasterMaskModifier(editor, element);
  if (raster) return raster;
  const points = normalizedMaskPoints(editor, element);
  if (!points?.length) return null;
  const commands = points
    .map((point, index) => {
      const command = index === 0 ? "moveTo" : "lineTo";
      return `${command}(size.width * ${number(point.x)}f, size.height * ${number(point.y)}f)`;
    })
    .join("; ");
  return `.clip(GenericShape { size, _ -> ${commands}; close() })`;
}

function composeBooleanModifier(
  editor: Editor,
  element: Element,
): string | null {
  const polygons = normalizedBooleanPolygons(editor, element);
  if (!polygons?.length) return null;
  const commands = polygons
    .map(
      (polygon) =>
        `${polygon
          .map(
            (point, index) =>
              `${index ? "lineTo" : "moveTo"}(size.width * ${number(point.x)}f, size.height * ${number(point.y)}f)`,
          )
          .join("; ")}; close()`,
    )
    .join("; ");
  return `.clip(GenericShape { size, _ -> fillType = PathFillType.EvenOdd; ${commands} })`;
}

function swiftShapeName(element: Element, style: VisualStyle): string {
  const geo =
    element.type === "shape.geo"
      ? (element.semantic as GeoShapeSemantic).geo
      : "rect";
  const corners = resolvedCornerRadii(style);
  return geo === "ellipse"
    ? "Ellipse()"
    : geo === "diamond"
      ? "DiagraPolygon(points: [.init(x: 0.5, y: 0), .init(x: 1, y: 0.5), .init(x: 0.5, y: 1), .init(x: 0, y: 0.5)])"
      : geo === "triangle"
        ? "DiagraPolygon(points: [.init(x: 0.5, y: 0), .init(x: 1, y: 1), .init(x: 0, y: 1)])"
        : style.cornerRadii
          ? `UnevenRoundedRectangle(topLeadingRadius: ${number(corners.topLeft)}, bottomLeadingRadius: ${number(corners.bottomLeft)}, bottomTrailingRadius: ${number(corners.bottomRight)}, topTrailingRadius: ${number(corners.topRight)})`
          : `RoundedRectangle(cornerRadius: ${number(style.cornerRadius ?? 0)})`;
}

function swiftShape(element: Element, style: VisualStyle, box: Box): string {
  const fill = swiftPaint(style.fillGradient, style.fill, box);
  const shape = swiftShapeName(element, style);
  return `${shape}.fill(${fill})`;
}

function swiftStroke(style: VisualStyle, paint: string): string {
  const width = number(style.strokeWidth ?? 1);
  const dash = resolvedStrokeDashArray(style);
  if (
    style.strokeCap === undefined &&
    style.strokeJoin === undefined &&
    style.strokeMiterLimit === undefined &&
    !dash.length &&
    style.strokeDashOffset === undefined
  )
    return `.stroke(${paint}, lineWidth: ${width})`;
  const arguments_: string[] = [`lineWidth: ${width}`];
  if (style.strokeCap) arguments_.push(`lineCap: .${style.strokeCap}`);
  if (style.strokeJoin) arguments_.push(`lineJoin: .${style.strokeJoin}`);
  if (style.strokeMiterLimit !== undefined)
    arguments_.push(`miterLimit: ${number(style.strokeMiterLimit)}`);
  if (dash.length) arguments_.push(`dash: [${dash.map(number).join(", ")}]`);
  if (style.strokeDashOffset !== undefined)
    arguments_.push(`dashPhase: ${number(style.strokeDashOffset)}`);
  return `.stroke(${paint}, style: StrokeStyle(${arguments_.join(", ")}))`;
}

function composeShape(element: Element, style: VisualStyle): string {
  const geo =
    element.type === "shape.geo"
      ? (element.semantic as GeoShapeSemantic).geo
      : "rect";
  if (geo === "ellipse") return "CircleShape";
  if (geo === "diamond")
    return "GenericShape { size, _ -> moveTo(size.width / 2, 0f); lineTo(size.width, size.height / 2); lineTo(size.width / 2, size.height); lineTo(0f, size.height / 2); close() }";
  if (geo === "triangle")
    return "GenericShape { size, _ -> moveTo(size.width / 2, 0f); lineTo(size.width, size.height); lineTo(0f, size.height); close() }";
  if (style.cornerRadii) {
    const corners = resolvedCornerRadii(style);
    return `RoundedCornerShape(topStart = ${number(corners.topLeft)}.dp, topEnd = ${number(corners.topRight)}.dp, bottomEnd = ${number(corners.bottomRight)}.dp, bottomStart = ${number(corners.bottomLeft)}.dp)`;
  }
  return `RoundedCornerShape(${number(style.cornerRadius ?? 0)}.dp)`;
}

function swiftCompoundPath(element: Element, style: VisualStyle): string {
  const geometry = compoundPathGeometry(element);
  if (!geometry) return "EmptyView()";
  const commands = geometry.contours
    .flatMap((contour) => {
      const first = contour[0];
      if (!first) return [];
      const lines = [
        `path.move(to: CGPoint(x: ${number(first.x)}, y: ${number(first.y)}))`,
      ];
      for (let index = 1; index <= contour.length; index++) {
        const previous = contour[(index - 1) % contour.length];
        const point = contour[index % contour.length];
        if (!previous || !point) continue;
        if (previous.controlOut || point.controlIn) {
          const firstControl = previous.controlOut ?? previous;
          const secondControl = point.controlIn ?? point;
          lines.push(
            `path.addCurve(to: CGPoint(x: ${number(point.x)}, y: ${number(point.y)}), control1: CGPoint(x: ${number(firstControl.x)}, y: ${number(firstControl.y)}), control2: CGPoint(x: ${number(secondControl.x)}, y: ${number(secondControl.y)}))`,
          );
        } else if (index < contour.length)
          lines.push(
            `path.addLine(to: CGPoint(x: ${number(point.x)}, y: ${number(point.y)}))`,
          );
      }
      lines.push("path.closeSubpath()");
      return lines;
    })
    .join("; ");
  const path = `Path { path in ${commands} }`;
  const fill = `${path}.fill(${swiftPaint(style.fillGradient, style.fill, geometry.box)}, style: FillStyle(eoFill: ${(element.semantic as PathSemantic).fillRule === "evenodd"}))`;
  if (!style.stroke && !style.strokeGradient) return fill;
  return `ZStack { ${fill}; ${path}${swiftStroke(
    style,
    swiftPaint(style.strokeGradient, style.stroke, geometry.box),
  )} }`;
}

function composeCompoundPath(element: Element, style: VisualStyle): string {
  const geometry = compoundPathGeometry(element);
  if (!geometry) return "Spacer(modifier = Modifier)";
  const x = (value: number) =>
    `size.width * ${number(value / geometry.box.width)}f`;
  const y = (value: number) =>
    `size.height * ${number(value / geometry.box.height)}f`;
  const commands = geometry.contours
    .flatMap((contour) => {
      const first = contour[0];
      if (!first) return [];
      const lines = [`moveTo(${x(first.x)}, ${y(first.y)})`];
      for (let index = 1; index <= contour.length; index++) {
        const previous = contour[(index - 1) % contour.length];
        const point = contour[index % contour.length];
        if (!previous || !point) continue;
        if (previous.controlOut || point.controlIn) {
          const firstControl = previous.controlOut ?? previous;
          const secondControl = point.controlIn ?? point;
          lines.push(
            `cubicTo(${x(firstControl.x)}, ${y(firstControl.y)}, ${x(secondControl.x)}, ${y(secondControl.y)}, ${x(point.x)}, ${y(point.y)})`,
          );
        } else if (index < contour.length)
          lines.push(`lineTo(${x(point.x)}, ${y(point.y)})`);
      }
      lines.push("close()");
      return lines;
    })
    .join("; ");
  const path = `val path = Path().apply { fillType = PathFillType.${(element.semantic as PathSemantic).fillRule === "evenodd" ? "EvenOdd" : "NonZero"}; ${commands} }`;
  const fillPaint = composePaint(style.fillGradient, style.fill, geometry.box);
  const draws = [
    `drawPath(path, ${style.fillGradient ? `brush = ${fillPaint}` : `color = ${fillPaint}`})`,
  ];
  if (style.stroke || style.strokeGradient) {
    const strokePaint = composePaint(
      style.strokeGradient,
      style.stroke,
      geometry.box,
    );
    const dash = resolvedStrokeDashArray(style);
    const stroke = [
      `width = ${number(style.strokeWidth ?? 1)}.dp.toPx()`,
      ...(dash.length
        ? [
            `pathEffect = PathEffect.dashPathEffect(floatArrayOf(${dash.map((value) => `${number(value)}f`).join(", ")}), ${number(style.strokeDashOffset ?? 0)}f)`,
          ]
        : []),
    ].join(", ");
    draws.push(
      `drawPath(path, ${style.strokeGradient ? `brush = ${strokePaint}` : `color = ${strokePaint}`}, style = Stroke(${stroke}))`,
    );
  }
  return `Canvas(modifier = Modifier.matchParentSize()) { ${path}; ${draws.join("; ")} }`;
}

function swiftModifiers(
  editor: Editor,
  element: Element,
  parent: Element | null,
  isRoot: boolean,
): string[] {
  const box = editor.getBounds(element.id);
  if (!box) return [];
  const style = element.visual.style ?? {};
  const parentLayout = layoutOf(parent);
  const inFlow =
    element.visual.layoutPosition !== "absolute" ? parentLayout : undefined;
  const modifiers = [
    `.frame(width: ${number(box.width)}, height: ${number(box.height)})`,
  ];
  if (element.visual.aspectRatio !== undefined)
    modifiers.push(
      `.aspectRatio(${number(element.visual.aspectRatio)}, contentMode: .fit)`,
    );
  if (
    element.visual.minWidth !== undefined ||
    element.visual.maxWidth !== undefined
  )
    modifiers.push(
      `.frame(${[
        element.visual.minWidth === undefined
          ? null
          : `minWidth: ${number(element.visual.minWidth)}`,
        element.visual.maxWidth === undefined
          ? null
          : `maxWidth: ${number(element.visual.maxWidth)}`,
      ]
        .filter(Boolean)
        .join(", ")})`,
    );
  if (
    element.visual.minHeight !== undefined ||
    element.visual.maxHeight !== undefined
  )
    modifiers.push(
      `.frame(${[
        element.visual.minHeight === undefined
          ? null
          : `minHeight: ${number(element.visual.minHeight)}`,
        element.visual.maxHeight === undefined
          ? null
          : `maxHeight: ${number(element.visual.maxHeight)}`,
      ]
        .filter(Boolean)
        .join(", ")})`,
    );
  if (
    inFlow &&
    (element.visual.layoutGrow ?? 0) > 0 &&
    element.type !== "group"
  )
    modifiers.push(
      inFlow.direction === "horizontal"
        ? ".frame(maxWidth: .infinity)"
        : ".frame(maxHeight: .infinity)",
    );
  if (inFlow?.align === "stretch" && element.type !== "group")
    modifiers.push(
      inFlow.direction === "horizontal"
        ? ".frame(maxHeight: .infinity)"
        : ".frame(maxWidth: .infinity)",
    );
  if (
    element.type !== "shape.geo" &&
    element.type !== "draw.path" &&
    style.fill
  )
    modifiers.push(
      `.background(${swiftPaint(style.fillGradient, style.fill, box)})`,
    );
  else if (
    element.type !== "shape.geo" &&
    element.type !== "draw.path" &&
    style.fillGradient
  )
    modifiers.push(
      `.background(${swiftPaint(style.fillGradient, style.fill, box)})`,
    );
  if (
    element.type !== "draw.path" &&
    style.strokeWidth &&
    (style.stroke || style.strokeGradient)
  ) {
    const outline = swiftShapeName(element, style);
    modifiers.push(
      `.overlay(${outline}${swiftStroke(style, swiftPaint(style.strokeGradient, style.stroke, box))})`,
    );
  }
  if (
    (style.cornerRadius || style.cornerRadii) &&
    element.type !== "shape.geo" &&
    element.type !== "draw.path"
  )
    modifiers.push(`.clipShape(${swiftShapeName(element, style)})`);
  if (style.opacity !== undefined)
    modifiers.push(`.opacity(${number(style.opacity)})`);
  if (style.blendMode)
    modifiers.push(`.blendMode(.${nativeBlendName(style.blendMode)})`);
  if (element.visual.rotation)
    modifiers.push(
      `.rotationEffect(.degrees(${number(element.visual.rotation)}))`,
    );
  if (
    element.type === "frame" &&
    (element.semantic as FrameSemantic).clipContent
  )
    modifiers.push(".clipped()");
  const mask = swiftMaskModifier(editor, element);
  if (mask) modifiers.push(mask);
  const boolean = swiftBooleanModifier(editor, element);
  if (boolean) modifiers.push(boolean);
  const accessibility = element.accessibility;
  if (accessibility?.decorative) {
    modifiers.push(".accessibilityHidden(true)");
  } else if (accessibility) {
    if (accessibility.label)
      modifiers.push(
        `.accessibilityLabel(${swiftString(accessibility.label)})`,
      );
    if (accessibility.hint)
      modifiers.push(`.accessibilityHint(${swiftString(accessibility.hint)})`);
    if (accessibility.value)
      modifiers.push(
        `.accessibilityValue(${swiftString(accessibility.value)})`,
      );
    const trait: Partial<Record<AccessibilityRole, string>> = {
      button: "isButton",
      link: "isLink",
      image: "isImage",
      heading: "isHeader",
      text: "isStaticText",
      switch: "isToggle",
    };
    const nativeTrait = accessibility.role
      ? trait[accessibility.role]
      : undefined;
    if (nativeTrait) modifiers.push(`.accessibilityAddTraits(.${nativeTrait})`);
    if (accessibility.headingLevel)
      modifiers.push(`.accessibilityHeading(.h${accessibility.headingLevel})`);
    if (accessibility.disabled)
      modifiers.push(".accessibilityRespondsToUserInteraction(false)");
  }
  if (!isRoot && parent && !inFlow) {
    const parentBox = editor.getBounds(parent.id);
    modifiers.push(
      `.position(x: ${number(box.x - (parentBox?.x ?? 0) + box.width / 2)}, y: ${number(box.y - (parentBox?.y ?? 0) + box.height / 2)})`,
    );
  }
  return modifiers;
}

function composeModifiers(
  editor: Editor,
  element: Element,
  parent: Element | null,
  isRoot: boolean,
): string {
  const box = editor.getBounds(element.id);
  if (!box) return "Modifier";
  const style = element.visual.style ?? {};
  const parentLayout = layoutOf(parent);
  const inFlow =
    element.visual.layoutPosition !== "absolute" ? parentLayout : undefined;
  const shape = composeShape(element, style);
  const parts = ["Modifier"];
  if (!isRoot && parent && !inFlow) {
    const parentBox = editor.getBounds(parent.id);
    parts.push(
      `.offset(x = ${number(box.x - (parentBox?.x ?? 0))}.dp, y = ${number(box.y - (parentBox?.y ?? 0))}.dp)`,
    );
  }
  if (inFlow && (element.visual.layoutGrow ?? 0) > 0)
    parts.push(`.weight(${number(element.visual.layoutGrow ?? 0)}f)`);
  if (element.visual.aspectRatio !== undefined)
    parts.push(`.aspectRatio(${number(element.visual.aspectRatio)}f)`);
  if (
    element.visual.minWidth !== undefined ||
    element.visual.maxWidth !== undefined
  )
    parts.push(
      `.widthIn(${[
        element.visual.minWidth === undefined
          ? null
          : `min = ${number(element.visual.minWidth)}.dp`,
        element.visual.maxWidth === undefined
          ? null
          : `max = ${number(element.visual.maxWidth)}.dp`,
      ]
        .filter(Boolean)
        .join(", ")})`,
    );
  if (
    element.visual.minHeight !== undefined ||
    element.visual.maxHeight !== undefined
  )
    parts.push(
      `.heightIn(${[
        element.visual.minHeight === undefined
          ? null
          : `min = ${number(element.visual.minHeight)}.dp`,
        element.visual.maxHeight === undefined
          ? null
          : `max = ${number(element.visual.maxHeight)}.dp`,
      ]
        .filter(Boolean)
        .join(", ")})`,
    );
  parts.push(`.size(${number(box.width)}.dp, ${number(box.height)}.dp)`);
  if (
    (style.cornerRadius || style.cornerRadii) &&
    element.type !== "shape.geo" &&
    element.type !== "draw.path"
  )
    parts.push(`.clip(${shape})`);
  if (element.type !== "draw.path" && (style.fill || style.fillGradient))
    parts.push(
      `.background(${composePaint(style.fillGradient, style.fill, box)}, ${shape})`,
    );
  if (
    element.type !== "draw.path" &&
    style.strokeWidth &&
    (style.stroke || style.strokeGradient)
  )
    parts.push(
      `.border(BorderStroke(${number(style.strokeWidth)}.dp, ${composePaint(style.strokeGradient, style.stroke, box)}), ${shape})`,
    );
  if (style.opacity !== undefined)
    parts.push(`.alpha(${number(style.opacity)}f)`);
  if (style.blendMode)
    parts.push(
      `.graphicsLayer { blendMode = BlendMode.${identifier(nativeBlendName(style.blendMode), "Normal")} }`,
    );
  if (element.visual.rotation)
    parts.push(`.rotate(${number(element.visual.rotation)}f)`);
  if (
    element.type === "image.raster" ||
    (element.type === "frame" &&
      (element.semantic as FrameSemantic).clipContent)
  )
    parts.push(".clipToBounds()");
  const mask = composeMaskModifier(editor, element);
  if (mask) parts.push(mask);
  const boolean = composeBooleanModifier(editor, element);
  if (boolean) parts.push(boolean);
  const accessibility = element.accessibility;
  if (accessibility) {
    const semantics: string[] = [];
    if (accessibility.decorative) {
      semantics.push("invisibleToUser()");
    } else {
      if (accessibility.label)
        semantics.push(`contentDescription = ${quoted(accessibility.label)}`);
      if (accessibility.value)
        semantics.push(`stateDescription = ${quoted(accessibility.value)}`);
      else if (accessibility.hint)
        semantics.push(`stateDescription = ${quoted(accessibility.hint)}`);
      const role: Partial<Record<AccessibilityRole, string>> = {
        button: "Button",
        image: "Image",
        checkbox: "Checkbox",
        switch: "Switch",
      };
      const nativeRole = accessibility.role
        ? role[accessibility.role]
        : undefined;
      if (nativeRole) semantics.push(`role = Role.${nativeRole}`);
      if (accessibility.role === "heading") semantics.push("heading()");
      if (accessibility.disabled) semantics.push("disabled()");
    }
    if (semantics.length) parts.push(`.semantics { ${semantics.join("; ")} }`);
  }
  return parts.join("");
}

function indented(lines: readonly string[], levels = 1): string[] {
  const prefix = "    ".repeat(levels);
  return lines.map((line) => `${prefix}${line}`);
}

function swiftCode(
  editor: Editor,
  tree: InterfaceTree,
  options: MobileCodeOptions,
): string {
  const rootName = (tree.root.semantic as FrameSemantic).name;
  const structName =
    options.swiftViewName ?? `Diagra${identifier(rootName, "Design")}View`;
  const render = (
    element: Element,
    parent: Element | null,
    isRoot: boolean,
  ): string[] => {
    const box = editor.getBounds(element.id) ?? {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
    const style = element.visual.style ?? {};
    const children = tree
      .childrenOf(element)
      .filter((child) => tree.includedIds.has(child.id));
    let lines: string[];
    const layout = layoutOf(element);
    const flowChildren = layout
      ? children.filter((child) => child.visual.layoutPosition !== "absolute")
      : children;
    const absoluteChildren = layout
      ? children.filter((child) => child.visual.layoutPosition === "absolute")
      : [];
    if (
      children.length ||
      element.type === "frame" ||
      element.type === "group"
    ) {
      const container = layout
        ? layout.wrap
          ? `DiagraFlowLayout(axis: .${layout.direction}, itemSpacing: ${number(layout.gap)}, lineSpacing: ${number(layout.crossGap ?? layout.gap)}, crossAlignment: ${layout.align === "start" ? "0" : layout.align === "end" ? "1" : "0.5"})`
          : layout.direction === "horizontal"
            ? `HStack(alignment: .${layout.align === "start" ? "top" : layout.align === "end" ? "bottom" : "center"}, spacing: ${number(layout.gap)})`
            : `VStack(alignment: .${layout.align === "start" ? "leading" : layout.align === "end" ? "trailing" : "center"}, spacing: ${number(layout.gap)})`
        : "ZStack(alignment: .topLeading)";
      lines = [`${container} {`];
      for (const child of flowChildren)
        lines.push(...indented(render(child, element, false)));
      lines.push("}");
      if (layout)
        lines.push(
          `.padding(EdgeInsets(top: ${number(layout.paddingTop ?? layout.padding)}, leading: ${number(layout.paddingLeft ?? layout.padding)}, bottom: ${number(layout.paddingBottom ?? layout.padding)}, trailing: ${number(layout.paddingRight ?? layout.padding)}))`,
        );
      if (absoluteChildren.length) {
        const flow = lines;
        lines = ["ZStack(alignment: .topLeading) {", ...indented(flow)];
        for (const child of absoluteChildren)
          lines.push(...indented(render(child, element, false)));
        lines.push("}");
      }
    } else if (element.type === "image.raster") {
      const semantic = element.semantic as ImageSemantic;
      const name = resourceName(element);
      if (semantic.crop) {
        const crop = semantic.crop;
        lines = [
          "ZStack(alignment: .topLeading) {",
          `    Image(${swiftString(name)})`,
          "        .resizable()",
          `        .frame(width: ${number(box.width / crop.width)}, height: ${number(box.height / crop.height)})`,
          `        .offset(x: ${number((-crop.x * box.width) / crop.width)}, y: ${number((-crop.y * box.height) / crop.height)})`,
          "}",
          ".clipped()",
          ...(element.accessibility
            ? []
            : [`.accessibilityLabel(${swiftString(semantic.alt)})`]),
        ];
      } else {
        lines = [
          `Image(${swiftString(name)})`,
          "    .resizable()",
          `    .aspectRatio(contentMode: .${semantic.fit === "cover" ? "fill" : "fit"})`,
          ...(element.accessibility
            ? []
            : [`    .accessibilityLabel(${swiftString(semantic.alt)})`]),
        ];
      }
    } else if (element.type === "draw.path") {
      lines = [swiftCompoundPath(element, style)];
    } else if (element.type === "shape.geo") {
      const text = editableText(editor, element);
      lines = text
        ? [
            "ZStack {",
            `    ${swiftShape(element, style, box)}`,
            `    ${swiftTextExpression(editor, element)}`,
            "}",
          ]
        : [swiftShape(element, style, box)];
    } else {
      lines = [swiftTextExpression(editor, element)];
      if (style.color)
        lines.push(`.foregroundStyle(${swiftColor(style.color)})`);
      if (style.fontSize)
        lines.push(`.font(.system(size: ${number(style.fontSize)}))`);
      if (style.fontWeight)
        lines.push(`.fontWeight(${swiftWeight(style.fontWeight)})`);
      if (style.fontStyle === "italic") lines.push(".italic()");
      if (style.textAlign)
        lines.push(
          `.multilineTextAlignment(.${style.textAlign === "middle" ? "center" : style.textAlign === "end" ? "trailing" : "leading"})`,
        );
      if (style.letterSpacing)
        lines.push(`.tracking(${number(style.letterSpacing)})`);
    }
    lines.push(...swiftModifiers(editor, element, parent, isRoot));
    return lines;
  };
  const body = indented(render(tree.root, null, true), 3);
  return [
    ...(options.includeSwiftImports === false ? [] : ["import SwiftUI", ""]),
    `struct ${structName}: View {`,
    "    var body: some View {",
    ...body,
    "    }",
    "}",
    ...(options.includeSwiftSupport === false
      ? []
      : [
          "",
          "private struct DiagraRasterMask: View {",
          "    let asset: String; let x: CGFloat; let y: CGFloat; let width: CGFloat; let height: CGFloat; let cropX: CGFloat; let cropY: CGFloat; let cropWidth: CGFloat; let cropHeight: CGFloat; let rotation: CGFloat; let luminance: Bool",
          "    var body: some View {",
          "        GeometryReader { proxy in",
          "            let image = Image(asset).resizable().frame(width: proxy.size.width * width / cropWidth, height: proxy.size.height * height / cropHeight).offset(x: proxy.size.width * (x - cropX * width / cropWidth), y: proxy.size.height * (y - cropY * height / cropHeight)).rotationEffect(.degrees(rotation))",
          "            if luminance { image.luminanceToAlpha() } else { image }",
          "        }",
          "    }",
          "}",
          "",
          "private struct DiagraBooleanMask: View {",
          "    let polygons: [[CGPoint]]",
          "    var body: some View {",
          "        Canvas { context, size in",
          "            var path = Path()",
          "            for polygon in polygons {",
          "                guard let first = polygon.first else { continue }",
          "                path.move(to: CGPoint(x: first.x * size.width, y: first.y * size.height))",
          "                for point in polygon.dropFirst() { path.addLine(to: CGPoint(x: point.x * size.width, y: point.y * size.height)) }",
          "                path.closeSubpath()",
          "            }",
          "            context.fill(path, with: .color(.white), style: FillStyle(eoFill: true))",
          "        }",
          "    }",
          "}",
          "",
          "private struct DiagraPolygon: Shape {",
          "    let points: [CGPoint]",
          "    func path(in rect: CGRect) -> Path {",
          "        var path = Path()",
          "        guard let first = points.first else { return path }",
          "        path.move(to: CGPoint(x: rect.minX + first.x * rect.width, y: rect.minY + first.y * rect.height))",
          "        for point in points.dropFirst() {",
          "            path.addLine(to: CGPoint(x: rect.minX + point.x * rect.width, y: rect.minY + point.y * rect.height))",
          "        }",
          "        path.closeSubpath()",
          "        return path",
          "    }",
          "}",
          "",
          "private struct DiagraFlowLayout: Layout {",
          "    let axis: Axis",
          "    let itemSpacing: CGFloat",
          "    let lineSpacing: CGFloat",
          "    let crossAlignment: CGFloat",
          "    private struct Line { var items: [Int] = []; var main: CGFloat = 0; var cross: CGFloat = 0 }",
          "    private func measured(_ proposal: ProposedViewSize, _ subviews: Subviews) -> ([CGSize], [Line]) {",
          "        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }",
          "        let limit = axis == .horizontal ? (proposal.width ?? .infinity) : (proposal.height ?? .infinity)",
          "        var lines: [Line] = []",
          "        for (index, size) in sizes.enumerated() {",
          "            let main = axis == .horizontal ? size.width : size.height",
          "            let cross = axis == .horizontal ? size.height : size.width",
          "            if lines.isEmpty || (!lines[lines.count - 1].items.isEmpty && lines[lines.count - 1].main + itemSpacing + main > limit) { lines.append(Line()) }",
          "            let line = lines.count - 1",
          "            if !lines[line].items.isEmpty { lines[line].main += itemSpacing }",
          "            lines[line].items.append(index); lines[line].main += main; lines[line].cross = max(lines[line].cross, cross)",
          "        }",
          "        return (sizes, lines)",
          "    }",
          "    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {",
          "        let (_, lines) = measured(proposal, subviews)",
          "        let main = lines.map(\\.main).max() ?? 0",
          "        let cross = lines.map(\\.cross).reduce(0, +) + CGFloat(max(0, lines.count - 1)) * lineSpacing",
          "        return axis == .horizontal ? CGSize(width: proposal.width ?? main, height: cross) : CGSize(width: cross, height: proposal.height ?? main)",
          "    }",
          "    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {",
          "        let (sizes, lines) = measured(ProposedViewSize(bounds.size), subviews)",
          "        var crossCursor: CGFloat = 0",
          "        for line in lines {",
          "            var mainCursor: CGFloat = 0",
          "            for index in line.items {",
          "                let size = sizes[index]",
          "                let childCross = axis == .horizontal ? size.height : size.width",
          "                let cross = crossCursor + (line.cross - childCross) * crossAlignment",
          "                let point = axis == .horizontal ? CGPoint(x: bounds.minX + mainCursor, y: bounds.minY + cross) : CGPoint(x: bounds.minX + cross, y: bounds.minY + mainCursor)",
          "                subviews[index].place(at: point, anchor: .topLeading, proposal: ProposedViewSize(size))",
          "                mainCursor += (axis == .horizontal ? size.width : size.height) + itemSpacing",
          "            }",
          "            crossCursor += line.cross + lineSpacing",
          "        }",
          "    }",
          "}",
        ]),
  ].join("\n");
}

function composeCode(
  editor: Editor,
  tree: InterfaceTree,
  options: MobileCodeOptions,
): string {
  const rootName = (tree.root.semantic as FrameSemantic).name;
  const functionName =
    options.composeFunctionName ??
    `Diagra${identifier(rootName, "Design")}Screen`;
  const usesFlowLayout = tree.included.some(
    (element) => layoutOf(element)?.wrap === true,
  );
  const render = (
    element: Element,
    parent: Element | null,
    isRoot: boolean,
  ): string[] => {
    const box = editor.getBounds(element.id) ?? {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
    const style = element.visual.style ?? {};
    const modifier = composeModifiers(editor, element, parent, isRoot);
    const children = tree
      .childrenOf(element)
      .filter((child) => tree.includedIds.has(child.id));
    const layout = layoutOf(element);
    const flowChildren = layout
      ? children.filter((child) => child.visual.layoutPosition !== "absolute")
      : children;
    const absoluteChildren = layout
      ? children.filter((child) => child.visual.layoutPosition === "absolute")
      : [];
    if (
      children.length ||
      element.type === "frame" ||
      element.type === "group"
    ) {
      const container = layout
        ? layout.wrap
          ? layout.direction === "horizontal"
            ? "FlowRow"
            : "FlowColumn"
          : layout.direction === "horizontal"
            ? "Row"
            : "Column"
        : "Box";
      const arrangement = layout
        ? layout.justify === "space-between"
          ? "Arrangement.SpaceBetween"
          : layout.justify === "center"
            ? "Arrangement.Center"
            : layout.justify === "end"
              ? "Arrangement.End"
              : `Arrangement.spacedBy(${number(layout.gap)}.dp)`
        : null;
      const alignment = layout
        ? layout.direction === "horizontal"
          ? `${layout.wrap ? "itemVerticalAlignment" : "verticalAlignment"} = Alignment.${layout.align === "start" ? "Top" : layout.align === "end" ? "Bottom" : "CenterVertically"}`
          : `${layout.wrap ? "itemHorizontalAlignment" : "horizontalAlignment"} = Alignment.${layout.align === "start" ? "Start" : layout.align === "end" ? "End" : "CenterHorizontally"}`
        : null;
      const padding = layout
        ? `.padding(start = ${number(layout.paddingLeft ?? layout.padding)}.dp, top = ${number(layout.paddingTop ?? layout.padding)}.dp, end = ${number(layout.paddingRight ?? layout.padding)}.dp, bottom = ${number(layout.paddingBottom ?? layout.padding)}.dp)`
        : "";
      const args = [
        `modifier = ${absoluteChildren.length ? "Modifier.matchParentSize()" : modifier}${padding}`,
        ...(arrangement
          ? [
              `${layout?.direction === "horizontal" ? "horizontal" : "vertical"}Arrangement = ${arrangement}`,
            ]
          : []),
        ...(layout?.wrap
          ? [
              `${layout.direction === "horizontal" ? "vertical" : "horizontal"}Arrangement = Arrangement.spacedBy(${number(layout.crossGap ?? layout.gap)}.dp)`,
            ]
          : []),
        ...(alignment ? [alignment] : []),
      ];
      const lines = [`${container}(${args.join(", ")}) {`];
      for (const child of flowChildren)
        lines.push(...indented(render(child, element, false)));
      lines.push("}");
      if (absoluteChildren.length) {
        const overlay = [`Box(modifier = ${modifier}) {`, ...indented(lines)];
        for (const child of absoluteChildren)
          overlay.push(...indented(render(child, element, false)));
        overlay.push("}");
        return overlay;
      }
      return lines;
    }
    if (element.type === "image.raster") {
      const semantic = element.semantic as ImageSemantic;
      if (semantic.crop) {
        const crop = semantic.crop;
        return [
          `Box(modifier = ${modifier}) {`,
          "    Image(",
          `        painter = painterResource(R.drawable.${resourceName(element)}),`,
          `        contentDescription = ${element.accessibility ? "null" : quoted(semantic.alt)},`,
          "        contentScale = ContentScale.FillBounds,",
          `        modifier = Modifier.offset(x = ${number((-crop.x * box.width) / crop.width)}.dp, y = ${number((-crop.y * box.height) / crop.height)}.dp).size(${number(box.width / crop.width)}.dp, ${number(box.height / crop.height)}.dp)`,
          "    )",
          "}",
        ];
      }
      return [
        "Image(",
        `    painter = painterResource(R.drawable.${resourceName(element)}),`,
        `    contentDescription = ${element.accessibility ? "null" : quoted(semantic.alt)},`,
        `    contentScale = ContentScale.${semantic.fit === "cover" ? "Crop" : semantic.fit === "fill" ? "FillBounds" : "Fit"},`,
        `    modifier = ${modifier}`,
        ")",
      ];
    }
    const text = editableText(editor, element);
    if (element.type === "draw.path") {
      return [
        `Box(modifier = ${modifier}) {`,
        `    ${composeCompoundPath(element, style)}`,
        "}",
      ];
    }
    if (element.type === "shape.geo") {
      return [
        `Box(modifier = ${modifier}, contentAlignment = Alignment.Center) {`,
        ...(text
          ? [`    Text(text = ${composeTextExpression(editor, element)})`]
          : []),
        "}",
      ];
    }
    const textArgs = [
      `text = ${composeTextExpression(editor, element)}`,
      `modifier = ${modifier}`,
      ...(style.color ? [`color = ${composeColor(style.color)}`] : []),
      ...(style.fontSize ? [`fontSize = ${number(style.fontSize)}.sp`] : []),
      ...(style.fontWeight
        ? [`fontWeight = FontWeight(${Math.round(style.fontWeight)})`]
        : []),
      ...(style.fontStyle === "italic" ? ["fontStyle = FontStyle.Italic"] : []),
      ...(style.textAlign
        ? [
            `textAlign = TextAlign.${style.textAlign === "middle" ? "Center" : style.textAlign === "end" ? "End" : "Start"}`,
          ]
        : []),
      ...(style.letterSpacing
        ? [`letterSpacing = ${number(style.letterSpacing)}.sp`]
        : []),
    ];
    return [`Text(${textArgs.join(", ")})`];
  };
  const body = indented(render(tree.root, null, true));
  return [
    ...(options.includeComposeImports === false
      ? []
      : [
          "import androidx.compose.foundation.BorderStroke",
          "import androidx.compose.foundation.Canvas",
          "import androidx.compose.foundation.Image",
          "import androidx.compose.foundation.background",
          "import androidx.compose.foundation.border",
          "import androidx.compose.foundation.layout.*",
          "import androidx.compose.foundation.shape.CircleShape",
          "import androidx.compose.foundation.shape.GenericShape",
          "import androidx.compose.foundation.shape.RoundedCornerShape",
          "import androidx.compose.material3.Text",
          "import androidx.compose.runtime.Composable",
          "import androidx.compose.ui.Alignment",
          "import androidx.compose.ui.Modifier",
          "import androidx.compose.ui.draw.alpha",
          "import androidx.compose.ui.draw.clip",
          "import androidx.compose.ui.draw.clipToBounds",
          "import androidx.compose.ui.draw.drawWithContent",
          "import androidx.compose.ui.draw.rotate",
          "import androidx.compose.ui.geometry.Offset",
          "import androidx.compose.ui.geometry.Size",
          "import androidx.compose.ui.graphics.Brush",
          "import androidx.compose.ui.graphics.BlendMode",
          "import androidx.compose.ui.graphics.Color",
          "import androidx.compose.ui.graphics.ColorFilter",
          "import androidx.compose.ui.graphics.ColorMatrix",
          "import androidx.compose.ui.graphics.graphicsLayer",
          "import androidx.compose.ui.graphics.Path",
          "import androidx.compose.ui.graphics.PathFillType",
          "import androidx.compose.ui.graphics.PathEffect",
          "import androidx.compose.ui.graphics.drawscope.Stroke",
          "import androidx.compose.ui.graphics.drawscope.withTransform",
          "import androidx.compose.ui.layout.ContentScale",
          "import androidx.compose.ui.res.painterResource",
          "import androidx.compose.ui.semantics.*",
          "import androidx.compose.ui.text.font.FontStyle",
          "import androidx.compose.ui.text.font.FontFamily",
          "import androidx.compose.ui.text.font.FontWeight",
          "import androidx.compose.ui.text.SpanStyle",
          "import androidx.compose.ui.text.buildAnnotatedString",
          "import androidx.compose.ui.text.style.TextAlign",
          "import androidx.compose.ui.text.style.TextDecoration",
          "import androidx.compose.ui.unit.dp",
          "import androidx.compose.ui.unit.sp",
          "",
        ]),
    ...(usesFlowLayout ? ["@OptIn(ExperimentalLayoutApi::class)"] : []),
    "@Composable",
    `fun ${functionName}() {`,
    ...body,
    "}",
    "",
    "@Composable",
    "private fun Modifier.diagraRasterMask(resource: Int, x: Float, y: Float, width: Float, height: Float, cropX: Float, cropY: Float, cropWidth: Float, cropHeight: Float, rotation: Float, luminance: Boolean): Modifier {",
    "    val painter = painterResource(resource)",
    "    val filter = if (luminance) ColorFilter.colorMatrix(ColorMatrix(floatArrayOf(0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, .2126f, .7152f, .0722f, 0f, 0f))) else null",
    "    return drawWithContent {",
    "        drawContent()",
    "        val fullWidth = size.width * width / cropWidth; val fullHeight = size.height * height / cropHeight",
    "        val origin = Offset(size.width * (x - cropX * width / cropWidth), size.height * (y - cropY * height / cropHeight))",
    "        val pivot = Offset(size.width * (x + width / 2f), size.height * (y + height / 2f))",
    "        withTransform({ rotate(rotation, pivot) }) { with(painter) { draw(size = Size(fullWidth, fullHeight), topLeft = origin, colorFilter = filter, blendMode = BlendMode.DstIn) } }",
    "    }",
    "}",
  ].join("\n");
}

/** Read-only native-code handoff for the same visible hierarchy as HTML. */
export function generateMobileInterfaceCode(
  editor: Editor,
  rootId: ElementId,
  options: MobileCodeOptions = {},
): MobileInterfaceCode | null {
  const tree = collectInterfaceTree(editor, rootId);
  if (!tree) return null;
  const rootSemantic = tree.root.semantic as FrameSemantic;
  const assets = tree.included.flatMap((element) => {
    if (element.type !== "image.raster") return [];
    const semantic = element.semantic as ImageSemantic;
    const mediaType = /^data:([^;,]+)/.exec(semantic.src)?.[1] ?? "image/png";
    return [
      {
        elementId: element.id,
        resourceName: resourceName(element),
        mediaType,
      },
    ];
  });
  const gradients = tree.included.flatMap((element) => [
    element.visual.style?.fillGradient,
    element.visual.style?.strokeGradient,
  ]);
  const richLinks = tree.included.flatMap((element) =>
    element.type === "text.note"
      ? richTextSegments(element.semantic).flatMap((segment) =>
          segment.marks.filter((mark) => mark.kind === "link"),
        )
      : [],
  );
  const notes = [
    "SwiftUI and Jetpack Compose output are implementation starting points generated from the same visible artboard hierarchy as HTML.",
    "Embedded image data stays in the semantic manifest; copy each listed asset into the platform asset catalog using its generated resource name.",
    ...(rootSemantic.safeArea
      ? [
          `Design safe area (${rootSemantic.platform ?? "unspecified"}): top ${number(rootSemantic.safeArea.top)}, right ${number(rootSemantic.safeArea.right)}, bottom ${number(rootSemantic.safeArea.bottom)}, left ${number(rootSemantic.safeArea.left)}. Preserve it with SwiftUI safe-area APIs or Compose WindowInsets rather than hard-coding device pixels.`,
        ]
      : []),
    ...(gradients.some((gradient) => gradient?.type === "diamond")
      ? ["Diamond gradients use their first stop as a native-code fallback."]
      : []),
    ...(gradients.some(
      (gradient) => gradient?.type === "angular" && gradient.angle !== 0,
    )
      ? [
          "Jetpack Compose sweep gradients preserve stops and center but require a custom shader to rotate the zero-stop angle.",
        ]
      : []),
    ...(tree.included.some((element) => {
      const style = element.visual.style;
      return Boolean(style?.effects?.length || style?.shadow);
    })
      ? [
          "Layer effects and shadows remain in the semantic manifest and need platform-specific finishing.",
        ]
      : []),
    ...(tree.included.some(
      (element) =>
        element.visual.style?.fontVariations?.length ||
        element.visual.style?.fontFeatures?.length,
    )
      ? [
          "Variable-font axes and OpenType feature settings remain in the semantic manifest and CSS/SVG handoff; map them through the chosen native font asset APIs.",
        ]
      : []),
    ...(tree.included.some(
      (element) =>
        element.type === "group" &&
        Boolean((element.semantic as GroupSemantic).booleanOperation),
    )
      ? [
          "Boolean groups resolve nested compound silhouettes to even-odd SwiftUI Canvas and Jetpack Compose clip paths; verify clipping on the target OS and GPU.",
        ]
      : []),
    ...(richLinks.length
      ? [
          "Rich links are visually identified in SwiftUI; Jetpack Compose includes URL annotations. Wire platform navigation and accessibility in the consuming app.",
        ]
      : []),
    ...(tree.included.some((element) => element.accessibility)
      ? [
          "Accessibility metadata is mapped to native semantics. Platform roles without a direct SwiftUI trait or Jetpack Compose Role remain in the semantic manifest for application-specific wiring.",
        ]
      : []),
    ...(tree.included.some((element) => {
      const style = element.visual.style;
      return Boolean(
        style?.strokeCap || style?.strokeJoin || style?.strokeMiterLimit,
      );
    })
      ? [
          "SwiftUI maps authored stroke caps, joins and miter limits. Jetpack Compose BorderStroke does not expose them; use Canvas Stroke for exact outline geometry.",
        ]
      : []),
    ...(richLinks.some((mark) => safeTextLinkHref(mark.href) === null)
      ? [
          "Unsafe rich-text link protocols are omitted from native URL annotations.",
        ]
      : []),
  ];
  return {
    rootId,
    swiftUi: swiftCode(editor, tree, options),
    jetpackCompose: composeCode(editor, tree, options),
    assets,
    notes,
  };
}

function stableNativeSuffix(value: string): string {
  return Array.from(value, (character) =>
    character.codePointAt(0)?.toString(16).padStart(6, "0"),
  ).join("");
}

function swiftAdaptiveDispatcher(
  name: string,
  breakpoints: readonly AdaptiveMobileBreakpoint[],
): string {
  const descending = [...breakpoints].reverse();
  const choices = descending.flatMap((breakpoint, index) => {
    if (index === descending.length - 1)
      return descending.length === 1
        ? [`            ${breakpoint.swiftViewName}()`]
        : [
            "            } else {",
            `                ${breakpoint.swiftViewName}()`,
          ];
    return [
      `${index === 0 ? "            if" : "            } else if"} proxy.size.width >= ${number(breakpoint.width)} {`,
      `                ${breakpoint.swiftViewName}()`,
    ];
  });
  if (descending.length > 1) choices.push("            }");
  return [
    `struct ${name}: View {`,
    "    var body: some View {",
    "        GeometryReader { proxy in",
    ...choices,
    "        }",
    "    }",
    "}",
  ].join("\n");
}

function composeAdaptiveDispatcher(
  name: string,
  breakpoints: readonly AdaptiveMobileBreakpoint[],
): string {
  const descending = [...breakpoints].reverse();
  return [
    "@Composable",
    `fun ${name}() {`,
    "    BoxWithConstraints {",
    ...(descending.length === 1
      ? [`        ${descending[0]?.composeFunctionName}()`]
      : [
          "        when {",
          ...descending.map((breakpoint, index) =>
            index === descending.length - 1
              ? `            else -> ${breakpoint.composeFunctionName}()`
              : `            maxWidth >= ${number(breakpoint.width)}.dp -> ${breakpoint.composeFunctionName}()`,
          ),
          "        }",
        ]),
    "    }",
    "}",
  ].join("\n");
}

/** Generate adaptive SwiftUI and Compose source for one responsive family. */
export function generateAdaptiveMobileInterfaceCode(
  editor: Editor,
  rootId: ElementId,
): AdaptiveMobileInterfaceCode | null {
  const family = collectResponsiveFamily(editor, rootId);
  if (!family) return null;
  const breakpoints: AdaptiveMobileBreakpoint[] = family.members.map(
    (member) => {
      const suffix = stableNativeSuffix(member.rootId);
      return {
        rootId: member.rootId,
        name: member.name,
        ...(member.platform ? { platform: member.platform } : {}),
        width: member.width,
        swiftViewName: `DiagraBreakpoint${suffix}View`,
        composeFunctionName: `DiagraBreakpoint${suffix}Screen`,
      };
    },
  );
  const reports = breakpoints.map((breakpoint, index) => {
    const report = generateMobileInterfaceCode(editor, breakpoint.rootId, {
      swiftViewName: breakpoint.swiftViewName,
      composeFunctionName: breakpoint.composeFunctionName,
      includeSwiftImports: index === 0,
      includeSwiftSupport: index === breakpoints.length - 1,
      includeComposeImports: index === 0,
    });
    if (!report)
      throw new Error(`responsive artboard ${breakpoint.rootId} disappeared`);
    return report;
  });
  const familySuffix = stableNativeSuffix(family.sourceRootId);
  const swiftDispatcherName = `DiagraAdaptive${familySuffix}View`;
  const composeDispatcherName = `DiagraAdaptive${familySuffix}Screen`;
  const notes = [
    "Adaptive native output preserves every designer-authored artboard as a separate view and chooses one from the available container width.",
    ...family.notes,
    ...reports.flatMap((report, index) =>
      report.notes.map(
        (note) =>
          `${breakpoints[index]?.name} (${breakpoints[index]?.width}px): ${note}`,
      ),
    ),
  ];
  const assets = reports.flatMap((report) => report.assets);
  const semanticManifests = breakpoints.map((breakpoint) => {
    const generated = generateInterfaceCode(editor, breakpoint.rootId);
    return generated ? (JSON.parse(generated.manifest) as unknown) : null;
  });
  const manifestValue = {
    sourceRoot: family.sourceRootId,
    swiftDispatcher: swiftDispatcherName,
    composeDispatcher: composeDispatcherName,
    breakpoints: breakpoints.map((breakpoint, index) => ({
      ...breakpoint,
      manifest: semanticManifests[index],
    })),
    assets,
    notes,
  };
  return {
    sourceRootId: family.sourceRootId,
    breakpoints,
    swiftUi: [
      ...reports.map((report) => report.swiftUi),
      swiftAdaptiveDispatcher(swiftDispatcherName, breakpoints),
    ].join("\n\n"),
    jetpackCompose: [
      ...reports.map((report) => report.jetpackCompose),
      composeAdaptiveDispatcher(composeDispatcherName, breakpoints),
    ].join("\n\n"),
    assets,
    manifest: JSON.stringify(manifestValue, null, 2),
    notes,
  };
}
