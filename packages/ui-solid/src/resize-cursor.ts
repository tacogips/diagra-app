import type { ResizeHandle } from "./interaction.ts";

const ANGLES: Record<ResizeHandle, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};
const CURSORS = [
  "ew-resize",
  "nwse-resize",
  "ns-resize",
  "nesw-resize",
] as const;

/** Native cursors quantize the handle's page-space axis to 45-degree steps. */
export function resizeCursor(handle: ResizeHandle, rotation = 0): string {
  const degrees =
    ANGLES[handle] + (Number.isFinite(rotation) ? rotation % 360 : 0);
  const index = ((Math.round(degrees / 45) % 4) + 4) % 4;
  return CURSORS[index] ?? "ew-resize";
}
