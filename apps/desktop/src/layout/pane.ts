export type PaneSide = "left" | "right";

export const PANE_MIN_WIDTH = 180;
export const PANE_MAX_WIDTH = 480;
export const CANVAS_MIN_WIDTH = 280;
export const PANE_KEYBOARD_STEP = 24;
export const COLLAPSED_PANE_RAIL_WIDTH = 34;

export interface PaneBoundsInput {
  readonly containerWidth: number;
  readonly oppositeWidth: number;
  /** Overlay panes cover the canvas, so only the opposite restore rail bounds them. */
  readonly overlaysCanvas?: boolean;
}

export function paneBounds(input: PaneBoundsInput): {
  readonly min: number;
  readonly max: number;
} {
  const roomForPane =
    input.containerWidth -
    input.oppositeWidth -
    (input.overlaysCanvas ? 0 : CANVAS_MIN_WIDTH);
  return {
    min: PANE_MIN_WIDTH,
    max: Math.max(PANE_MIN_WIDTH, Math.min(PANE_MAX_WIDTH, roomForPane)),
  };
}

export function clampPaneWidth(width: number, input: PaneBoundsInput): number {
  const bounds = paneBounds(input);
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

export function paneWidthFromPointer(
  side: PaneSide,
  clientX: number,
  left: number,
  right: number,
): number {
  return side === "left" ? clientX - left : right - clientX;
}

export function paneWidthFromKey(
  side: PaneSide,
  width: number,
  key: string,
  input: PaneBoundsInput,
): number | undefined {
  const bounds = paneBounds(input);
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;
  const physicalDirection = key === "ArrowRight" ? 1 : -1;
  const paneDirection = side === "left" ? 1 : -1;
  return clampPaneWidth(
    width + physicalDirection * paneDirection * PANE_KEYBOARD_STEP,
    input,
  );
}

export function paneOpenStateForWidth(
  containerWidth: number,
  leftWidth = PANE_MIN_WIDTH,
  rightWidth = PANE_MIN_WIDTH,
): {
  readonly left: boolean;
  readonly right: boolean;
} {
  if (
    containerWidth <
    CANVAS_MIN_WIDTH + leftWidth + COLLAPSED_PANE_RAIL_WIDTH
  ) {
    return { left: false, right: false };
  }
  if (containerWidth < CANVAS_MIN_WIDTH + leftWidth + rightWidth) {
    return { left: true, right: false };
  }
  return { left: true, right: true };
}
