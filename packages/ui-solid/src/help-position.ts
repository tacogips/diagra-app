/** Place measured help beside its trigger without escaping the viewport. */
export function helpPosition(
  anchor: { left: number; top: number; bottom: number },
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const margin = 8;
  const gap = 6;
  const maxLeft = Math.max(margin, viewport.width - tooltip.width - margin);
  const maxTop = Math.max(margin, viewport.height - tooltip.height - margin);
  const below = anchor.bottom + gap;
  const preferredTop =
    below <= maxTop ? below : anchor.top - tooltip.height - gap;
  return {
    left: Math.max(margin, Math.min(anchor.left, maxLeft)),
    top: Math.max(margin, Math.min(preferredTop, maxTop)),
  };
}
