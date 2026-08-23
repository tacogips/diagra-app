// The tool palette.
//
// A tool is a string so it can be held in a plain signal and compared
// without allocation. Creation tools name what they place; `select`,
// `hand` and `edge` name a gesture instead.

import type { GeoKind } from "@diagra/ir";

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
  "edge",
  "node.generic",
  "erd.table",
  "uml.class",
  ...GEO_TOOLS,
] as const;

export type ToolKind = (typeof TOOLS)[number];

export interface CreationTool {
  readonly type: string;
  /** Semantic overrides; `undefined` means "use the ShapeUtil default". */
  readonly semantic?: unknown;
}

/** What a tool places on click, or `null` for the gesture tools. */
export function creationFor(tool: ToolKind): CreationTool | null {
  if (tool.startsWith("geo:")) {
    return {
      type: "shape.geo",
      semantic: { geo: tool.slice("geo:".length) as GeoKind, label: "" },
    };
  }
  if (tool === "node.generic" || tool === "erd.table" || tool === "uml.class") {
    return { type: tool };
  }
  return null;
}
