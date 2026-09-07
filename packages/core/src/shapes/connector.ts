// Shared geometry for every edge-like element type.
//
// A connector owns no box of its own: it is drawn between the boundaries of
// the two elements it references, so its geometry is recomputed whenever
// either endpoint moves. When an endpoint cannot be resolved the connector
// has no geometry at all and every query answers "nothing here" — the
// renderer draws nothing rather than a line to the origin.

import {
  type Element,
  type ElementId,
  type ConnectorWaypoint,
  erdEndpointColumnIds,
  type ErdEndpoint,
  type ErdTableSemantic,
  type FreehandSemantic,
  type GeoShapeSemantic,
  getElementTypeDefinition,
  MAX_CONNECTOR_WAYPOINTS,
} from "@diagra/ir";
import {
  type Box,
  boxCenter,
  distanceToSegment,
  ellipseBoundaryIntersection,
  rectBoundaryIntersection,
  rotatedBox,
  rotatePoint,
  unionBoxes,
  type Vec,
} from "../geometry.ts";
import { avoidOrthogonalObstacles } from "../orthogonal-routing.ts";
import { flattenStroke } from "../stroke-path.ts";
import type { ShapeContext, ShapeUtil } from "../shape-util.ts";
import { freehandGeometry } from "./freehand.ts";
import { ERD_TABLE_HEADER_HEIGHT, ERD_TABLE_ROW_HEIGHT } from "./erdTable.ts";
import { elementOutlinePolygon } from "./outline.ts";

/** Screen-space pick tolerance for a connector, in CSS pixels. */
export const CONNECTOR_HIT_TOLERANCE = 8;
export const CONNECTOR_OBSTACLE_CLEARANCE = 12;

export interface ConnectorEndpoints {
  readonly start: Vec;
  readonly end: Vec;
  /** Ordered route vertices, including both boundary endpoints. */
  readonly points: readonly Vec[];
  /** Halfway along route length, used by labels across every renderer. */
  readonly labelPoint: Vec;
  /** Preferred channel handle, even when obstacle avoidance adds detours. */
  readonly bendPoint?: Vec;
  readonly bendAxis?: "x" | "y";
  /** Decoded page-space positions for user-authored manual waypoints. */
  readonly waypointPoints?: readonly Vec[];
  readonly fromBox: Box;
  readonly toBox: Box;
}

function pointAlong(points: readonly Vec[], ratio: number): Vec {
  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index] as Vec;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  const target = lengths.reduce((sum, length) => sum + length, 0) * ratio;
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const from = points[index] as Vec;
    const to = points[index + 1] as Vec;
    if (travelled + length >= target && length > 0) {
      const at = (target - travelled) / length;
      return {
        x: from.x + (to.x - from.x) * at,
        y: from.y + (to.y - from.y) * at,
      };
    }
    travelled += length;
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}

function withRoute(
  start: Vec,
  end: Vec,
  fromBox: Box,
  toBox: Box,
  points: readonly Vec[] = [start, end],
  bend?: { readonly point: Vec; readonly axis: "x" | "y" },
  waypointPoints?: readonly Vec[],
): ConnectorEndpoints {
  const compact = points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1]?.x ||
      point.y !== points[index - 1]?.y,
  );
  return {
    start,
    end,
    points: compact,
    labelPoint: pointAlong(compact, 0.5),
    ...(bend ? { bendPoint: bend.point, bendAxis: bend.axis } : {}),
    ...(waypointPoints?.length ? { waypointPoints } : {}),
    fromBox,
    toBox,
  };
}

export function connectorWaypointToPage(
  waypoint: ConnectorWaypoint,
  from: Vec,
  to: Vec,
): Vec {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { x: from.x + waypoint.u, y: from.y + waypoint.v };
  return {
    x: from.x + waypoint.u * dx - (waypoint.v * dy) / length,
    y: from.y + waypoint.u * dy + (waypoint.v * dx) / length,
  };
}

