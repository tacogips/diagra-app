/** Fit a screen inside a viewport without enlarging it or changing design data. */
export function prototypeFitScale(
  screen: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 24,
): number {
  if (
    ![
      screen.width,
      screen.height,
      viewport.width,
      viewport.height,
      padding,
    ].every(Number.isFinite) ||
    screen.width <= 0 ||
    screen.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    padding < 0
  )
    return 1;
  return Math.min(
    1,
    Math.max(1, viewport.width - 2 * padding) / screen.width,
    Math.max(1, viewport.height - 2 * padding) / screen.height,
  );
}
