// Viewport camera.
//
// One convention, used everywhere: screen = (page + camera) * zoom. The
// renderer implements it as a single CSS `scale(z) translate(x, y)` on the
// viewport layer, so this file and the transform can never drift apart.
//
// The camera is ephemeral: it is not part of the document, produces no
// commands, and is not undoable.

import type { Box, Vec } from "./geometry.ts";

export interface CameraState {
  /** Page-space offset applied before scaling. */
  readonly x: number;
  readonly y: number;
  /** Scale factor; 1 means one page unit per CSS pixel. */
  readonly z: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) {
    return 1;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** The zoom levels the in/out commands step through (design 3.5). */
export const ZOOM_STEPS: readonly number[] = [
  0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8,
];

/** The next step strictly above (or below) `z`, or `z` at the end. */
export function nextZoomStep(z: number, direction: "in" | "out"): number {
  const epsilon = 1e-6;
  if (direction === "in") {
    for (const step of ZOOM_STEPS) {
      if (step > z + epsilon) {
        return step;
      }
    }
    return clampZoom(z);
  }
  for (let at = ZOOM_STEPS.length - 1; at >= 0; at -= 1) {
    const step = ZOOM_STEPS[at] as number;
    if (step < z - epsilon) {
      return step;
    }
  }
  return clampZoom(z);
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface FitOptions {
  /** Screen pixels of margin on every side. Defaults to 48. */
  readonly padding?: number;
  /** Never zoom in past this while fitting. Defaults to 1. */
  readonly maxZoom?: number;
}

export type CameraListener = (state: CameraState) => void;

export class Camera {
  private state: CameraState;
  private readonly listeners = new Set<CameraListener>();

  constructor(initial: CameraState = { x: 0, y: 0, z: 1 }) {
    this.state = { ...initial, z: clampZoom(initial.z) };
  }

  get(): CameraState {
    return this.state;
  }

  subscribe(listener: CameraListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(state: CameraState): void {
    this.state = { ...state, z: clampZoom(state.z) };
    this.emit();
  }

  pageToScreen(point: Vec): Vec {
    const { x, y, z } = this.state;
    return { x: (point.x + x) * z, y: (point.y + y) * z };
  }

  screenToPage(point: Vec): Vec {
    const { x, y, z } = this.state;
    return { x: point.x / z - x, y: point.y / z - y };
  }

  /** Pan by a screen-space delta, so dragging tracks the cursor at any zoom. */
  panBy(dxScreen: number, dyScreen: number): void {
    const { x, y, z } = this.state;
    this.state = { x: x + dxScreen / z, y: y + dyScreen / z, z };
    this.emit();
  }

  /**
   * Multiply the zoom, keeping the page point under `screenAnchor` fixed.
   * Clamping the new zoom first is what keeps the anchor exact at the
   * limits: the offset is solved against the zoom actually used.
   */
  zoomBy(factor: number, screenAnchor: Vec): void {
    const anchorPage = this.screenToPage(screenAnchor);
    const z = clampZoom(this.state.z * factor);
    this.state = {
      x: screenAnchor.x / z - anchorPage.x,
      y: screenAnchor.y / z - anchorPage.y,
      z,
    };
    this.emit();
  }

  /** Set an absolute zoom about a screen anchor. */
  zoomTo(z: number, screenAnchor: Vec): void {
    const current = this.state.z;
    this.zoomBy(clampZoom(z) / current, screenAnchor);
  }

  /**
   * Show all of `box` centred in a viewport of `size`, as large as the
   * padding and `maxZoom` allow. A degenerate box (a single point) is
   * centred at `maxZoom`.
   */
  fitBox(box: Box, size: ViewportSize, options: FitOptions = {}): void {
    const padding = options.padding ?? 48;
    const maxZoom = options.maxZoom ?? 1;
    const availableWidth = Math.max(1, size.width - padding * 2);
    const availableHeight = Math.max(1, size.height - padding * 2);
    const fitWidth =
      box.width > 0 ? availableWidth / box.width : Number.POSITIVE_INFINITY;
    const fitHeight =
      box.height > 0 ? availableHeight / box.height : Number.POSITIVE_INFINITY;
    const z = clampZoom(Math.min(maxZoom, fitWidth, fitHeight));
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    this.state = {
      x: size.width / (2 * z) - centerX,
      y: size.height / (2 * z) - centerY,
      z,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      listener(this.state);
    }
  }
}
