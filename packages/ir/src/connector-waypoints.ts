import type { ConnectorWaypoint } from "./semantics.ts";

interface PagePoint {
  readonly x: number;
  readonly y: number;
}

export function connectorWaypointToPage(
  waypoint: ConnectorWaypoint,
  from: PagePoint,
  to: PagePoint,
): PagePoint {
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
  point: PagePoint,
  from: PagePoint,
  to: PagePoint,
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
