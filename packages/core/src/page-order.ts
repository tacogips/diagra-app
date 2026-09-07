import type { Page } from "@diagra/ir";
import type { Command } from "./commands.ts";
import { isFractionalKey, keyBetween, type Rng } from "./fractional.ts";

/** Prefer the next surviving tab, then the nearest previous tab after removal. */
export function pageAfterRemoval(
  previous: readonly string[],
  next: readonly Page[],
  removedId: string,
): string {
  const surviving = new Set(next.map((page) => page.id));
  const index = previous.indexOf(removedId);
  if (index >= 0) {
    for (const id of previous.slice(index + 1))
      if (surviving.has(id)) return id;
    for (let at = index - 1; at >= 0; at--) {
      const id = previous[at];
      if (id && surviving.has(id)) return id;
    }
  }
  return next[0]?.id ?? "";
}

/** Materialize legacy/tied keys only when an ordering operation needs them.
 * The caller publishes these patches and its insertion/move as one transaction. */
export function planPageOrder(
  pages: readonly Page[],
  position: number,
  rng: Rng,
  movingId?: string,
) {
  const orders = new Map(pages.map((page) => [page.id, page.order]));
  const commands: Command[] = [];
  const keys = pages.map((page) => page.order);
  if (
    keys.some((key) => !key || !isFractionalKey(key)) ||
    new Set(keys).size !== keys.length
  ) {
    let previous: string | null = null;
    for (const page of pages) {
      const order = keyBetween(previous, null, () => 0.5);
      previous = order;
      orders.set(page.id, order);
      if (page.order !== order)
        commands.push({ type: "updatePage", id: page.id, page: { order } });
    }
  }
  const remaining = pages.filter((page) => page.id !== movingId);
  const before = remaining[position - 1];
  const after = remaining[position];
  const order = keyBetween(
    before ? (orders.get(before.id) ?? null) : null,
    after ? (orders.get(after.id) ?? null) : null,
    rng,
  );
  return { order, commands };
}
