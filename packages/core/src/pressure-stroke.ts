import type { FreehandPoint } from "@diagra/ir";
import type { Box, Vec } from "./geometry.ts";

export interface PressureStrokeSample extends Vec {
  readonly radius: number;
}

export interface PressureStrokeOutline {
  readonly path: string;
  readonly samples: readonly PressureStrokeSample[];
  readonly bounds: Box;
  readonly closed: boolean;
}

function mix(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pressure(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 0.5));
}

function flattenPressurePoints(
  points: readonly FreehandPoint[],
  closed: boolean,
  tolerance: number,
): Array<Vec & { pressure: number }> {
  const first = points[0];
  if (!first) return [];
  const out: Array<Vec & { pressure: number }> = [
    { x: first.x, y: first.y, pressure: pressure(first.pressure) },
  ];
  const curve = (
    a: Vec,
    b: Vec,
    c: Vec,
    d: Vec,
    fromPressure: number,
    toPressure: number,
    depth: number,
  ): void => {
    const chordDistance = (point: Vec): number => {
      const dx = d.x - a.x;
      const dy = d.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared <= Number.EPSILON)
        return Math.hypot(point.x - a.x, point.y - a.y);
      const at = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
        ),
      );
      return Math.hypot(point.x - (a.x + at * dx), point.y - (a.y + at * dy));
    };
    if (
      depth >= 10 ||
      Math.max(chordDistance(b), chordDistance(c)) <= tolerance
    ) {
      out.push({ x: d.x, y: d.y, pressure: toPressure });
      return;
    }
    const ab = mix(a, b);
    const bc = mix(b, c);
    const cd = mix(c, d);
    const abc = mix(ab, bc);
    const bcd = mix(bc, cd);
    const center = mix(abc, bcd);
    const middlePressure = (fromPressure + toPressure) / 2;
    curve(a, ab, abc, center, fromPressure, middlePressure, depth + 1);
    curve(center, bcd, cd, d, middlePressure, toPressure, depth + 1);
  };
  const segmentCount = points.length - (closed ? 0 : 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (!a || !b) continue;
    if (a.controlOut || b.controlIn)
      curve(
        a,
        a.controlOut ?? a,
        b.controlIn ?? b,
        b,
        pressure(a.pressure),
        pressure(b.pressure),
        0,
      );
    else out.push({ x: b.x, y: b.y, pressure: pressure(b.pressure) });
  }
  if (
    closed &&
    out.length > 1 &&
    out[0]?.x === out.at(-1)?.x &&
    out[0]?.y === out.at(-1)?.y
  )
    out.pop();
  return out.filter(
    (sample, index) =>
      index === 0 ||
      sample.x !== out[index - 1]?.x ||
      sample.y !== out[index - 1]?.y,
  );
}

