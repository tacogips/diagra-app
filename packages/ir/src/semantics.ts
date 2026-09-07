// Semantic payloads for the v1 element type registry.
// See the product design (diagra-cloud repo), section 5.2.

import type {
  ElementId,
  FontFeatureSetting,
  FontVariationAxis,
  FractionalIndex,
} from "./types.ts";

export const ARROWHEADS = ["none", "arrow", "triangle", "dot"] as const;
export type Arrowhead = (typeof ARROWHEADS)[number];

export const CARDINALITIES = ["1:1", "1:*", "*:1", "*:*"] as const;
export type Cardinality = (typeof CARDINALITIES)[number];

export const REFERENTIAL_ACTIONS = [
  "no-action",
  "restrict",
  "cascade",
  "set-null",
  "set-default",
] as const;
export type ReferentialAction = (typeof REFERENTIAL_ACTIONS)[number];

export const FOREIGN_KEY_DEFERRABILITIES = [
  "not-deferrable",
  "initially-immediate",
  "initially-deferred",
] as const;
export type ForeignKeyDeferrability =
  (typeof FOREIGN_KEY_DEFERRABILITIES)[number];

export const GUIDE_AXES = ["x", "y"] as const;
export type GuideAxis = (typeof GUIDE_AXES)[number];

export interface PageGuideSemantic {
  /** x is a vertical guide; y is a horizontal guide. */
  readonly axis: GuideAxis;
  readonly position: number;
  readonly color?: string;
  readonly hidden?: boolean;
  readonly locked?: boolean;
}

export const UML_VISIBILITIES = ["+", "-", "#", "~"] as const;
export type UmlVisibility = (typeof UML_VISIBILITIES)[number];

export const UML_ASSOCIATION_KINDS = [
  "assoc",
  "aggregate",
  "compose",
  "inherit",
] as const;
export type UmlAssociationKind = (typeof UML_ASSOCIATION_KINDS)[number];

export const PARTICIPANT_KINDS = ["actor", "service", "db"] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

