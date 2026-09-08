import type { VisualStyle } from "@diagra/ir";
import type { Vec } from "./geometry.ts";

const PRESET_DASHES: Readonly<
  Record<NonNullable<VisualStyle["dash"]>, readonly number[]>
> = {
  solid: [],
  dashed: [6, 4],
  dotted: [1, 4],
};

/**
 * Boolean expansion needs concrete polygons for every painted dash. Keep this
 * deliberately finite: SVG renderers retain the exact authored dash pattern,
 * while an excessively dense Boolean operand falls back to its full stroke.
 */
export const MAX_DASH_SPLIT_STEPS = 16_384;

/** Custom intervals override the legacy named preset. Odd arrays repeat once. */
export function resolvedStrokeDashArray(
  style: VisualStyle | undefined,
): readonly number[] {
  const source =
    style?.strokeDashArray ?? PRESET_DASHES[style?.dash ?? "solid"];
  if (!source.length || source.every((value) => value === 0)) return [];
  return source.length % 2 === 1 ? [...source, ...source] : source;
}

export function strokeDashCss(
  style: VisualStyle | undefined,
): string | undefined {
  const pattern = resolvedStrokeDashArray(style);
  return pattern.length ? pattern.join(" ") : undefined;
}

export interface DashPoint extends Vec {
  readonly radius?: number;
}

function interpolate(a: DashPoint, b: DashPoint, at: number): DashPoint {
  const radius =
    a.radius !== undefined && b.radius !== undefined
      ? { radius: a.radius + (b.radius - a.radius) * at }
      : {};
  return {
    x: a.x + (b.x - a.x) * at,
    y: a.y + (b.y - a.y) * at,
    ...radius,
  };
}

function samePoint(a: DashPoint | undefined, b: DashPoint): boolean {
  return a?.x === b.x && a.y === b.y;
}

/** Split a flattened centerline into painted dash fragments by arc length. */
export function dashPolyline(
  points: readonly DashPoint[],
  pattern: readonly number[],
  offset = 0,
): DashPoint[][] {
  if (points.length < 2) return [];
  if (!pattern.length) return [[...points]];
  const cycle = pattern.reduce((sum, value) => sum + value, 0);
  if (
    !(cycle > 0) ||
    pattern.some((value) => !Number.isFinite(value) || value < 0)
  )
    return [];
  let phase = ((offset % cycle) + cycle) % cycle;
  let patternIndex = 0;
  while (phase > 0) {
    const interval = pattern[patternIndex] ?? 0;
    if (phase < interval) break;
    phase -= interval;
    patternIndex = (patternIndex + 1) % pattern.length;
  }
  let remaining = (pattern[patternIndex] ?? 0) - phase;
  const fragments: DashPoint[][] = [];
  let current: DashPoint[] | null = null;
  let steps = 0;
  const advance = (): void => {
    let attempts = 0;
    do {
      patternIndex = (patternIndex + 1) % pattern.length;
      remaining = pattern[patternIndex] ?? 0;
      attempts += 1;
    } while (remaining <= 1e-9 && attempts <= pattern.length);
  };
  if (remaining <= 1e-9) advance();
  for (
    let segmentIndex = 0;
    segmentIndex < points.length - 1;
    segmentIndex += 1
  ) {
    const start = points[segmentIndex];
    const end = points[segmentIndex + 1];
    if (!start || !end) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= Number.EPSILON) continue;
    let consumed = 0;
    while (consumed < length - 1e-9) {
      steps += 1;
      if (steps > MAX_DASH_SPLIT_STEPS) return [[...points]];
      const step = Math.min(remaining, length - consumed);
      const from = interpolate(start, end, consumed / length);
      const to = interpolate(start, end, (consumed + step) / length);
      const painted = patternIndex % 2 === 0;
      if (painted) {
        current ??= [from];
        if (!samePoint(current.at(-1), to)) current.push(to);
      }
      consumed += step;
      remaining -= step;
      if (remaining <= 1e-9) {
        if (painted && current && current.length >= 2) fragments.push(current);
        current = null;
        advance();
      }
    }
  }
  if (current && current.length >= 2) fragments.push(current);
  return fragments;
}
