// The tool palette.
//
// A tool is a string so it can be held in a plain signal and compared
// without allocation. Creation tools name what they place; `select`,
// `hand` and `edge` name a gesture instead.

import { FRAME_PRESETS } from "@diagra/core";
import type { GeoKind, ParticipantKind, Visual } from "@diagra/ir";

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

/** What a tool places on click, or `null` for the gesture tools. */
export function creationFor(tool: ToolKind): CreationTool | null {
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
