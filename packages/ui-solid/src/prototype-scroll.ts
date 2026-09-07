import type { PrototypeOverflow } from "@diagra/ir";

export interface PrototypeScrollPoint {
  readonly x: number;
  readonly y: number;
}

export interface PrototypeScrollBox extends PrototypeScrollPoint {
  readonly width: number;
  readonly height: number;
}

/** Convert a viewport-space drag into design-space scroll movement. */
export function prototypeDragDelta(
  start: PrototypeScrollPoint,
  current: PrototypeScrollPoint,
  scale: number,
): PrototypeScrollPoint {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: (start.x - current.x) / safeScale,
    y: (start.y - current.y) / safeScale,
  };
}

export function prototypeKeyboardDelta(
  key: string,
  viewport: Pick<PrototypeScrollBox, "width" | "height">,
): PrototypeScrollPoint | undefined {
  const pageX = Math.max(40, viewport.width * 0.8);
  const pageY = Math.max(40, viewport.height * 0.8);
  if (key === "ArrowLeft") return { x: -40, y: 0 };
  if (key === "ArrowRight") return { x: 40, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -40 };
  if (key === "ArrowDown") return { x: 0, y: 40 };
  if (key === "PageUp") return { x: -pageX, y: -pageY };
  if (key === "PageDown") return { x: pageX, y: pageY };
  if (key === "Home")
    return { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY };
  if (key === "End")
    return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
  return undefined;
}

export function prototypeScrollRange(
  viewport: PrototypeScrollBox,
  content: readonly PrototypeScrollBox[],
): PrototypeScrollPoint {
  let right = viewport.x + viewport.width;
  let bottom = viewport.y + viewport.height;
  for (const box of content) {
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return {
    x: Math.max(0, right - (viewport.x + viewport.width)),
    y: Math.max(0, bottom - (viewport.y + viewport.height)),
  };
}

export function advancePrototypeScroll(
  mode: PrototypeOverflow,
  current: PrototypeScrollPoint,
  delta: PrototypeScrollPoint,
  range: PrototypeScrollPoint,
): PrototypeScrollPoint {
  const horizontalDelta =
    mode === "horizontal" && delta.x === 0 ? delta.y : delta.x;
  return {
    x:
      mode === "horizontal" || mode === "both"
        ? Math.min(range.x, Math.max(0, current.x + horizontalDelta))
        : current.x,
    y:
      mode === "vertical" || mode === "both"
        ? Math.min(range.y, Math.max(0, current.y + delta.y))
        : current.y,
  };
}
