// Viewport camera.
//
// One convention, used everywhere: screen = (page + camera) * zoom. The
// renderer implements it as a single CSS `scale(z) translate(x, y)` on the
// viewport layer, so this file and the transform can never drift apart.
//
// The camera is ephemeral: it is not part of the document, produces no
// commands, and is not undoable.

import type { Vec } from "./geometry.ts";

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

  private emit(): void {
    for (const listener of [...this.listeners]) {
      listener(this.state);
    }
  }
}