export const MESSAGE_KINDS = ["sync", "async", "return"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const GEO_KINDS = [
  "rect",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "parallelogram",
  "cylinder",
  "star",
] as const;
export type GeoKind = (typeof GEO_KINDS)[number];

export const TEXT_MARK_KINDS = [
  "bold",
  "italic",
  "code",
  "strike",
  "underline",
  "link",
] as const;
export type TextMarkKind = (typeof TEXT_MARK_KINDS)[number];

export interface GenericNodeSemantic {
  readonly label: string;
}

export interface Arrowheads {
  readonly start?: Arrowhead;
  readonly end?: Arrowhead;
}

export const PROTOTYPE_TRANSITIONS = [
  "instant",
  "fade",
  "slide-left",
  "slide-right",
  "smart",
] as const;
export type PrototypeTransition = (typeof PROTOTYPE_TRANSITIONS)[number];

export const PROTOTYPE_TRIGGERS = [
  "click",
  "hover",
  "press",
  "after-delay",
] as const;
export type PrototypeTrigger = (typeof PROTOTYPE_TRIGGERS)[number];

export const PROTOTYPE_ACTIONS = [
  "navigate",
  "change-to",
  "open-overlay",
  "close-overlay",
] as const;
export type PrototypeAction = (typeof PROTOTYPE_ACTIONS)[number];

export const PROTOTYPE_OVERLAY_POSITIONS = [
  "center",
  "top-left",
  "manual",
] as const;
export type PrototypeOverlayPosition =
  (typeof PROTOTYPE_OVERLAY_POSITIONS)[number];

export const PROTOTYPE_OVERFLOWS = [
  "none",
  "vertical",
  "horizontal",
  "both",
] as const;
export type PrototypeOverflow = (typeof PROTOTYPE_OVERFLOWS)[number];

export const CONNECTOR_ROUTINGS = ["straight", "orthogonal", "manual"] as const;
export type ConnectorRouting = (typeof CONNECTOR_ROUTINGS)[number];
export const MAX_CONNECTOR_WAYPOINTS = 32;
export const CONNECTOR_ROUTING_AXES = [
  "auto",
  "horizontal",
  "vertical",
] as const;
export type ConnectorRoutingAxis = (typeof CONNECTOR_ROUTING_AXES)[number];

/** A point in the endpoint-centre basis: normalized along, page units across. */
export interface ConnectorWaypoint {
  readonly u: number;
  readonly v: number;
}

export interface ConnectorRoutingSemantic {
  readonly routing?: ConnectorRouting;
  readonly routingAxis?: ConnectorRoutingAxis;
  /** Position of the middle channel between endpoints; 0–1, default 0.5. */
  readonly routingBend?: number;
  /** Route around visible layers on the connector's page; default true. */
  readonly routingAvoidObstacles?: boolean;
  /** User-authored points for manual routes, stable as endpoints move together. */
  readonly routingWaypoints?: readonly ConnectorWaypoint[];
}

export interface GenericEdgeSemantic extends ConnectorRoutingSemantic {
  readonly from: ElementId;
  readonly to: ElementId;
  readonly label?: string;
  readonly arrowheads?: Arrowheads;
  readonly prototype?: boolean;
  readonly prototypeAction?: PrototypeAction;
  readonly prototypeTrigger?: PrototypeTrigger;
  readonly prototypeDelay?: number;
  readonly prototypeTransition?: PrototypeTransition;
  readonly prototypeDuration?: number;
  readonly prototypeOverlayPosition?: PrototypeOverlayPosition;
  readonly prototypeOverlayX?: number;
  readonly prototypeOverlayY?: number;
  readonly prototypeOverlayBackdrop?: boolean;
  readonly prototypeOverlayDismiss?: boolean;
}

export interface ErdColumn {
  readonly id: string;
  readonly name: string;
  readonly dataType: string;
  readonly pk?: boolean;
  readonly nullable?: boolean;
  /** Portable SQL expression emitted after DEFAULT when it is safe. */
  readonly defaultExpression?: string;
  /** Portable computed expression emitted as a stored generated column. */
  readonly generatedExpression?: string;
}

export interface ErdIndex {
  readonly id: string;
  readonly name?: string;
  /** Stable column ids, in index-key order. */
  readonly columns: readonly string[];
  readonly unique?: boolean;
}

export interface ErdCheckConstraint {
  readonly id: string;
  readonly name?: string;
  /** Portable SQL predicate, without the surrounding CHECK parentheses. */
  readonly expression: string;
}

export interface ErdTableSemantic {
  readonly tableName: string;
  readonly columns: readonly ErdColumn[];
  readonly indexes?: readonly ErdIndex[];
  readonly checks?: readonly ErdCheckConstraint[];
}

/** Column-anchored endpoint; `column` omitted means "the table as a whole". */
export interface ErdEndpoint {
  readonly table: ElementId;
  /** Legacy/compact spelling for one anchored foreign-key column. */
  readonly column?: string;
  /** Ordered columns for a composite foreign-key endpoint. */
  readonly columns?: readonly string[];
}

/** Read either endpoint spelling as one ordered column list. */
export function erdEndpointColumnIds(endpoint: ErdEndpoint): readonly string[] {
  return endpoint.columns?.length
    ? endpoint.columns
    : endpoint.column
      ? [endpoint.column]
      : [];
}

export interface ErdRelationSemantic extends ConnectorRoutingSemantic {
  readonly from: ErdEndpoint;
  readonly to: ErdEndpoint;
  readonly cardinality: Cardinality;
  /** Action applied to dependent rows when the referenced key is deleted. */
  readonly onDelete?: ReferentialAction;
  /** Action applied to dependent rows when the referenced key is updated. */
  readonly onUpdate?: ReferentialAction;
  /** Transaction-time enforcement for engines that support deferred keys. */
  readonly deferrability?: ForeignKeyDeferrability;
  readonly label?: string;
}

export interface UmlAttribute {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
  readonly visibility?: UmlVisibility;
  readonly static?: boolean;
}

export interface UmlParameter {
  readonly name: string;
  readonly type?: string;
}

export interface UmlMethod {
  readonly id: string;
  readonly name: string;
  readonly parameters?: readonly UmlParameter[];
  readonly returnType?: string;
  readonly visibility?: UmlVisibility;
  readonly static?: boolean;
  readonly abstract?: boolean;
}

export interface UmlClassSemantic {
  readonly name: string;
  readonly stereotype?: string;
  readonly attributes: readonly UmlAttribute[];
  readonly methods: readonly UmlMethod[];
}

export interface UmlCardinalities {
  readonly from?: string;
  readonly to?: string;
}

export interface UmlAssociationSemantic extends ConnectorRoutingSemantic {
  readonly from: ElementId;
  readonly to: ElementId;
  readonly kind: UmlAssociationKind;
  readonly cardinalities?: UmlCardinalities;
  readonly label?: string;
}

export interface SequenceParticipantSemantic {
  readonly name: string;
  readonly kind: ParticipantKind;
  /** Fractional key; maps to the X axis. Never a pixel coordinate. */
  readonly order: FractionalIndex;
}

export interface SequenceMessageSemantic {
  readonly from: ElementId;
  readonly to: ElementId;
  /** Fractional key; maps to the Y axis. Never a pixel coordinate. */
  readonly order: FractionalIndex;
  readonly label?: string;
  readonly kind: MessageKind;
}

export interface SequenceActivationSemantic {
  readonly participant: ElementId;
  readonly fromOrder: FractionalIndex;
  readonly toOrder: FractionalIndex;
}

/** Raw input sample; variable-width outline geometry remains derived. */
export interface FreehandPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly controlIn?: { readonly x: number; readonly y: number };
  readonly controlOut?: { readonly x: number; readonly y: number };
}

