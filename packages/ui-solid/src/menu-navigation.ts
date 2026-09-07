/** Move only through enabled menu indices; recover if an active item vanished. */
export function stepMenuIndex(
  order: readonly number[],
  current: number | null,
  delta: 1 | -1,
): number | null {
  if (!order.length) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at === -1)
    return delta === 1 ? (order[0] ?? null) : (order.at(-1) ?? null);
  return order[(at + delta + order.length) % order.length] ?? null;
}
