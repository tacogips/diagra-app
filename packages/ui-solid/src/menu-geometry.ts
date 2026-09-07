import type { Vec } from "@diagra/core";

const EDGE_MARGIN = 4;
type Size = { readonly width: number; readonly height: number };
type Bounds = Size & { readonly left: number; readonly top: number };

/** Fixed-position submenu coordinates from viewport-space parent and host bounds. */
export function placeSubmenu(
  parent: { readonly left: number; readonly right: number },
  triggerTop: number,
  size: Size,
  bounds: Bounds,
): Vec {
  const left =
    parent.right + size.width + EDGE_MARGIN > bounds.left + bounds.width
      ? parent.left - size.width
      : parent.right;
  const point = clampToHost(
    { x: left - bounds.left, y: triggerTop - bounds.top },
    size,
    bounds,
  );
  return { x: bounds.left + point.x, y: bounds.top + point.y };
}

/** Available scroll-box dimensions, reserving a margin on both sides. */
export function menuLimits(bounds: Size): Size {
  return {
    width: Math.max(1, bounds.width - EDGE_MARGIN * 2),
    height: Math.max(1, bounds.height - EDGE_MARGIN * 2),
  };
}

/** Position a measured menu relative to the editor host. */
export function clampToHost(at: Vec, size: Size, bounds: Size): Vec {
  const maxX = Math.max(EDGE_MARGIN, bounds.width - size.width - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, bounds.height - size.height - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(EDGE_MARGIN, at.x), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, at.y), maxY),
  };
}
