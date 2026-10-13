// The tool palette.
//
// A tool is a string so it can be held in a plain signal and compared
// without allocation. Creation tools name what they place; `select`,
// `hand` and `edge` name a gesture instead.

import { FRAME_PRESETS } from "@nodetto/core";
import type { GeoKind, ParticipantKind, Visual } from "@nodetto/ir";

export const GEO_TOOLS = [
  "geo:rect",
  "geo:ellipse",
  "geo:diamond",
  "geo:triangle",
  "geo:hexagon",
  "geo:parallelogram",
  "geo:cylinder",
  "geo:star",
] as const;

export const BPMN_TOOLS = [
  "bpmn:pool",
  "bpmn:pool-collapsed",
  "bpmn:lane",
  "bpmn:task",
  "bpmn:user-task",
  "bpmn:service-task",
  "bpmn:start-event",
  "bpmn:message-catch",
  "bpmn:message-throw",
  "bpmn:timer-catch",
  "bpmn:end-event",
  "bpmn:exclusive-gateway",
  "bpmn:parallel-gateway",
  "bpmn:sub-process",
  "bpmn:sub-process-expanded",
  "bpmn:call-activity",
  "bpmn:data-object",
  "bpmn:data-store",
  "bpmn:text-annotation",
  "bpmn:group",
] as const;

export type BpmnToolKind = (typeof BPMN_TOOLS)[number];

export const TOOLS = [
  "select",
  "hand",
  "comment",
  "draw.freehand",
  "edit.points",
  "edit.paint",
  "edit.stroke-paint",
  "crop",
  "edge",
  "node.generic",
  "text.note",
  "erd.table",
  "uml.class",
  "sequence.actor",
  "sequence.service",
  "sequence.database",
  "frame:web",
  "frame:iphone",
  "frame:android",
  "frame:tablet",
  "frame:paper",
  ...GEO_TOOLS,
  ...BPMN_TOOLS,
] as const;

export type ToolKind = (typeof TOOLS)[number];

export function canUseTool(tool: ToolKind, readOnly: boolean): boolean {
  return !readOnly || tool === "select" || tool === "hand";
}

export interface CreationTool {
  readonly type: string;
  /** Semantic overrides; `undefined` means "use the ShapeUtil default". */
  readonly semantic?: unknown;
  readonly visual?: Visual;
}

const BPMN_CREATIONS: Readonly<Record<BpmnToolKind, CreationTool>> = {
  "bpmn:pool": {
    type: "bpmn.participant",
    semantic: { name: "Pool", collapsed: false },
    visual: { width: 600, height: 250 },
  },
  "bpmn:pool-collapsed": {
    type: "bpmn.participant",
    semantic: { name: "Pool", collapsed: true },
    visual: { width: 600, height: 60 },
  },
  "bpmn:lane": { type: "bpmn.lane" },
  "bpmn:task": {
    type: "bpmn.task",
    semantic: { name: "Task", taskType: "none", loop: "none" },
  },
  "bpmn:user-task": {
    type: "bpmn.task",
    semantic: { name: "Task", taskType: "user", loop: "none" },
  },
  "bpmn:service-task": {
    type: "bpmn.task",
    semantic: { name: "Task", taskType: "service", loop: "none" },
  },
  "bpmn:start-event": {
    type: "bpmn.event",
    semantic: { name: "", position: "start", definitions: [] },
  },
  "bpmn:message-catch": {
    type: "bpmn.event",
    semantic: {
      name: "",
      position: "intermediateCatch",
      definitions: [{ id: "def-1", kind: "message" }],
    },
  },
  "bpmn:message-throw": {
    type: "bpmn.event",
    semantic: {
      name: "",
      position: "intermediateThrow",
      definitions: [{ id: "def-1", kind: "message" }],
    },
  },
  "bpmn:timer-catch": {
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
  "bpmn:end-event": {
    type: "bpmn.event",
    semantic: { name: "", position: "end", definitions: [] },
  },
  "bpmn:exclusive-gateway": {
    type: "bpmn.gateway",
    semantic: { name: "", gatewayType: "exclusive" },
  },
  "bpmn:parallel-gateway": {
    type: "bpmn.gateway",
    semantic: { name: "", gatewayType: "parallel" },
  },
  "bpmn:sub-process": {
    type: "bpmn.subProcess",
    semantic: {
      name: "Sub-process",
      expanded: false,
      triggeredByEvent: false,
      adHoc: false,
      loop: "none",
    },
  },
  "bpmn:sub-process-expanded": {
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
  "bpmn:call-activity": {
    type: "bpmn.callActivity",
    semantic: { name: "Call activity", loop: "none" },
  },
  "bpmn:data-object": {
    type: "bpmn.dataObject",
    semantic: { name: "Data object", role: "reference", collection: false },
  },
  "bpmn:data-store": {
    type: "bpmn.dataStore",
    semantic: { name: "Data store" },
  },
  "bpmn:text-annotation": {
    type: "bpmn.textAnnotation",
    semantic: { text: "" },
  },
  "bpmn:group": { type: "bpmn.group", semantic: { name: "" } },
};

/** What a tool places on click, or `null` for the gesture tools. */
export function creationFor(tool: ToolKind): CreationTool | null {
  if ((BPMN_TOOLS as readonly string[]).includes(tool)) {
    return BPMN_CREATIONS[tool as BpmnToolKind];
  }
  if (tool.startsWith("frame:")) {
    const preset = FRAME_PRESETS[tool.slice(6) as keyof typeof FRAME_PRESETS];
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
  if (tool.startsWith("geo:")) {
    return {
      type: "shape.geo",
      semantic: { geo: tool.slice("geo:".length) as GeoKind, label: "" },
    };
  }
  if (tool.startsWith("sequence.")) {
    const kind: Readonly<Record<string, ParticipantKind>> = {
      "sequence.actor": "actor",
      "sequence.service": "service",
      "sequence.database": "db",
    };
    return {
      type: "sequence.participant",
      // The interaction replaces order/name through the editor's
      // sequence-aware creation API; this payload only carries tool intent.
      semantic: { kind: kind[tool] ?? "service" },
    };
  }
  if (
    tool === "node.generic" ||
    tool === "text.note" ||
    tool === "erd.table" ||
    tool === "uml.class"
  ) {
    return { type: tool };
  }
  return null;
}