function fmt(value: number): string {
  const rounded = Number(value.toFixed(4));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pointList(points: readonly Vec[]): string {
  return points.map((point) => `L${fmt(point.x)} ${fmt(point.y)}`).join(" ");
}

/** A derived, smoothed variable-width outline for pressure-bearing strokes. */
export function pressureStrokeOutline(
  points: readonly FreehandPoint[],
  closed: boolean,
  strokeWidth: number,
  tolerance = 0.5,
): PressureStrokeOutline | null {
  if (
    !points.some((point) => point.pressure !== undefined) ||
    !Number.isFinite(strokeWidth) ||
    strokeWidth <= 0
  )
    return null;
  const flattened = flattenPressurePoints(
    points,
    closed,
    Math.max(0.01, tolerance),
  );
  if (!flattened.length) return null;
  const rawRadii = flattened.map(
    (sample) => (strokeWidth * (0.2 + 1.6 * sample.pressure)) / 2,
  );
  const radii = rawRadii.map((radius, index) => {
    if (!closed && (index === 0 || index === rawRadii.length - 1))
      return radius;
    const before = rawRadii[(index - 1 + rawRadii.length) % rawRadii.length];
    const after = rawRadii[(index + 1) % rawRadii.length];
    return ((before ?? radius) + radius * 2 + (after ?? radius)) / 4;
  });
  const samples = flattened.map((sample, index) => ({
    x: sample.x,
    y: sample.y,
    radius: radii[index] ?? strokeWidth / 2,
  }));
  if (samples.length === 1) {
    const sample = samples[0] as PressureStrokeSample;
    const r = sample.radius;
    return {
      path: `M${fmt(sample.x - r)} ${fmt(sample.y)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(sample.x + r)} ${fmt(sample.y)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(sample.x - r)} ${fmt(sample.y)} Z`,
      samples,
      bounds: { x: sample.x - r, y: sample.y - r, width: r * 2, height: r * 2 },
      closed,
    };
  }
  const normalAt = (index: number): Vec => {
    const before = closed
      ? samples[(index - 1 + samples.length) % samples.length]
      : samples[Math.max(0, index - 1)];
    const after = closed
      ? samples[(index + 1) % samples.length]
      : samples[Math.min(samples.length - 1, index + 1)];
    const dx = (after?.x ?? 0) - (before?.x ?? 0);
    const dy = (after?.y ?? 0) - (before?.y ?? 0);
    const length = Math.hypot(dx, dy);
    return length <= Number.EPSILON
      ? { x: 0, y: -1 }
      : { x: -dy / length, y: dx / length };
  };
  const left = samples.map((sample, index) => {
    const normal = normalAt(index);
    return {
      x: sample.x + normal.x * sample.radius,
      y: sample.y + normal.y * sample.radius,
    };
  });
  const right = samples.map((sample, index) => {
    const normal = normalAt(index);
    return {
      x: sample.x - normal.x * sample.radius,
      y: sample.y - normal.y * sample.radius,
    };
  });
  const firstLeft = left[0] as Vec;
  const lastRight = right.at(-1) as Vec;
  const path = closed
    ? `M${fmt(firstLeft.x)} ${fmt(firstLeft.y)} ${pointList(left.slice(1))} Z M${fmt(lastRight.x)} ${fmt(lastRight.y)} ${pointList(right.slice(0, -1).reverse())} Z`
    : `M${fmt(firstLeft.x)} ${fmt(firstLeft.y)} ${pointList(left.slice(1))} A${fmt(samples.at(-1)?.radius ?? 0)} ${fmt(samples.at(-1)?.radius ?? 0)} 0 0 1 ${fmt(lastRight.x)} ${fmt(lastRight.y)} ${pointList(right.slice(0, -1).reverse())} A${fmt(samples[0]?.radius ?? 0)} ${fmt(samples[0]?.radius ?? 0)} 0 0 1 ${fmt(firstLeft.x)} ${fmt(firstLeft.y)} Z`;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    minX = Math.min(minX, sample.x - sample.radius);
    minY = Math.min(minY, sample.y - sample.radius);
    maxX = Math.max(maxX, sample.x + sample.radius);
    maxY = Math.max(maxY, sample.y + sample.radius);
  }
  return {
    path,
    samples,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    closed,
  };
}

export function pressureStrokeContains(
  point: Vec,
  outline: PressureStrokeOutline,
  padding = 0,
): boolean {
  const count = outline.samples.length;
  if (!count) return false;
  const segments = count - (outline.closed ? 0 : 1);
  if (segments <= 0) {
    const sample = outline.samples[0] as PressureStrokeSample;
    return (
      Math.hypot(point.x - sample.x, point.y - sample.y) <=
      sample.radius + padding
    );
  }
  for (let index = 0; index < segments; index += 1) {
    const from = outline.samples[index];
    const to = outline.samples[(index + 1) % count];
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const at =
      lengthSquared <= Number.EPSILON
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - from.x) * dx + (point.y - from.y) * dy) /
                lengthSquared,
            ),
          );
    const x = from.x + dx * at;
    const y = from.y + dy * at;
    const radius = from.radius + (to.radius - from.radius) * at + padding;
    if (Math.hypot(point.x - x, point.y - y) <= radius) return true;
  }
  return false;
}
