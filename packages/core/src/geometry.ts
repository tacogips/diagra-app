// Plane geometry for the editor core.
//
// Runtime-agnostic: no DOM, no framework. Every function here works in page
// space (the document's own coordinate system); screen space conversion is
// the camera's job.

/** A point or offset in page space. */
export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle in page space. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function boxCenter(box: Box): Vec {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function boxContains(box: Box, point: Vec, padding = 0): boolean {
  return (
    point.x >= box.x - padding &&
    point.x <= box.x + box.width + padding &&
    point.y >= box.y - padding &&
    point.y <= box.y + box.height + padding
  );
}

/**
 * Union of the given boxes, or `null` when the list is empty. Zero-sized
 * boxes still contribute their position, so a union with a point-sized box
 * is not the same as a union without it.
 */
export function unionBoxes(boxes: readonly Box[]): Box | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const box of boxes) {
    seen = true;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!seen) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Rebuild a box from two opposite corners so width and height are never
 * negative. Drag-resize past the opposite edge produces inverted extents;
 * every consumer downstream assumes normalized boxes.
 */
export function normalizeBox(a: Vec, b: Vec): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Shortest distance from `point` to the segment `a`-`b`. */
export function distanceToSegment(point: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const raw = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, raw));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Where the ray from `center` towards `target` leaves `box`.
 *
 * `center` is expected to be the box's own centre; when the ray is
 * degenerate (target equal to center) the centre itself is returned, which
 * keeps connector rendering stable instead of producing NaN.
 */
export function rectBoundaryIntersection(
  center: Vec,
  target: Vec,
  box: Box,
): Vec {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) {
    return center;
  }
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  // Scale the direction until it touches whichever edge it reaches first.
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const scaleY =
    dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** Same contract as {@link rectBoundaryIntersection} for an inscribed ellipse. */
export function ellipseBoundaryIntersection(
  center: Vec,
  target: Vec,
  box: Box,
): Vec {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) {
    return center;
  }
  const radiusX = box.width / 2;
  const radiusY = box.height / 2;
  if (radiusX === 0 || radiusY === 0) {
    return center;
  }
  const normalized = Math.hypot(dx / radiusX, dy / radiusY);
  if (normalized === 0) {
    return center;
  }
  return { x: center.x + dx / normalized, y: center.y + dy / normalized };
}

/** True when `point` lies inside the ellipse inscribed in `box`. */
export function ellipseContains(box: Box, point: Vec, padding = 0): boolean {
  const radiusX = box.width / 2 + padding;
  const radiusY = box.height / 2 + padding;
  if (radiusX <= 0 || radiusY <= 0) {
    return false;
  }
  const center = boxCenter(box);
  const nx = (point.x - center.x) / radiusX;
  const ny = (point.y - center.y) / radiusY;
  return nx * nx + ny * ny <= 1;
}

/** True when `point` lies inside the diamond inscribed in `box`. */
export function diamondContains(box: Box, point: Vec, padding = 0): boolean {
  const halfWidth = box.width / 2 + padding;
  const halfHeight = box.height / 2 + padding;
  if (halfWidth <= 0 || halfHeight <= 0) {
    return false;
  }
  const center = boxCenter(box);
  const nx = Math.abs(point.x - center.x) / halfWidth;
  const ny = Math.abs(point.y - center.y) / halfHeight;
  return nx + ny <= 1;
}
