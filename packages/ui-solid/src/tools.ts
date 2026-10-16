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
  BpmnPool: "bpmn:pool",
  BpmnPoolCollapsed: "bpmn:pool-collapsed",
  BpmnLane: "bpmn:lane",
  BpmnTask: "bpmn:task",
  BpmnUserTask: "bpmn:user-task",
  BpmnServiceTask: "bpmn:service-task",
  BpmnStartEvent: "bpmn:start-event",
  BpmnMessageCatch: "bpmn:message-catch",
  BpmnMessageThrow: "bpmn:message-throw",
  BpmnTimerCatch: "bpmn:timer-catch",
  BpmnEndEvent: "bpmn:end-event",
  BpmnExclusiveGateway: "bpmn:exclusive-gateway",
  BpmnParallelGateway: "bpmn:parallel-gateway",
  BpmnSubProcess: "bpmn:sub-process",
  BpmnSubProcessExpanded: "bpmn:sub-process-expanded",
  BpmnCallActivity: "bpmn:call-activity",
  BpmnDataObject: "bpmn:data-object",
  BpmnDataStore: "bpmn:data-store",
  BpmnTextAnnotation: "bpmn:text-annotation",
  BpmnGroup: "bpmn:group",

  Select: "select",
  Hand: "hand",
  Comment: "comment",
  Freehand: "draw.freehand",
  EditPoints: "edit.points",
  EditFill: "edit.paint",
  EditStroke: "edit.stroke-paint",
  Crop: "crop",
  Connector: "edge",
  ForeignKey: "erd.foreign-key",
  Association: "uml.association",
  SequenceMessage: "sequence.message",
  Node: "node.generic",
  Text: "text.note",
  Note: "text.note:note",
  Table: "erd.table",
  View: "erd.view",
  MaterializedView: "erd.materialized-view",
  Function: "erd.function",
  Procedure: "erd.procedure",
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

export const BPMN_TOOLS = [
  Tool.BpmnPool,
  Tool.BpmnPoolCollapsed,
  Tool.BpmnLane,
  Tool.BpmnTask,
  Tool.BpmnUserTask,
  Tool.BpmnServiceTask,
  Tool.BpmnStartEvent,
  Tool.BpmnMessageCatch,
  Tool.BpmnMessageThrow,
  Tool.BpmnTimerCatch,
  Tool.BpmnEndEvent,
  Tool.BpmnExclusiveGateway,
  Tool.BpmnParallelGateway,
  Tool.BpmnSubProcess,
  Tool.BpmnSubProcessExpanded,
  Tool.BpmnCallActivity,
  Tool.BpmnDataObject,
  Tool.BpmnDataStore,
  Tool.BpmnTextAnnotation,
  Tool.BpmnGroup,
] as const;
export type BpmnToolKind = (typeof BPMN_TOOLS)[number];

