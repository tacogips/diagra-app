// Explicit z-order moves, expressed as fractional-index edits.
//
// The order itself is decided first, as a permutation of ids, and only then
// turned into keys. That split keeps the interesting part testable without
// any key arithmetic, and it keeps the key arithmetic minimal: elements that
// are already in the right relative order keep the keys they have, so a
// bring-to-front on one shape rewrites one index rather than the page.
//
// Foreign documents are the reason for the renumber fallback. Index keys are
// only guaranteed to be non-empty strings by the schema, so a file written
// by another tool can carry ties or characters `keyBetween` cannot do
// arithmetic on. Rather than throw at the user, the whole page is renumbered
// into the requested order.

import type { Element, ElementId, PageId } from "@diagra/ir";
import type { Command } from "./commands.ts";
import {
  compareFractional,
  isFractionalKey,
  keyAfter,
  keyBetween,
  type Rng,
} from "./fractional.ts";
import type { Store } from "./store.ts";

export type ZOrderAction = "front" | "forward" | "backward" | "back";

/**
 * `ordered` bottom to top, and the same ids reordered by `action`.
 *
 * Multi-selections keep their relative order, and a selection already at the
 * extreme it is being pushed towards comes back unchanged.
 */
export function targetOrder(
  ordered: readonly ElementId[],
  selected: ReadonlySet<ElementId>,
  action: ZOrderAction,
): ElementId[] {
  const picked = ordered.filter((id) => selected.has(id));
  const rest = ordered.filter((id) => !selected.has(id));
  if (action === "front") {
    return [...rest, ...picked];
  }
  if (action === "back") {
    return [...picked, ...rest];
  }

  const working = [...ordered];
  const swap = (at: number): void => {
    const lower = working[at] as ElementId;
    working[at] = working[at + 1] as ElementId;
    working[at + 1] = lower;
  };
  if (action === "forward") {
    // Top down, so a block of selected elements hops over the first
    // unselected element above it without overtaking its own members.
    for (let at = working.length - 2; at >= 0; at -= 1) {
      if (
        selected.has(working[at] as ElementId) &&
        !selected.has(working[at + 1] as ElementId)
      ) {
        swap(at);
      }
    }
    return working;
  }
  for (let at = 1; at < working.length; at += 1) {
    if (
      selected.has(working[at] as ElementId) &&
      !selected.has(working[at - 1] as ElementId)
    ) {
      swap(at - 1);
    }
  }
  return working;
}

/** A fresh strictly-increasing key chain over the whole requested order. */
function renumber(order: readonly ElementId[], rng: Rng): Command[] {
  const commands: Command[] = [];
  let previous: string | null = null;
  for (const id of order) {
    const index = keyAfter(previous, rng);
    previous = index;
    commands.push({ type: "reorder", id, index });
  }
  return commands;
}

function sameOrder(
  left: readonly ElementId[],
  right: readonly ElementId[],
): boolean {
  return (
    left.length === right.length && left.every((id, at) => id === right[at])
  );
}

/**
 * `reorder` commands that make `elements` (bottom to top) read as `order`.
 *
 * Empty when nothing has to move. `order` must be a permutation of the ids
 * in `elements`; anything else is refused rather than half-applied.
 */
export function reorderCommands(
  elements: readonly Element[],
  order: readonly ElementId[],
  rng: Rng,
): Command[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const target = order.filter((id) => byId.has(id));
  if (target.length !== elements.length) {
    return [];
  }
  if (
    sameOrder(
      elements.map((element) => element.id),
      target,
    )
  ) {
    return [];
  }

  const keys = elements.map((element) => element.index);
  const usable =
    keys.every(isFractionalKey) && new Set(keys).size === keys.length;
  if (!usable) {
    return renumber(target, rng);
  }

  // Everything already sitting above the last element we decided to leave
  // alone can keep its key; the rest is what actually has to be rewritten.
  const moved = new Set<ElementId>();
  let highestKept: string | null = null;
  for (const id of target) {
    const key = (byId.get(id) as Element).index;
    if (highestKept === null || compareFractional(key, highestKept) > 0) {
      highestKept = key;
    } else {
      moved.add(id);
    }
  }

  const finalKeys = new Map<ElementId, string>();
  const commands: Command[] = [];
  for (const [at, id] of target.entries()) {
    const element = byId.get(id) as Element;
    if (!moved.has(id)) {
      finalKeys.set(id, element.index);
      continue;
    }
    const below =
      at > 0 ? (finalKeys.get(target[at - 1] as ElementId) ?? null) : null;
    let above: string | null = null;
    for (let scan = at + 1; scan < target.length; scan += 1) {
      const next = target[scan] as ElementId;
      if (!moved.has(next)) {
        above = (byId.get(next) as Element).index;
        break;
      }
    }
    if (
      below !== null &&
      above !== null &&
      compareFractional(below, above) >= 0
    ) {
      return renumber(target, rng);
    }
    const index = keyBetween(below, above, rng);
    finalKeys.set(id, index);
    commands.push({ type: "reorder", id, index });
  }
  return commands;
}

/** The commands one z-order action on one page's selection would apply. */
export function planZOrder(
  store: Store,
  pageId: PageId,
  selected: ReadonlySet<ElementId>,
  action: ZOrderAction,
  rng: Rng,
): Command[] {
  const elements = store.getPageElements(pageId);
  const ids = elements.map((element) => element.id);
  const onPage = new Set(ids.filter((id) => selected.has(id)));
  if (onPage.size === 0 || onPage.size === ids.length) {
    return [];
  }
  return reorderCommands(elements, targetOrder(ids, onPage, action), rng);
}