export interface FreehandSemantic {
  readonly points: readonly FreehandPoint[];
  readonly closed?: boolean;
}

export const PATH_FILL_RULES = ["nonzero", "evenodd"] as const;
export type PathFillRule = (typeof PATH_FILL_RULES)[number];

/** One editable closed contour in a compound vector path. */
export interface PathContour {
  readonly points: readonly FreehandPoint[];
}

/** Portable vector geometry supporting holes and disconnected islands. */
export interface PathSemantic {
  readonly name?: string;
  readonly contours: readonly PathContour[];
  readonly fillRule: PathFillRule;
}

export interface GeoShapeSemantic {
  readonly geo: GeoKind;
  readonly label?: string;
}

/** Offsets are UTF-16 code unit indices into `text`, half-open [start, end). */
export interface TextMark {
  readonly start: number;
  readonly end: number;
  readonly kind: TextMarkKind;
  readonly href?: string;
}

export interface TextNoteSemantic {
  readonly text: string;
  readonly marks?: readonly TextMark[];
}

export interface ReviewCommentMessage {
  /** Stable identity keeps replies mergeable in collaborative documents. */
  readonly id: string;
  readonly author: string;
  readonly body: string;
  /** ISO-8601 timestamp supplied by the authoring client. */
  readonly createdAt: string;
}

/** A page-space review thread. Its visual x/y is the durable pin position. */
export interface ReviewCommentSemantic {
  /** Optional contextual layer; deleting it detaches rather than loses feedback. */
  readonly target?: ElementId;
  readonly resolved?: boolean;
  readonly messages: readonly ReviewCommentMessage[];
}

/** Complete reusable typography; applying one produces deterministic literals. */
export interface TypographyStyleValue {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontStyle: "normal" | "italic";
  readonly fontVariations?: readonly FontVariationAxis[];
  readonly fontFeatures?: readonly FontFeatureSetting[];
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly textAlign: "start" | "middle" | "end";
  readonly textDecoration:
    | "none"
    | "underline"
    | "line-through"
    | "underline line-through";
  readonly verticalAlign: "top" | "middle" | "bottom";
}

export interface TextStyleSemantic {
  readonly name: string;
  readonly value: TypographyStyleValue;
}

export interface FrameLayout {
  readonly direction: "horizontal" | "vertical";
  readonly gap: number;
  /** Wrap overflowing children into additional rows or columns. */
  readonly wrap?: boolean;
  /** Spacing between wrapped rows or columns; defaults to gap. */
  readonly crossGap?: number;
  readonly padding: number;
  readonly paddingTop?: number;
  readonly paddingRight?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
  readonly sizing: "fixed" | "hug";
  /** Optional per-axis overrides; omitted axes retain legacy sizing behavior. */
  readonly widthSizing?: "fixed" | "hug";
  readonly heightSizing?: "fixed" | "hug";
  readonly align: "start" | "center" | "end" | "stretch";
  readonly justify?: "start" | "center" | "end" | "space-between";
}

export interface SquareLayoutGrid {
  /** Stable item identity enables field-level collaboration and reordering. */
  readonly id: string;
  readonly kind: "grid";
  /** Distance between adjacent grid lines in canvas units. */
  readonly size: number;
  readonly color: string;
  readonly opacity: number;
  readonly visible?: boolean;
}

export interface AxisLayoutGrid {
  /** Stable item identity enables field-level collaboration and reordering. */
  readonly id: string;
  readonly kind: "columns" | "rows";
  readonly count: number;
  readonly gutter: number;
  readonly margin: number;
  readonly color: string;
  readonly opacity: number;
  readonly visible?: boolean;
}

/** Editor-only construction guides. They never appear in preview or export. */
export type LayoutGrid = SquareLayoutGrid | AxisLayoutGrid;

export const FRAME_PLATFORMS = ["web", "ios", "android", "document"] as const;
export type FramePlatform = (typeof FRAME_PLATFORMS)[number];

