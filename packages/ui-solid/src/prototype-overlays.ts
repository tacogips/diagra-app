import type { PrototypeOverlayPosition, PrototypeTransition } from "@diagra/ir";

export interface PrototypeOverlayEntry {
  readonly key: string;
  readonly frameId: string;
  readonly position: PrototypeOverlayPosition;
  readonly x: number;
  readonly y: number;
  readonly backdrop: boolean;
  readonly dismiss: boolean;
  readonly transition: PrototypeTransition;
  readonly duration: number;
}

export interface PrototypeSurfaceBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const MAX_OVERLAY_DEPTH = 8;

/** Push a non-recursive overlay while keeping corrupted prototypes bounded. */
export function pushPrototypeOverlay(
  stack: readonly PrototypeOverlayEntry[],
  entry: PrototypeOverlayEntry,
): readonly PrototypeOverlayEntry[] {
  return stack.length >= MAX_OVERLAY_DEPTH ||
    stack.some((item) => item.frameId === entry.frameId)
    ? stack
    : [...stack, entry];
}

export function popPrototypeOverlay(
  stack: readonly PrototypeOverlayEntry[],
): readonly PrototypeOverlayEntry[] {
  return stack.length ? stack.slice(0, -1) : stack;
}

export function dismissPrototypeOverlay(
  stack: readonly PrototypeOverlayEntry[],
): readonly PrototypeOverlayEntry[] {
  return stack.at(-1)?.dismiss ? popPrototypeOverlay(stack) : stack;
}

/** Resolve an overlay origin in the base screen's page-coordinate space. */
export function prototypeOverlayPlacement(
  base: PrototypeSurfaceBounds,
  overlay: PrototypeSurfaceBounds,
  entry: PrototypeOverlayEntry,
): { readonly x: number; readonly y: number } {
  if (entry.position === "manual")
    return { x: base.x + entry.x, y: base.y + entry.y };
  if (entry.position === "top-left") return { x: base.x, y: base.y };
  return {
    x: base.x + (base.width - overlay.width) / 2,
    y: base.y + (base.height - overlay.height) / 2,
  };
}