const BPMN_CREATIONS: Readonly<Record<BpmnToolKind, CreationTool>> = {
  [Tool.BpmnPool]: {
    type: "bpmn.participant",
    semantic: { name: "Pool", collapsed: false },
    visual: { width: 600, height: 250 },
  },
  [Tool.BpmnPoolCollapsed]: {
    type: "bpmn.participant",
    semantic: { name: "Pool", collapsed: true },
    visual: { width: 600, height: 60 },
  },
  [Tool.BpmnLane]: { type: "bpmn.lane" },
  [Tool.BpmnTask]: {
    type: "bpmn.task",
    semantic: { name: "Task", taskType: "none", loop: "none" },
  },
  [Tool.BpmnUserTask]: {
    type: "bpmn.task",
    semantic: { name: "Task", taskType: "user", loop: "none" },
  },
  [Tool.BpmnServiceTask]: {
    type: "bpmn.task",
    semantic: { name: "Task", taskType: "service", loop: "none" },
  },
  [Tool.BpmnStartEvent]: {
    type: "bpmn.event",
    semantic: { name: "", position: "start", definitions: [] },
  },
  [Tool.BpmnMessageCatch]: {
    type: "bpmn.event",
    semantic: {
      name: "",
      position: "intermediateCatch",
      definitions: [{ id: "def-1", kind: "message" }],
    },
  },
  [Tool.BpmnMessageThrow]: {
    type: "bpmn.event",
    semantic: {
      name: "",
      position: "intermediateThrow",
      definitions: [{ id: "def-1", kind: "message" }],
    },
  },
  [Tool.BpmnTimerCatch]: {
    type: "bpmn.event",
    semantic: {
      name: "",
      position: "intermediateCatch",
      definitions: [
        {
          id: "def-1",
          kind: "timer",
          timer: { type: "duration", value: "PT1H" },
        },
      ],
    },
  },
  [Tool.BpmnEndEvent]: {
    type: "bpmn.event",
    semantic: { name: "", position: "end", definitions: [] },
  },
  [Tool.BpmnExclusiveGateway]: {
    type: "bpmn.gateway",
    semantic: { name: "", gatewayType: "exclusive" },
  },
  [Tool.BpmnParallelGateway]: {
    type: "bpmn.gateway",
    semantic: { name: "", gatewayType: "parallel" },
  },
  [Tool.BpmnSubProcess]: {
    type: "bpmn.subProcess",
    semantic: {
      name: "Sub-process",
      expanded: false,
      triggeredByEvent: false,
      adHoc: false,
      loop: "none",
    },
  },
  [Tool.BpmnSubProcessExpanded]: {
    type: "bpmn.subProcess",
    semantic: {
      name: "Sub-process",
      expanded: true,
      triggeredByEvent: false,
      adHoc: false,
      loop: "none",
    },
    visual: { width: 350, height: 200 },
  },
  [Tool.BpmnCallActivity]: {
    type: "bpmn.callActivity",
    semantic: { name: "Call activity", loop: "none" },
  },
  [Tool.BpmnDataObject]: {
    type: "bpmn.dataObject",
    semantic: { name: "Data object", role: "reference", collection: false },
  },
  [Tool.BpmnDataStore]: {
    type: "bpmn.dataStore",
    semantic: { name: "Data store" },
  },
  [Tool.BpmnTextAnnotation]: {
    type: "bpmn.textAnnotation",
    semantic: { text: "" },
  },
  [Tool.BpmnGroup]: { type: "bpmn.group", semantic: { name: "" } },
};

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
  Exclude<Extract<ToolKind, `sequence.${string}`>, typeof Tool.SequenceMessage>,
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
    case Tool.BpmnPool:
    case Tool.BpmnPoolCollapsed:
    case Tool.BpmnLane:
    case Tool.BpmnTask:
    case Tool.BpmnUserTask:
    case Tool.BpmnServiceTask:
    case Tool.BpmnStartEvent:
    case Tool.BpmnMessageCatch:
    case Tool.BpmnMessageThrow:
    case Tool.BpmnTimerCatch:
    case Tool.BpmnEndEvent:
    case Tool.BpmnExclusiveGateway:
    case Tool.BpmnParallelGateway:
    case Tool.BpmnSubProcess:
    case Tool.BpmnSubProcessExpanded:
    case Tool.BpmnCallActivity:
    case Tool.BpmnDataObject:
    case Tool.BpmnDataStore:
    case Tool.BpmnTextAnnotation:
    case Tool.BpmnGroup:
      return BPMN_CREATIONS[tool];

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
    case Tool.Note:
      return {
        type: "text.note",
        semantic: { text: "Note" },
        visual: { width: 200, height: 140, style: { fill: "#fff1c9" } },
      };
    case Tool.Node:
    case Tool.Text:
    case Tool.Table:
    case Tool.View:
    case Tool.MaterializedView:
    case Tool.Function:
    case Tool.Procedure:
    case Tool.Class:
      return { type: tool };
    case Tool.Select:
    case Tool.Hand:
    case Tool.Comment:
    case Tool.Connector:
    case Tool.ForeignKey:
    case Tool.Association:
    case Tool.SequenceMessage:
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
    tool === Tool.Connector ||
    typedConnectorFor(tool) !== undefined ||
    componentRelationshipFor(tool) !== undefined
  );
}

export function typedConnectorFor(tool: ToolKind): string | undefined {
  if (tool === Tool.ForeignKey) return "erd.relation";
  if (tool === Tool.Association) return "uml.association";
  if (tool === Tool.SequenceMessage) return "sequence.message";
  return undefined;
}