export function connectorWaypointFromPage(
  point: Vec,
  from: Vec,
  to: Vec,
): ConnectorWaypoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-18)
    return {
      u: Math.round((point.x - from.x) * 100) / 100,
      v: Math.round((point.y - from.y) * 100) / 100,
    };
  const offsetX = point.x - from.x;
  const offsetY = point.y - from.y;
  return {
    u:
      Math.round(((offsetX * dx + offsetY * dy) / lengthSquared) * 1_000_000) /
      1_000_000,
    v:
      Math.round(
        ((offsetY * dx - offsetX * dy) / Math.sqrt(lengthSquared)) * 100,
      ) / 100,
  };
}

function projectedPointOnSegment(point: Vec, from: Vec, to: Vec): Vec {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-18) return from;
  const raw =
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  const at = Math.max(0, Math.min(1, raw));
  return { x: from.x + at * dx, y: from.y + at * dy };
}

/**
 * Insert the closest point on a connector route and encode every internal
 * vertex as portable manual waypoints. `authoredRoute` keeps duplicate or
 * collinear user points addressable; false preserves a generated route while
 * converting straight or orthogonal geometry to manual routing.
 */
export function connectorWaypointsWithInsertion(
  resolved: ConnectorEndpoints,
  point: Vec,
  authoredRoute: boolean,
): readonly ConnectorWaypoint[] | null {
  const route = authoredRoute
    ? [resolved.start, ...(resolved.waypointPoints ?? []), resolved.end]
    : resolved.points;
  if (route.length < 2 || route.length - 2 >= MAX_CONNECTOR_WAYPOINTS)
    return null;

  let segment = 0;
  let projected = route[0] as Vec;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length - 1; index += 1) {
    const candidate = projectedPointOnSegment(
      point,
      route[index] as Vec,
      route[index + 1] as Vec,
    );
    const nextDistance = Math.hypot(
      point.x - candidate.x,
      point.y - candidate.y,
    );
    if (nextDistance < distance) {
      segment = index;
      projected = candidate;
      distance = nextDistance;
    }
  }

  const pageWaypoints = [
    ...route.slice(1, segment + 1),
    projected,
    ...route.slice(segment + 1, -1),
  ];
  const fromCenter = boxCenter(resolved.fromBox);
  const toCenter = boxCenter(resolved.toBox);
  return pageWaypoints.map((waypoint) =>
    connectorWaypointFromPage(waypoint, fromCenter, toCenter),
  );
}

function manualWaypoints(
  semantic: Record<string, unknown>,
): readonly ConnectorWaypoint[] {
  const waypoints = semantic["routingWaypoints"];
  if (!Array.isArray(waypoints)) return [];
  return waypoints.flatMap((waypoint) => {
    if (typeof waypoint !== "object" || waypoint === null) return [];
    const { u, v } = waypoint as { u?: unknown; v?: unknown };
    return typeof u === "number" &&
      Number.isFinite(u) &&
      typeof v === "number" &&
      Number.isFinite(v)
      ? [{ u, v }]
      : [];
  });
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
  fromRotation = 0,
  toRotation = 0,
): ConnectorEndpoints {
  const fromCenter = boxCenter(fromBox);
  const toCenter = boxCenter(toBox);
  const start = rotatedBoundary(fromBox, toCenter, fromRotation);
  const end = rotatedBoundary(toBox, fromCenter, toRotation);
  return withRoute(start, end, fromBox, toBox);
}

function rotatedBoundary(box: Box, target: Vec, rotation: number): Vec {
  const center = boxCenter(box);
  const localTarget = rotatePoint(target, center, -rotation);
  return rotatePoint(
    rectBoundaryIntersection(center, localTarget, box),
    center,
    rotation,
  );
}

function cross(a: Vec, b: Vec): number {
  return a.x * b.y - a.y * b.x;
}

