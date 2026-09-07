// Diagram IR: canonical semantic + visual data model.
// See the product design (diagra-cloud repo), section 5.1.
//
// This module is runtime-agnostic: no DOM, no framework imports.

import type { AccessibilityMetadata } from "./accessibility.ts";

/** Identifier of a {@link Document}. ULIDs in practice; any non-empty string parses. */
export type DocId = string;
/** Identifier of a {@link Page}, unique within a document. */
export type PageId = string;
/** Identifier of an {@link Element}, unique within a document and stable across renames. */
export type ElementId = string;

/**
 * Fractional index key (jittered lexicographic ordering key). Used for
 * z-order on every element and for the time axis of sequence diagrams.
 */
export type FractionalIndex = string;

/**
 * A page kind selects the default tool palette; it never restricts which
 * element types may live on the page.
 */
export const PAGE_KINDS = [
  "freeform",
  "erd",
  "uml",
  "sequence",
  "architecture",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

/**
 * Unknown fields carried through a parse/serialize round trip untouched.
 * Forward compatibility: a newer writer may add fields this build does not
 * model, and reserializing must not drop them.
 */
export type Extensions = Readonly<Record<string, unknown>>;

/** Visual style. All fields optional; unknown fields survive in `extensions`. */
export interface GradientStop {
  /** Position along the gradient, from 0 to 1. */
  readonly offset: number;
  readonly color: string;
  readonly opacity?: number;
}

export type FillGradient =
  | {
      readonly type: "linear";
      /** Clockwise CSS angle in degrees; zero points upward. */
      readonly angle: number;
      readonly stops: readonly GradientStop[];
    }
  | {
      readonly type: "radial";
      /** Normalized object-bounding-box center and radius. */
      readonly centerX: number;
      readonly centerY: number;
      readonly radius: number;
      readonly stops: readonly GradientStop[];
    }
  | {
      readonly type: "angular";
      /** Normalized center; angle is the clockwise zero-stop direction. */
      readonly centerX: number;
      readonly centerY: number;
      readonly angle: number;
      readonly stops: readonly GradientStop[];
    }
  | {
      readonly type: "diamond";
      /** Normalized center and radius, rotated clockwise by `angle`. */
      readonly centerX: number;
      readonly centerY: number;
      readonly radius: number;
      readonly angle: number;
      readonly stops: readonly GradientStop[];
    };

export interface DropShadowEffect {
  readonly type: "drop-shadow";
  readonly x: number;
  readonly y: number;
  /** Gaussian standard deviation in design pixels. */
  readonly blur: number;
  readonly color: string;
  readonly opacity: number;
  readonly enabled?: boolean;
}

export interface LayerBlurEffect {
  readonly type: "layer-blur";
  /** Gaussian standard deviation in design pixels. */
  readonly blur: number;
  readonly enabled?: boolean;
}

export interface BackgroundBlurEffect {
  readonly type: "background-blur";
  /** Gaussian standard deviation applied to pixels behind the layer. */
  readonly blur: number;
  readonly enabled?: boolean;
}

export type LayerEffect =
  | DropShadowEffect
  | LayerBlurEffect
  | BackgroundBlurEffect;

/** Portable layer compositing modes shared by CSS, SVG and native handoff. */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface CornerRadii {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
}

export interface FontVariationAxis {
  /** Four-character OpenType variation tag, for example `wght` or `wdth`. */
  readonly tag: string;
  readonly value: number;
}

export interface FontFeatureSetting {
  /** Four-character OpenType feature tag, for example `liga` or `ss01`. */
  readonly tag: string;
  /** Zero disables; positive integers select or enable the feature. */
  readonly value: number;
}

export type TextResizeMode = "fixed" | "auto-width" | "auto-height";

export interface VisualStyle {
  /** Ordered compositing effects. When present, supersedes legacy `shadow`. */
  readonly effects?: readonly LayerEffect[];
  /** Legacy single shadow retained for backward-compatible documents. */
  readonly shadow?: {
    readonly x: number;
    readonly y: number;
    /** Gaussian standard deviation in design pixels. */
    readonly blur: number;
    readonly color: string;
    readonly opacity: number;
  };
  readonly fill?: string;
  /** Gradient body paint; `fill` remains its portable solid fallback. */
  readonly fillGradient?: FillGradient;
  readonly stroke?: string;
  /** Gradient outline paint; `stroke` remains its portable solid fallback. */
  readonly strokeGradient?: FillGradient;
  readonly strokeWidth?: number;
  /** Shape used at open stroke endpoints. SVG-compatible portable values. */
  readonly strokeCap?: "butt" | "round" | "square";
  /** Shape used where consecutive stroke segments meet. */
  readonly strokeJoin?: "miter" | "round" | "bevel";
  /** Ratio at which a miter join falls back to a bevel; defaults to 4. */
  readonly strokeMiterLimit?: number;
  /** Alternating painted/gap lengths. Overrides the legacy `dash` preset. */
  readonly strokeDashArray?: readonly number[];
  /** Phase within the resolved dash cycle, in design pixels. */
  readonly strokeDashOffset?: number;
  readonly cornerRadius?: number;
  /** Independent circular corner radii; supersedes `cornerRadius`. */
  readonly cornerRadii?: CornerRadii;
  readonly dash?: "solid" | "dashed" | "dotted";
  readonly opacity?: number;
  /** Composites this layer with the already-painted backdrop. */
  readonly blendMode?: BlendMode;
  readonly color?: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly fontWeight?: number;
  readonly fontStyle?: "normal" | "italic";
  readonly fontVariations?: readonly FontVariationAxis[];
  readonly fontFeatures?: readonly FontFeatureSetting[];
  /** Unitless multiplier of font size. */
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly textAlign?: "start" | "middle" | "end";
  readonly textDecoration?:
    | "none"
    | "underline"
    | "line-through"
    | "underline line-through";
  readonly verticalAlign?: "top" | "middle" | "bottom";
  readonly extensions?: Extensions;
}

/**
 * Presentation payload of an element. Everything is optional: derived
 * layouts (sequence diagrams) leave coordinates unset, and connectors carry
 * no box geometry at all.
 */
export interface Visual {
  /** Opt-in tight Bézier frame; omitted preserves legacy control-hull mapping. */
  readonly strokeBounds?: "curve";
  /** Relative main-axis fill weight inside a fixed auto-layout parent; zero is fixed. */
  readonly layoutGrow?: number;
  /** Opt out of a parent frame's flow while retaining explicit membership. */
  readonly layoutPosition?: "absolute";
  /** Editor-only layer label, independent of visible/engineering semantics. */
  readonly layerName?: string;
  /** Linked palette colors; style retains a portable literal fallback. */
  readonly colorTokens?: Partial<
    Record<"fill" | "stroke" | "color", ElementId>
  >;
  /** Linked spacing, sizing, radius and typography measurements. */
  readonly numberTokens?: Partial<
    Record<
      | "width"
      | "height"
      | "minWidth"
      | "maxWidth"
      | "minHeight"
      | "maxHeight"
      | "cornerRadius"
      | "cornerTopLeft"
      | "cornerTopRight"
      | "cornerBottomRight"
      | "cornerBottomLeft"
      | "strokeWidth"
      | "fontSize"
      | "letterSpacing"
      | "gap"
      | "crossGap"
      | "padding"
      | "paddingTop"
      | "paddingRight"
      | "paddingBottom"
      | "paddingLeft",
      ElementId
    >
  >;
  /** Linked reusable typography style; literal style fields remain fallbacks. */
  readonly textStyle?: ElementId;
  /** Unique within a component definition; matches layers across variants. */
  readonly componentKey?: string;
  readonly horizontalConstraint?:
    | "start"
    | "end"
    | "center"
    | "stretch"
    | "scale";
  readonly verticalConstraint?:
    | "start"
    | "end"
    | "center"
    | "stretch"
    | "scale";
  /** Hidden layers remain in the document but are omitted from drawing/export. */
  readonly hidden?: boolean;
  /** Prevent direct editing; this is an editor affordance, not authorization. */
  readonly locked?: boolean;
  /** Pin this visual root to its prototype viewport while content scrolls. */
  readonly prototypeFixed?: boolean;
  /** Page-space x, in page units. */
  readonly x?: number;
  /** Page-space y, in page units. */
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  /** Lower/upper bounds for dimensions derived by auto layout. */
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  /** Persistent width / height proportion used by resizing and layout. */
  readonly aspectRatio?: number;
  /** Text-note box sizing; omitted keeps the legacy fixed box. */
  readonly textResize?: TextResizeMode;
  /**
   * Clockwise rotation in **degrees**, about the element's own centre.
   *
   * Degrees rather than radians so the 0.01 serialization rounding stays
   * imperceptible (0.01 degrees; 0.01 radians would be a visible 0.57
   * degrees) and so the file stays readable in a diff. Renderers convert.
   */
  readonly rotation?: number;
  readonly style?: VisualStyle;
  readonly extensions?: Extensions;
}

export interface Page {
  readonly id: PageId;
  readonly name: string;
  readonly kind: PageKind;
  /** Optional base62 fractional ordering key; legacy pages fall back to ID order. */
  readonly order?: FractionalIndex;
  /** Document-token mode used by elements on this page; omitted is Default. */
  readonly tokenMode?: string;
  readonly extensions?: Extensions;
}

/**
 * An element is one semantic object on a page. `type` selects the registry
 * entry that gives `semantic` its shape; `visual` is presentation only.
 */
export interface Element<S = unknown> {
  readonly id: ElementId;
  readonly page: PageId;
  readonly type: string;
  readonly index: FractionalIndex;
  readonly semantic: S;
  readonly accessibility?: AccessibilityMetadata;
  readonly visual: Visual;
  readonly extensions?: Extensions;
}

/**
 * A JSONL record whose `kind` this build does not understand. Kept verbatim
 * so a round trip through an older reader is lossless.
 */
export interface UnknownRecord {
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * A whole diagram document.
 *
 * Note: the design's section 5.1 sketch lists only `pages`, but element
 * records are top-level in the JSONL format (section 6) and carry a `page`
 * back-reference, so the in-memory document owns a flat `elements` list.
 */
export interface Document {
  readonly schemaVersion: number;
  readonly id: DocId;
  readonly title: string;
  readonly pages: readonly Page[];
  readonly elements: readonly Element[];
  /** Records whose `kind` is not document/page/element, preserved verbatim. */
  readonly unknownRecords?: readonly UnknownRecord[];
  readonly extensions?: Extensions;
}

export function isPageKind(value: unknown): value is PageKind {
  return (
    typeof value === "string" &&
    (PAGE_KINDS as readonly string[]).includes(value)
  );
}

/** True for plain JSON objects (not arrays, not null). */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Index a document's elements by page id, preserving input order. */
export function elementsByPage(document: Document): Map<PageId, Element[]> {
  const byPage = new Map<PageId, Element[]>();
  for (const page of document.pages) {
    byPage.set(page.id, []);
  }
  for (const element of document.elements) {
    const bucket = byPage.get(element.page);
    if (bucket) {
      bucket.push(element);
    } else {
      byPage.set(element.page, [element]);
    }
  }
  return byPage;
}
