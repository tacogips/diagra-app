import type { FreehandPoint } from "@diagra/ir";
import type { Box } from "./geometry.ts";

function extrema(a: number, b: number, c: number, d: number): number[] {
  const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  const p = a / scale;
  const q = b / scale;
  const r = c / scale;
  const s = d / scale;
  const A = -p + 3 * q - 3 * r + s;
  const B = 2 * (p - 2 * q + r);
  const C = q - p;
  if (Math.abs(A) < 1e-14) return Math.abs(B) < 1e-14 ? [] : [-C / B];
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-B + root) / (2 * A), (-B - root) / (2 * A)];
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const mix = (x: number, y: number) => (1 - t) * x + t * y;
  return mix(mix(mix(a, b), mix(b, c)), mix(mix(b, c), mix(c, d)));
}

/** Exact axis-aligned centerline bounds, excluding unused endpoint handles and stroke effects. */
export function strokeBounds(
  points: readonly FreehandPoint[],
  closed = false,
): Box | null {
  if (!points.length) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const point of points) include(point.x, point.y);
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i];
    const d = points[(i + 1) % points.length];
    if (!a || !d || (!a.controlOut && !d.controlIn)) continue;
    const b = a.controlOut ?? a;
    const c = d.controlIn ?? d;
    for (const t of [
      ...extrema(a.x, b.x, c.x, d.x),
      ...extrema(a.y, b.y, c.y, d.y),
    ]) {
      if (t > 0 && t < 1)
        include(cubic(a.x, b.x, c.x, d.x, t), cubic(a.y, b.y, c.y, d.y, t));
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
