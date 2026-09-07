import type { layerRows } from "@diagra/core";

type LayerRow = ReturnType<typeof layerRows>[number];
export type LayerNavigation = {
  readonly id: string;
  readonly action: "select" | "expand" | "collapse";
};

/** Resolve keyboard navigation against the displayed hierarchy, not canvas order. */
export function layerNavigation(
  rows: readonly LayerRow[],
  id: string,
  key: string,
  collapsed: ReadonlySet<string>,
  searching: boolean,
): LayerNavigation | undefined {
  const index = rows.findIndex((row) => row.element.id === id);
  const row = rows[index];
  if (!row) return undefined;
  const select = (index: number): LayerNavigation => ({
    id: rows[index]?.element.id ?? id,
    action: "select",
  });
  if (key === "Home") return select(0);
  if (key === "End") return select(rows.length - 1);
  if (key === "ArrowUp") return select(Math.max(0, index - 1));
  if (key === "ArrowDown") return select(Math.min(rows.length - 1, index + 1));
  if (key === "ArrowRight") {
    if (row.hasChildren && !searching && collapsed.has(id))
      return { id, action: "expand" };
    const next = rows[index + 1];
    return next &&
      next.element.page === row.element.page &&
      next.depth > row.depth
      ? select(index + 1)
      : select(index);
  }
  if (key === "ArrowLeft") {
    if (row.hasChildren && !searching && !collapsed.has(id))
      return { id, action: "collapse" };
    for (let parent = index - 1; parent >= 0; parent--) {
      const candidate = rows[parent];
      if (!candidate || candidate.element.page !== row.element.page) break;
      if (candidate.depth < row.depth) return select(parent);
    }
    return select(index);
  }
  return undefined;
}
