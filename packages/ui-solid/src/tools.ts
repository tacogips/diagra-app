import {
  UmlComponentType,
  UmlComponentRelationship,
  type UmlComponentRelationshipKind,
} from "@nodetto/ir";
// One catalogue defines the supported tools, their named values, and ToolKind.
// String literal values preserve existing tool IDs.

import { FRAME_PRESETS } from "@nodetto/core";
import type { GeoKind, ParticipantKind, Visual } from "@nodetto/ir";

export const Tool = {
  Select: "select",
  Hand: "hand",
  Comment: "comment",
  Freehand: "draw.freehand",
  EditPoints: "edit.points",
  EditFill: "edit.paint",
  EditStroke: "edit.stroke-paint",
  Crop: "crop",
  Connector: "edge",
  Node: "node.generic",
  Text: "text.note",
  Table: "erd.table",
  Class: "uml.class",
  Component: UmlComponentType.Component,
  ProvidedInterface: "uml.interface:provided",
  RequiredInterface: "uml.interface:required",
  Port: UmlComponentType.Port,
  Dependency: "uml.component:dependency",
  Realization: "uml.component:realization",
  ComponentConnector: "uml.component:connector",
  Actor: "sequence.actor",
  Service: "sequence.service",
  Database: "sequence.database",
  Frame: "frame",
  WebFrame: "frame:web",
  IPhoneFrame: "frame:iphone",
  AndroidFrame: "frame:android",
  TabletFrame: "frame:tablet",
  PaperFrame: "frame:paper",
  Rectangle: "geo:rect",
  Ellipse: "geo:ellipse",
  Diamond: "geo:diamond",
  Triangle: "geo:triangle",
  Hexagon: "geo:hexagon",
  Parallelogram: "geo:parallelogram",
  Cylinder: "geo:cylinder",
  Star: "geo:star",
} as const;

/** A closed union: only values declared in Tool are valid tools. */
export type ToolKind = (typeof Tool)[keyof typeof Tool];
export const TOOLS: readonly ToolKind[] = Object.values(Tool);
export const GEO_TOOLS = [
  Tool.Rectangle,
  Tool.Ellipse,
  Tool.Diamond,
  Tool.Triangle,
  Tool.Hexagon,
  Tool.Parallelogram,
  Tool.Cylinder,
  Tool.Star,
] as const;

const GEO_KINDS = {
  [Tool.Rectangle]: "rect",
  [Tool.Ellipse]: "ellipse",
  [Tool.Diamond]: "diamond",
  [Tool.Triangle]: "triangle",
  [Tool.Hexagon]: "hexagon",
  [Tool.Parallelogram]: "parallelogram",
  [Tool.Cylinder]: "cylinder",
  [Tool.Star]: "star",
} as const satisfies Record<(typeof GEO_TOOLS)[number], GeoKind>;

const FRAME_KINDS = {
  [Tool.WebFrame]: "web",
  [Tool.IPhoneFrame]: "iphone",
  [Tool.AndroidFrame]: "android",
  [Tool.TabletFrame]: "tablet",
  [Tool.PaperFrame]: "paper",
} as const satisfies Record<
  Extract<ToolKind, `frame:${string}`>,
  keyof typeof FRAME_PRESETS
>;

const PARTICIPANT_KINDS = {
  [Tool.Actor]: "actor",
  [Tool.Service]: "service",
  [Tool.Database]: "db",
} as const satisfies Record<
  Extract<ToolKind, `sequence.${string}`>,
  ParticipantKind
>;

export function canUseTool(tool: ToolKind, readOnly: boolean): boolean {
  return !readOnly || tool === Tool.Select || tool === Tool.Hand;
}

export interface CreationTool {
  readonly type: string;
  /** Semantic overrides; `undefined` means "use the ShapeUtil default". */
  readonly semantic?: unknown;
  readonly visual?: Visual;
}

/** Exhaustive so adding a tool requires deciding its placement behavior. */
export function creationFor(tool: ToolKind): CreationTool | null {
  switch (tool) {
    case Tool.Component:
      return { type: UmlComponentType.Component };
    case Tool.ProvidedInterface:
    case Tool.RequiredInterface:
      return {
        type: UmlComponentType.Interface,
        semantic: {
          name: "Interface",
          kind: tool === Tool.ProvidedInterface ? "provided" : "required",
        },
      };
    case Tool.Port:
      return { type: UmlComponentType.Port };
    case Tool.Frame:
      return {
        type: "frame",
        semantic: { name: "Frame" },
        visual: {
          width: 320,
          height: 220,
          style: { fill: "none", stroke: "#64748b", strokeWidth: 1.5 },
        },
      };
    case Tool.WebFrame:
    case Tool.IPhoneFrame:
    case Tool.AndroidFrame:
    case Tool.TabletFrame:
    case Tool.PaperFrame: {
      const preset = FRAME_PRESETS[FRAME_KINDS[tool]];
      const safeArea = "safeArea" in preset ? preset.safeArea : undefined;
      return {
        type: "frame",
        semantic: {
          name: preset.name,
          platform: preset.platform,
          ...(safeArea ? { safeArea } : {}),
        },
        visual: { width: preset.width, height: preset.height },
      };
    }
    case Tool.Rectangle:
    case Tool.Ellipse:
    case Tool.Diamond:
    case Tool.Triangle:
    case Tool.Hexagon:
    case Tool.Parallelogram:
    case Tool.Cylinder:
    case Tool.Star:
      return {
        type: "shape.geo",
        semantic: { geo: GEO_KINDS[tool], label: "" },
      };
    case Tool.Actor:
    case Tool.Service:
    case Tool.Database:
      return {
        type: "sequence.participant",
        // Sequence-aware creation supplies the participant's order and name.
        semantic: { kind: PARTICIPANT_KINDS[tool] },
      };
    case Tool.Node:
    case Tool.Text:
    case Tool.Table:
    case Tool.Class:
      return { type: tool };
    case Tool.Select:
    case Tool.Hand:
    case Tool.Comment:
    case Tool.Connector:
    case Tool.Dependency:
    case Tool.Realization:
    case Tool.ComponentConnector:
    case Tool.Freehand:
    case Tool.EditPoints:
    case Tool.EditFill:
    case Tool.EditStroke:
    case Tool.Crop:
      return null;
    default: {
      const unsupported: never = tool;
      throw new Error(`Unsupported tool: ${unsupported}`);
    }
  }
}

export function componentRelationshipFor(
  tool: ToolKind,
): UmlComponentRelationshipKind | undefined {
  switch (tool) {
    case Tool.Dependency:
      return UmlComponentRelationship.Dependency;
    case Tool.Realization:
      return UmlComponentRelationship.Realization;
    case Tool.ComponentConnector:
      return UmlComponentRelationship.Connector;
    default:
      return undefined;
  }
}
export function isConnectorTool(tool: ToolKind): boolean {
  return (
    tool === Tool.Connector || componentRelationshipFor(tool) !== undefined
  );
}
