import type { ElementId, FillGradient } from "@diagra/ir";
import { CommandError } from "./commands.ts";
import type { Editor } from "./editor.ts";
import type { Box, Vec } from "./geometry.ts";
import { linearGradientVector } from "./gradient.ts";

export type GradientHandle =
  | { readonly kind: "linear-start" }
  | { readonly kind: "linear-end" }
  | { readonly kind: "radial-center" }
  | { readonly kind: "radial-radius" }
  | { readonly kind: "angular-center" }
  | { readonly kind: "angular-angle" }
  | { readonly kind: "diamond-center" }
  | { readonly kind: "diamond-radius" }
  | { readonly kind: "stop"; readonly index: number };

export interface GradientHandleGeometry {
  readonly start: Vec;
  readonly end: Vec;
  readonly stops: readonly Vec[];
}

function mix(start: Vec, end: Vec, amount: number): Vec {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

export function gradientHandleGeometry(
  gradient: FillGradient,
  box: Box,
): GradientHandleGeometry {
  let start: Vec;
  let end: Vec;
  if (gradient.type === "linear") {
    const vector = linearGradientVector(gradient.angle, box.width, box.height);
    start = {
      x: box.x + vector.x1 * box.width,
      y: box.y + vector.y1 * box.height,
    };
    end = {
      x: box.x + vector.x2 * box.width,
      y: box.y + vector.y2 * box.height,
    };
  } else if (gradient.type === "radial") {
    const spanX = Math.abs(box.width) || Math.max(Math.abs(box.height), 1);
    start = {
      x: box.x + gradient.centerX * box.width,
      y: box.y + gradient.centerY * box.height,
    };
    end = { x: start.x + gradient.radius * spanX, y: start.y };
  } else {
    const span = Math.max(Math.abs(box.width), Math.abs(box.height), 1) / 2;
    start = {
      x: box.x + gradient.centerX * box.width,
      y: box.y + gradient.centerY * box.height,
    };
    const radians = (gradient.angle * Math.PI) / 180;
    const radius =
      gradient.type === "diamond" ? gradient.radius * span * 2 : span;
    end = {
      x: start.x + Math.sin(radians) * radius,
      y: start.y - Math.cos(radians) * radius,
    };
  }
  return {
    start,
    end,
    stops:
      gradient.type === "angular"
        ? gradient.stops.map((stop) => {
            const radians =
              ((gradient.angle + stop.offset * 360) * Math.PI) / 180;
            const radius = Math.hypot(end.x - start.x, end.y - start.y);
            return {
              x: start.x + Math.sin(radians) * radius,
              y: start.y - Math.cos(radians) * radius,
            };
          })
        : gradient.stops.map((stop) => mix(start, end, stop.offset)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stopOffset(
  gradient: FillGradient,
  index: number,
  point: Vec,
  box: Box,
): number | null {
  const geometry = gradientHandleGeometry(gradient, box);
  if (gradient.type === "angular") {
    if (!gradient.stops[index]) return null;
    const dx = point.x - geometry.start.x;
    const dy = point.y - geometry.start.y;
    if (Math.abs(dx) + Math.abs(dy) <= Number.EPSILON) return null;
    const pointAngle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const offset = ((pointAngle - gradient.angle + 360) % 360) / 360;
    return clamp(
      offset,
      gradient.stops[index - 1]?.offset ?? 0,
      gradient.stops[index + 1]?.offset ?? 1,
    );
  }
  const dx = geometry.end.x - geometry.start.x;
  const dy = geometry.end.y - geometry.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON || !gradient.stops[index]) return null;
  const projected =
    ((point.x - geometry.start.x) * dx + (point.y - geometry.start.y) * dy) /
    lengthSquared;
  return clamp(
    projected,
    gradient.stops[index - 1]?.offset ?? 0,
    gradient.stops[index + 1]?.offset ?? 1,
  );
}

/** Return a valid gradient after dragging one of its canvas handles. */
export function moveGradientHandle(
  gradient: FillGradient,
  handle: GradientHandle,
  point: Vec,
  box: Box,
): FillGradient {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return gradient;
  if (handle.kind === "stop") {
    const offset = stopOffset(gradient, handle.index, point, box);
    if (offset === null) return gradient;
    return {
      ...gradient,
      stops: gradient.stops.map((stop, index) =>
        index === handle.index ? { ...stop, offset } : stop,
      ),
    } as FillGradient;
  }
  if (gradient.type === "linear") {
    if (handle.kind !== "linear-start" && handle.kind !== "linear-end")
      return gradient;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const dx =
      handle.kind === "linear-end" ? point.x - center.x : center.x - point.x;
    const dy =
      handle.kind === "linear-end" ? point.y - center.y : center.y - point.y;
    if (Math.abs(dx) + Math.abs(dy) <= Number.EPSILON) return gradient;
    const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    return { ...gradient, angle };
  }
  if (
    handle.kind === "radial-center" ||
    handle.kind === "angular-center" ||
    handle.kind === "diamond-center"
  )
    return {
      ...gradient,
      centerX: clamp((point.x - box.x) / (Math.abs(box.width) || 1), 0, 1),
      centerY: clamp((point.y - box.y) / (Math.abs(box.height) || 1), 0, 1),
    };
  if (gradient.type === "angular" && handle.kind === "angular-angle") {
    const center = gradientHandleGeometry(gradient, box).start;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    if (Math.abs(dx) + Math.abs(dy) <= Number.EPSILON) return gradient;
    return {
      ...gradient,
      angle: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360,
    };
  }
  if (handle.kind === "radial-radius") {
    if (gradient.type !== "radial") return gradient;
    const center = gradientHandleGeometry(gradient, box).start;
    const dx = (point.x - center.x) / (Math.abs(box.width) || 1);
    const dy = (point.y - center.y) / (Math.abs(box.height) || 1);
    return { ...gradient, radius: clamp(Math.hypot(dx, dy), 0.01, 2) };
  }
  if (gradient.type === "diamond" && handle.kind === "diamond-radius") {
    const center = gradientHandleGeometry(gradient, box).start;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const base = Math.max(Math.abs(box.width), Math.abs(box.height), 1);
    if (Math.abs(dx) + Math.abs(dy) <= Number.EPSILON) return gradient;
    return {
      ...gradient,
      angle: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360,
      radius: clamp(Math.hypot(dx, dy) / base, 0.01, 2),
    };
  }
  return gradient;
}

/** Commit one canvas gradient edit without disturbing unrelated visual fields. */
export function setElementFillGradient(
  editor: Editor,
  id: ElementId,
  fillGradient: FillGradient,
): boolean {
  const element = editor.store.get(id);
  if (
    !element ||
    editor.createShapeContext().isLocked?.(id) ||
    JSON.stringify(element.visual.style?.fillGradient) ===
      JSON.stringify(fillGradient)
  )
    return false;
  try {
    editor.apply([
      {
        type: "replaceVisual",
        id,
        visual: {
          ...element.visual,
          style: { ...element.visual.style, fillGradient },
        },
      },
    ]);
    return true;
  } catch (error) {
    if (error instanceof CommandError) return false;
    throw error;
  }
}

export function setElementStrokeGradient(
  editor: Editor,
  id: ElementId,
  strokeGradient: FillGradient,
): boolean {
  const element = editor.store.get(id);
  if (
    !element ||
    editor.createShapeContext().isLocked?.(id) ||
    JSON.stringify(element.visual.style?.strokeGradient) ===
      JSON.stringify(strokeGradient)
  )
    return false;
  try {
    editor.apply([
      {
        type: "replaceVisual",
        id,
        visual: {
          ...element.visual,
          style: { ...element.visual.style, strokeGradient },
        },
      },
    ]);
    return true;
  } catch (error) {
    if (error instanceof CommandError) return false;
    throw error;
  }
}
