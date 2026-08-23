// Semantic payloads for the v1 element type registry.
// See the product design (diagra-cloud repo), section 5.2.

import type { ElementId, FractionalIndex } from "./types.ts";

export const ARROWHEADS = ["none", "arrow", "triangle", "dot"] as const;
export type Arrowhead = (typeof ARROWHEADS)[number];

export const CARDINALITIES = ["1:1", "1:*", "*:1", "*:*"] as const;
export type Cardinality = (typeof CARDINALITIES)[number];

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

export interface GenericEdgeSemantic {
  readonly from: ElementId;
  readonly to: ElementId;
  readonly label?: string;
  readonly arrowheads?: Arrowheads;
}

export interface ErdColumn {
  readonly id: string;
  readonly name: string;
  readonly dataType: string;
  readonly pk?: boolean;
  readonly nullable?: boolean;
}

export interface ErdTableSemantic {
  readonly tableName: string;
  readonly columns: readonly ErdColumn[];
}

/** Column-anchored endpoint; `column` omitted means "the table as a whole". */
export interface ErdEndpoint {
  readonly table: ElementId;
  readonly column?: string;
}

export interface ErdRelationSemantic {
  readonly from: ErdEndpoint;
  readonly to: ErdEndpoint;
  readonly cardinality: Cardinality;
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

export interface UmlAssociationSemantic {
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

/** Raw input sample; the rendered outline is derived via perfect-freehand. */
export interface FreehandPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

export interface FreehandSemantic {
  readonly points: readonly FreehandPoint[];
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

/** Frame membership is implied by containment, so only the name is stored. */
export interface FrameSemantic {
  readonly name: string;
}

export interface GroupSemantic {
  readonly memberIds: readonly ElementId[];
}

/** Maps every registered element type to its semantic payload type. */
export interface SemanticByType {
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
  "shape.geo": GeoShapeSemantic;
  "text.note": TextNoteSemantic;
  frame: FrameSemantic;
  group: GroupSemantic;
}

export type ElementType = keyof SemanticByType;