/** Last outline crossing from `origin` towards `target`. */
function outlineBoundary(
  origin: Vec,
  target: Vec,
  points: readonly Vec[],
  closed = true,
): Vec | null {
  const direction = { x: target.x - origin.x, y: target.y - origin.y };
  if (
    (direction.x === 0 && direction.y === 0) ||
    points.length < (closed ? 3 : 2)
  )
    return null;
  const limit = closed ? points.length : points.length - 1;
  let best = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < limit; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (!a || !b) continue;
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) <= 1e-9) continue;
    const offset = { x: a.x - origin.x, y: a.y - origin.y };
    const t = cross(offset, edge) / denominator;
    const u = cross(offset, direction) / denominator;
    if (t >= -1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.max(best, t);
  }
  return Number.isFinite(best)
    ? {
        x: origin.x + direction.x * best,
        y: origin.y + direction.y * best,
      }
    : null;
}

/** Endpoint boundary in the element's unrotated page coordinate system. */
function elementBoundary(
  element: Element,
  box: Box,
  origin: Vec,
  target: Vec,
  context: ShapeContext,
): Vec {
  if (element.type === "shape.geo") {
    const kind = (element.semantic as GeoShapeSemantic).geo;
    if (kind === "ellipse") {
      const inset = {
        x: box.x + 1,
        y: box.y + 1,
        width: Math.max(0, box.width - 2),
        height: Math.max(0, box.height - 2),
      };
      return ellipseBoundaryIntersection(origin, target, inset);
    }
  }
  if (element.type === "draw.freehand") {
    const geometry = freehandGeometry(element);
    if (geometry) {
      const closed = (element.semantic as FreehandSemantic).closed === true;
      const points = flattenStroke(geometry.points, closed, 0.5).map(
        (point) => ({
          x: geometry.box.x + point.x,
          y: geometry.box.y + point.y,
        }),
      );
      const boundary = outlineBoundary(origin, target, points, closed);
      if (boundary) return boundary;
    }
  }
  const polygon = elementOutlinePolygon(element, context);
  if (polygon) {
    const boundary = outlineBoundary(origin, target, polygon);
    if (boundary) return boundary;
  }
  if (element.type === "erd.table") {
    const horizontal =
      Math.abs(target.x - origin.x) >= Math.abs(target.y - origin.y);
    return horizontal
      ? {
          x: target.x >= origin.x ? box.x + box.width : box.x,
          y: Math.max(box.y, Math.min(box.y + box.height, origin.y)),
        }
      : {
          x: Math.max(box.x, Math.min(box.x + box.width, origin.x)),
          y: target.y >= origin.y ? box.y + box.height : box.y,
        };
  }
  return rectBoundaryIntersection(origin, target, box);
}

function resolvedBoundary(
  element: Element,
  box: Box,
  target: Vec,
  context: ShapeContext,
  origin: Vec = boxCenter(box),
): Vec {
  const rotation = endpointRotation(element);
  if (!rotation) return elementBoundary(element, box, origin, target, context);
  const center = boxCenter(box);
  const localOrigin = rotatePoint(origin, center, -rotation);
  const localTarget = rotatePoint(target, center, -rotation);
  return rotatePoint(
    elementBoundary(element, box, localOrigin, localTarget, context),
    center,
    rotation,
  );
}

function erdTableRowAnchor(
  element: Element,
  box: Box,
  endpoint: ErdEndpoint,
): Vec {
  if (element.type !== "erd.table") return boxCenter(box);
  const semantic = element.semantic as ErdTableSemantic;
  const indexes = erdEndpointColumnIds(endpoint).flatMap((columnId) => {
    const index = semantic.columns.findIndex(
      (column) => column.id === columnId,
    );
    return index < 0 ? [] : [index];
  });
  if (!indexes.length) return boxCenter(box);
  const y =
    box.y +
    ERD_TABLE_HEADER_HEIGHT +
    (indexes.reduce((sum, index) => sum + index, 0) / indexes.length + 0.5) *
      ERD_TABLE_ROW_HEIGHT;
  return rotatePoint(
    { x: box.x + box.width / 2, y },
    boxCenter(box),
    element.visual.rotation ?? 0,
  );
}

