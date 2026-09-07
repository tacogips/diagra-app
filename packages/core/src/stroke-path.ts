import type { FreehandPoint } from "@diagra/ir";
import { distanceToSegment, type Vec } from "./geometry.ts";

/** De Casteljau subdivision preserves the exact cubic before serialization. */
export function splitStrokeSegment(
  points: readonly FreehandPoint[],
  index: number,
  closed: boolean,
  t = 0.5,
): FreehandPoint[] | null {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= points.length ||
    points.length < 2 ||
    points.length >= 20000 ||
    !Number.isFinite(t) ||
    t <= 0 ||
    t >= 1 ||
    (!closed && index === points.length - 1)
  )
    return null;
  const nextIndex = (index + 1) % points.length;
  const a = points[index];
  const b = points[nextIndex];
  if (!a || !b) return null;
  const mix = (a: Vec, b: Vec): Vec => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const pressure =
    a.pressure !== undefined && b.pressure !== undefined
      ? { pressure: a.pressure + (b.pressure - a.pressure) * t }
      : {};
  const result = [...points];
  let added: FreehandPoint;
  if (a.controlOut || b.controlIn) {
    const ab = mix(a, a.controlOut ?? a);
    const bc = mix(a.controlOut ?? a, b.controlIn ?? b);
    const cd = mix(b.controlIn ?? b, b);
    const abc = mix(ab, bc);
    const bcd = mix(bc, cd);
    added = { ...mix(abc, bcd), ...pressure, controlIn: abc, controlOut: bcd };
    result[index] = { ...a, controlOut: ab };
    result[nextIndex] = { ...b, controlIn: cd };
  } else added = { ...mix(a, b), ...pressure };
  result.splice(index + 1, 0, added);
  return result;
}

export function strokePath(
  points: readonly FreehandPoint[],
  closed = false,
): string {
  const first = points[0];
  if (!first) return "";
  const path = [`M${first.x} ${first.y}`];
  const segment = (a: FreehandPoint, b: FreehandPoint): void => {
    if (a.controlOut || b.controlIn) {
      const c = a.controlOut ?? a;
      const d = b.controlIn ?? b;
      path.push(`C${c.x} ${c.y} ${d.x} ${d.y} ${b.x} ${b.y}`);
    } else path.push(`L${b.x} ${b.y}`);
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) segment(a, b);
  }
  const last = points.at(-1);
  if (closed) {
    if (last && (last.controlOut || first.controlIn)) segment(last, first);
    path.push("Z");
  }
  return path.join(" ");
}

export function flattenStroke(
  points: readonly FreehandPoint[],
  closed: boolean,
  tolerance: number,
): Vec[] {
  const first = points[0];
  if (!first) return [];
  const out: Vec[] = [first];
  const mid = (a: Vec, b: Vec): Vec => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const curve = (a: Vec, b: Vec, c: Vec, d: Vec, depth: number): void => {
    if (
      depth >= 10 ||
      Math.max(distanceToSegment(b, a, d), distanceToSegment(c, a, d)) <=
        tolerance
    ) {
      out.push(d);
      return;
    }
    const ab = mid(a, b);
    const bc = mid(b, c);
    const cd = mid(c, d);
    const abc = mid(ab, bc);
    const bcd = mid(bc, cd);
    const center = mid(abc, bcd);
    curve(a, ab, abc, center, depth + 1);
    curve(center, bcd, cd, d, depth + 1);
  };
  for (let i = 1; i < points.length + (closed ? 1 : 0); i++) {
    const a = points[(i - 1) % points.length];
    const b = points[i % points.length];
    if (!a || !b) continue;
    if (a.controlOut || b.controlIn)
      curve(a, a.controlOut ?? a, b.controlIn ?? b, b, 0);
    else out.push(b);
  }
  return out;
}
