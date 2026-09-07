import type { Visual } from "@diagra/ir";

export type SizeAxis = "width" | "height";

export function minimumSize(visual: Visual, axis: SizeAxis): number {
  return visual[axis === "width" ? "minWidth" : "minHeight"] ?? 1;
}

export function maximumSize(visual: Visual, axis: SizeAxis): number {
  return (
    visual[axis === "width" ? "maxWidth" : "maxHeight"] ??
    Number.POSITIVE_INFINITY
  );
}

/** Clamp a layout-derived dimension while preserving the editor's one-pixel floor. */
export function clampLayoutSize(
  visual: Visual,
  axis: SizeAxis,
  value: number,
): number {
  return Math.min(
    maximumSize(visual, axis),
    Math.max(minimumSize(visual, axis), value),
  );
}