function erdRelationAnchors(
  element: Element,
  from: Element,
  to: Element,
  fromBox: Box,
  toBox: Box,
): readonly [Vec, Vec] | null {
  if (element.type !== "erd.relation") return null;
  if (typeof element.semantic !== "object" || element.semantic === null)
    return null;
  const semantic = element.semantic as Record<string, unknown>;
  const fromEndpoint = semantic["from"];
  const toEndpoint = semantic["to"];
  if (
    typeof fromEndpoint !== "object" ||
    fromEndpoint === null ||
    typeof toEndpoint !== "object" ||
    toEndpoint === null
  )
    return null;
  return [
    erdTableRowAnchor(from, fromBox, fromEndpoint as ErdEndpoint),
    erdTableRowAnchor(to, toBox, toEndpoint as ErdEndpoint),
  ];
}

function endpointRotation(element: Element | undefined): number {
  return !element ||
    element.type === "group" ||
    getElementTypeDefinition(element.type)?.category === "edge"
    ? 0
    : (element.visual.rotation ?? 0);
}

function obstacleBoxes(
  element: Element,
  endpointIds: ReadonlySet<ElementId>,
  start: Vec,
  end: Vec,
  context: ShapeContext,
): readonly Box[] {
  const elements = context.elementsOnPage?.(element.page) ?? [];
  const boxes: Box[] = [];
  for (const candidate of elements) {
    if (candidate.id === element.id || endpointIds.has(candidate.id)) continue;
    const category = getElementTypeDefinition(candidate.type)?.category;
    if (
      category === "edge" ||
      category === "resource" ||
      candidate.type === "group" ||
      context.isHidden?.(candidate.id) ||
      context.isMaskSource?.(candidate.id)
    )
      continue;
    const raw = context.boundsOf(candidate.id);
    if (!raw) continue;
    const visible = rotatedBox(raw, candidate.visual.rotation ?? 0);
    const box = {
      x: visible.x - CONNECTOR_OBSTACLE_CLEARANCE,
      y: visible.y - CONNECTOR_OBSTACLE_CLEARANCE,
      width: visible.width + CONNECTOR_OBSTACLE_CLEARANCE * 2,
      height: visible.height + CONNECTOR_OBSTACLE_CLEARANCE * 2,
    };
    const contains = (point: Vec) =>
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height;
    // A frame containing an endpoint is an ancestor surface, not an obstacle.
    if (!contains(start) && !contains(end)) boxes.push(box);
  }
  return boxes;
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
  const from = context.resolve(ids.from);
  const to = context.resolve(ids.to);
  if (!from || !to) return null;
  const fromCenter = boxCenter(fromBox);
  const toCenter = boxCenter(toBox);
  const relationAnchors = erdRelationAnchors(element, from, to, fromBox, toBox);
  const fromAnchor = relationAnchors?.[0] ?? fromCenter;
  const toAnchor = relationAnchors?.[1] ?? toCenter;
  if (element.type === "sequence.message" && element.visual.y !== undefined) {
    const y = element.visual.y;
    if (fromCenter.x === toCenter.x) {
      return withRoute(
        { x: fromCenter.x, y },
        { x: fromCenter.x + 48, y },
        fromBox,
        toBox,
      );
    }
    return withRoute(
      { x: fromCenter.x, y },
      { x: toCenter.x, y },
      fromBox,
      toBox,
    );
  }
  const semantic =
    typeof element.semantic === "object" && element.semantic !== null
      ? (element.semantic as Record<string, unknown>)
      : {};
  if (semantic["routing"] === "manual") {
    const stored = manualWaypoints(semantic);
    const waypointPoints = stored.map((waypoint) =>
      connectorWaypointToPage(waypoint, fromCenter, toCenter),
    );
    const start = resolvedBoundary(
      from,
      fromBox,
      waypointPoints[0] ?? toCenter,
      context,
      fromAnchor,
    );
    const end = resolvedBoundary(
      to,
      toBox,
      waypointPoints.at(-1) ?? fromCenter,
      context,
      toAnchor,
    );
    return withRoute(
      start,
      end,
      fromBox,
      toBox,
      [start, ...waypointPoints, end],
      undefined,
      waypointPoints,
    );
  }
  if (semantic["routing"] === "orthogonal") {
    const requested = semantic["routingAxis"];
    const horizontal =
      requested === "horizontal" ||
      (requested !== "vertical" &&
        Math.abs(toAnchor.x - fromAnchor.x) >=
          Math.abs(toAnchor.y - fromAnchor.y));
    const direction = horizontal
      ? Math.sign(toAnchor.x - fromAnchor.x) || 1
      : Math.sign(toAnchor.y - fromAnchor.y) || 1;
    const start = resolvedBoundary(
      from,
      fromBox,
      horizontal
        ? { x: fromAnchor.x + direction, y: fromAnchor.y }
        : { x: fromAnchor.x, y: fromAnchor.y + direction },
      context,
      fromAnchor,
    );
    const end = resolvedBoundary(
      to,
      toBox,
      horizontal
        ? { x: toAnchor.x - direction, y: toAnchor.y }
        : { x: toAnchor.x, y: toAnchor.y - direction },
      context,
      toAnchor,
    );
    const rawBend = semantic["routingBend"];
    const bend =
      typeof rawBend === "number" && Number.isFinite(rawBend)
        ? Math.max(0, Math.min(1, rawBend))
        : 0.5;
    const preferred: readonly Vec[] = horizontal
      ? [
          start,
          { x: start.x + (end.x - start.x) * bend, y: start.y },
          { x: start.x + (end.x - start.x) * bend, y: end.y },
          end,
        ]
      : [
          start,
          { x: start.x, y: start.y + (end.y - start.y) * bend },
          { x: end.x, y: start.y + (end.y - start.y) * bend },
          end,
        ];
    let points = preferred;
    if (semantic["routingAvoidObstacles"] !== false) {
      points = avoidOrthogonalObstacles(
        points,
        obstacleBoxes(
          element,
          new Set([ids.from, ids.to]),
          start,
          end,
          context,
        ),
        horizontal ? "h" : "v",
      );
    }
    const firstBend = preferred[1] as Vec;
    const secondBend = preferred[2] as Vec;
    const hasMovableChannel = horizontal
      ? Math.abs(start.y - end.y) > 1e-9
      : Math.abs(start.x - end.x) > 1e-9;
    return withRoute(
      start,
      end,
      fromBox,
      toBox,
      points,
      hasMovableChannel
        ? {
            point: {
              x: (firstBend.x + secondBend.x) / 2,
              y: (firstBend.y + secondBend.y) / 2,
            },
            axis: horizontal ? "x" : "y",
          }
        : undefined,
    );
  }
  const start = resolvedBoundary(from, fromBox, toAnchor, context, fromAnchor);
  const end = resolvedBoundary(to, toBox, fromAnchor, context, toAnchor);
  return withRoute(start, end, fromBox, toBox);
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
      return unionBoxes(
        resolved.points.map((point) => ({
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
        })),
      );
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
      return resolved.points
        .slice(1)
        .some(
          (to, index) =>
            distanceToSegment(point, resolved.points[index] as Vec, to) <=
            tolerance,
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
  if (element.type === "sequence.message") {
    return {
      start: null,
      end: "arrow",
      label: readString(semantic, "label") ?? "",
    };
  }
  const arrowheads = readField(semantic, "arrowheads");
  return {
    start: arrowheadMarker(readField(arrowheads, "start")),
    end: arrowheadMarker(readField(arrowheads, "end") ?? "arrow"),
    label: readString(semantic, "label") ?? "",
  };
}

/** Semantic default line pattern; explicit visual styling may override it. */
export function connectorDefaultDash(element: Element): string | undefined {
  return element.type === "sequence.message" &&
    readString(element.semantic, "kind") === "return"
    ? "6 4"
    : undefined;
}