/** Editor-space insets for content that must avoid device system UI. */
export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Omitted memberIds retains legacy geometric containment. */
export interface ComponentVariantProperty {
  /** Stable identity for field-granular collaboration inside this definition. */
  readonly id: string;
  readonly name: string;
  readonly value: string;
}

export interface FrameSemantic {
  readonly name: string;
  /** Target platform informs presets and generated implementation handoff. */
  readonly platform?: FramePlatform;
  /** Editor-only safe content boundary; never painted into exports. */
  readonly safeArea?: SafeAreaInsets;
  /** Source artboard for refreshable cross-viewport content/style inheritance. */
  readonly responsiveSource?: ElementId;
  readonly showTitle?: boolean;
  /** Clip descendants to the frame's exact transformed outline. */
  readonly clipContent?: boolean;
  readonly component?: boolean;
  /** Named family/state for component definitions. */
  readonly variantSet?: string;
  readonly variantName?: string;
  /** Multi-dimensional component state, for example State=Hover, Size=Large. */
  readonly variantProperties?: readonly ComponentVariantProperty[];
  readonly prototypeStart?: boolean;
  /** Preview-only viewport scrolling; omitted is a fixed viewport. */
  readonly prototypeOverflow?: PrototypeOverflow;
  readonly instanceOf?: ElementId;
  readonly autoRefresh?: boolean;
  /** Component text/style/geometry or responsive text/style refresh tracking. */
  readonly instanceBindings?: readonly {
    readonly source?: ElementId;
    readonly target?: ElementId;
    /** JSON snapshot used only for comparisons, never as replacement content. */
    readonly baseline: string;
  }[];
  readonly memberIds?: readonly ElementId[];
  readonly layout?: FrameLayout;
  readonly layoutGrids?: readonly LayoutGrid[];
}

export const BOOLEAN_OPERATIONS = [
  "union",
  "subtract",
  "intersect",
  "exclude",
] as const;
export type BooleanOperation = (typeof BOOLEAN_OPERATIONS)[number];

export interface GroupSemantic {
  readonly memberIds: readonly ElementId[];
  /** One member whose visible geometry clips the other members. */
  readonly maskId?: ElementId;
  /** Non-destructive ordered combination of the members' visible outlines. */
  readonly booleanOperation?: BooleanOperation;
  /** Force a compositing boundary while retaining ordinary member geometry. */
  readonly isolate?: boolean;
}

export interface ImageSemantic {
  readonly src: string;
  readonly alt: string;
  readonly fit?: "contain" | "cover" | "fill";
  /** Normalized, non-destructive source rectangle. Fit is ignored when set. */
  readonly crop?: ImageCrop;
}

export interface ImageCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Maps every registered element type to its semantic payload type. */
export interface SemanticByType {
  "design.token": DesignTokenSemantic;
  "design.guide": PageGuideSemantic;
  "image.raster": ImageSemantic;
  "node.generic": GenericNodeSemantic;
  "edge.generic": GenericEdgeSemantic;
  "erd.table": ErdTableSemantic;
  "erd.relation": ErdRelationSemantic;
  "uml.class": UmlClassSemantic;
  "uml.association": UmlAssociationSemantic;
  "sequence.participant": SequenceParticipantSemantic;
  "sequence.message": SequenceMessageSemantic;
  "sequence.activation": SequenceActivationSemantic;
  "draw.freehand": FreehandSemantic;
  "draw.path": PathSemantic;
  "shape.geo": GeoShapeSemantic;
  "text.note": TextNoteSemantic;
  "review.comment": ReviewCommentSemantic;
  "design.text-style": TextStyleSemantic;
  frame: FrameSemantic;
  group: GroupSemantic;
}

export type ElementType = keyof SemanticByType;

export interface ColorTokenMode {
  readonly name: string;
  readonly value?: string;
  readonly alias?: ElementId;
}

export interface NumberTokenMode {
  readonly name: string;
  readonly value?: number;
  readonly alias?: ElementId;
}

export interface ColorTokenSemantic {
  readonly name: string;
  readonly kind: "color";
  /** Portable Default-mode fallback, retained even when an alias is broken. */
  readonly value: string;
  readonly alias?: ElementId;
  readonly modes?: readonly ColorTokenMode[];
}

/** A reusable non-negative design measurement, expressed in page/CSS pixels. */
export interface NumberTokenSemantic {
  readonly name: string;
  readonly kind: "number";
  /** Portable Default-mode fallback, retained even when an alias is broken. */
  readonly value: number;
  readonly alias?: ElementId;
  readonly modes?: readonly NumberTokenMode[];
}

export type DesignTokenSemantic = ColorTokenSemantic | NumberTokenSemantic;
