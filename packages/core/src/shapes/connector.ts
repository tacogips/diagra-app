// Shared geometry for every edge-like element type.
//
// A connector owns no box of its own: it is drawn between the boundaries of
// the two elements it references, so its geometry is recomputed whenever
// either endpoint moves. When an endpoint cannot be resolved the connector
// has no geometry at all and every query answers "nothing here" — the
// renderer draws nothing rather than a line to the origin.

import type { Element, ElementId } from "@diagra/ir";
import {
  type Box,
  boxCenter,
  distanceToSegment,
  rectBoundaryIntersection,
  unionBoxes,
  type Vec,
} from "../geometry.ts";
import type { ShapeContext, ShapeUtil } from "../shape-util.ts";

/** Screen-space pick tolerance for a connector, in CSS pixels. */
export const CONNECTOR_HIT_TOLERANCE = 8;

export interface ConnectorEndpoints {
  readonly start: Vec;
  readonly end: Vec;
  readonly fromBox: Box;
  readonly toBox: Box;
}

/** Reads the two referenced element ids out of a semantic payload. */
export type EndpointReader = (
  semantic: unknown,
) => { readonly from: ElementId; readonly to: ElementId } | null;

/**
 * Where the line between two boxes meets each box's border. Self-connections
 * are not modelled in phase 0, so identical boxes simply collapse to their
 * shared centre.
 */
export function connectorEndpoints(
  fromBox: Box,
  toBox: Box,
): ConnectorEndpoints {
  const fromCenter = boxCenter(fromBox);
  const toCenter = boxCenter(toBox);
  return {
    start: rectBoundaryIntersection(fromCenter, toCenter, fromBox),
    end: rectBoundaryIntersection(toCenter, fromCenter, toBox),
    fromBox,
    toBox,
  };
}

/**
 * Resolve a connector's endpoints through the shape registry, or `null` when
 * either referenced element is missing or has no bounds.
 */
export function resolveConnector(
  element: Element,
  context: ShapeContext,
  readEndpoints: EndpointReader,
): ConnectorEndpoints | null {
  const ids = readEndpoints(element.semantic);
  if (!ids) {
    return null;
  }
  const fromBox = context.boundsOf(ids.from);
  const toBox = context.boundsOf(ids.to);
  if (!fromBox || !toBox) {
    return null;
  }
  return connectorEndpoints(fromBox, toBox);
}

/**
 * A ShapeUtil for an element type whose geometry is entirely derived from
 * two referenced elements. `edge.generic`, `erd.relation` and
 * `uml.association` differ only in how the two ids are spelled.
 */
export function createConnectorUtil(options: {
  readonly type: string;
  readonly readEndpoints: EndpointReader;
  readonly defaultSemantic: () => unknown;
}): ShapeUtil {
  return {
    type: options.type,
    canResize: false,
    getBounds(element, context) {
      const resolved = resolveConnector(
        element,
        context,
        options.readEndpoints,
      );
      if (!resolved) {
        return null;
      }
      return unionBoxes([
        { x: resolved.start.x, y: resolved.start.y, width: 0, height: 0 },
        { x: resolved.end.x, y: resolved.end.y, width: 0, height: 0 },
      ]);
    },
    hitTest(element, point, context) {
      const resolved = resolveConnector(
        element,
        context,
        options.readEndpoints,
      );
      if (!resolved) {
        return false;
      }
      const tolerance = CONNECTOR_HIT_TOLERANCE / Math.max(context.zoom, 1e-6);
      return (
        distanceToSegment(point, resolved.start, resolved.end) <= tolerance
      );
    },
    defaultSemantic: options.defaultSemantic,
    defaultVisual() {
      return {};
    },
  };
}

/** Reads `{ from, to }` where both are plain element ids. */
export const readDirectEndpoints: EndpointReader = (semantic) => {
  if (typeof semantic !== "object" || semantic === null) {
    return null;
  }
  const record = semantic as Record<string, unknown>;
  const from = record["from"];
  const to = record["to"];
  if (typeof from !== "string" || typeof to !== "string") {
    return null;
  }
  return { from, to };
};

/** Reads `{ from: { table }, to: { table } }` as used by `erd.relation`. */
export const readTableEndpoints: EndpointReader = (semantic) => {
  if (typeof semantic !== "object" || semantic === null) {
    return null;
  }
  const record = semantic as Record<string, unknown>;
  const from = record["from"];
  const to = record["to"];
  const fromTable =
    typeof from === "object" && from !== null
      ? (from as Record<string, unknown>)["table"]
      : undefined;
  const toTable =
    typeof to === "object" && to !== null
      ? (to as Record<string, unknown>)["table"]
      : undefined;
  if (typeof fromTable !== "string" || typeof toTable !== "string") {
    return null;
  }
  return { from: fromTable, to: toTable };
};

/** Which endpoint spelling an element type uses. */
export function endpointReaderFor(type: string): EndpointReader {
  return type === "erd.relation" ? readTableEndpoints : readDirectEndpoints;
}

/** The line ends a connector is drawn with, independent of the renderer. */
export type MarkerKind =
  | "arrow"
  | "triangle"
  | "diamondOpen"
  | "diamondFilled"
  | "dot";

export interface ConnectorDecoration {
  readonly start: MarkerKind | null;
  readonly end: MarkerKind | null;
  readonly label: string;
}

function arrowheadMarker(head: unknown): MarkerKind | null {
  switch (head) {
    case "arrow":
      return "arrow";
    case "triangle":
      return "triangle";
    case "dot":
      return "dot";
    default:
      return null;
  }
}

function readField(source: unknown, field: string): unknown {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  return (source as Record<string, unknown>)[field];
}

function readString(source: unknown, field: string): string | undefined {
  const value = readField(source, field);
  return typeof value === "string" ? value : undefined;
}

/**
 * Markers and label text for one connector.
 *
 * The notation is per element type: an ERD relation gets a dot at each end
 * and shows its cardinality when it has no label of its own, a UML
 * association's kind picks the classic inheritance triangle or aggregation
 * diamond, and everything else reads `arrowheads` off the payload with a
 * plain arrow at the far end as the default.
 */
export function connectorDecoration(element: Element): ConnectorDecoration {
  const semantic = element.semantic;
  if (element.type === "erd.relation") {
    return {
      start: "dot",
      end: "dot",
      label:
        readString(semantic, "label") ??
        readString(semantic, "cardinality") ??
        "",
    };
  }
  if (element.type === "uml.association") {
    const label = readString(semantic, "label") ?? "";
    switch (readString(semantic, "kind")) {
      case "inherit":
        return { start: null, end: "triangle", label: "" };
      case "aggregate":
        return { start: "diamondOpen", end: null, label };
      case "compose":
        return { start: "diamondFilled", end: null, label };
      default:
        return { start: null, end: null, label };
    }
  }
  const arrowheads = readField(semantic, "arrowheads");
  return {
    start: arrowheadMarker(readField(arrowheads, "start")),
    end: arrowheadMarker(readField(arrowheads, "end") ?? "arrow"),
    label: readString(semantic, "label") ?? "",
  };
}
