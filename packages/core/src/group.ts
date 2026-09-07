// Groups: several elements that select, move and copy as one.
//
// A group is an ordinary element (`type: "group"`) whose semantic payload
// lists its members. It has no geometry of its own — its bounds are the
// union of its members' bounds, computed on demand — and the renderer
// draws nothing for it. Everything about groups that the rest of the
// editor needs is here: walking up from a member to the groups that hold
// it, walking down from a group to the elements that actually move, and
// the commands that create and dissolve one.
//
// Documents come from disk and from other tools, so every walk carries a
// visited set: a group that lists itself, or two that list each other, is
// a file to open, not a reason to hang.

import type { Element, ElementId, PageId } from "@diagra/ir";
import type { Command } from "./commands.ts";
import {
  compareFractional,
  isFractionalKey,
  keyAfter,
  keyBetween,
  type Rng,
} from "./fractional.ts";
import { unionBoxes } from "./geometry.ts";
import type { ShapeUtil } from "./shape-util.ts";
import type { Store } from "./store.ts";

export const GROUP_TYPE = "group";

export function isGroup(element: Element): boolean {
  return element.type === GROUP_TYPE;
}

/** Member ids of a group element; empty for anything else. */
export function memberIdsOf(element: Element): readonly ElementId[] {
  if (!isGroup(element)) {
    return [];
  }
  const semantic = element.semantic;
  if (typeof semantic !== "object" || semantic === null) {
    return [];
  }
  const members = (semantic as Record<string, unknown>)["memberIds"];
  return Array.isArray(members)
    ? members.filter((member): member is string => typeof member === "string")
    : [];
}

/**
 * The group on the same page whose member list names `id`, or `null`.
 * A well-formed document has at most one; the lowest id wins otherwise so
 * the answer is stable.
 */
export function groupOf(store: Store, id: ElementId): Element | null {
  const element = store.get(id);
  if (!element) {
    return null;
  }
  let found: Element | null = null;
  for (const candidate of store.getPageElements(element.page)) {
    if (candidate.id === id || !memberIdsOf(candidate).includes(id)) {
      continue;
    }
    if (found === null || compareFractional(candidate.id, found.id) < 0) {
      found = candidate;
    }
  }
  return found;
}

/** `id` first, then each enclosing group outward. */
export function ancestorChain(store: Store, id: ElementId): ElementId[] {
  const chain: ElementId[] = [];
  const visited = new Set<ElementId>();
  let current: ElementId | null = id;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    const parent: Element | null = groupOf(store, current);
    current = parent ? parent.id : null;
  }
  return chain;
}

export function outermostGroupOf(store: Store, id: ElementId): ElementId {
  const chain = ancestorChain(store, id);
  return chain[chain.length - 1] ?? id;
}

/**
 * `ids` plus, for every group among them, its members, recursively. Order
 * is stable: each input id is followed by its descendants, depth first.
 */
export function expandGroups(
  store: Store,
  ids: Iterable<ElementId>,
): ElementId[] {
  const out: ElementId[] = [];
  const seen = new Set<ElementId>();
  const visit = (id: ElementId): void => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const element = store.get(id);
    if (!element) {
      return;
    }
    out.push(id);
    for (const member of memberIdsOf(element)) {
      visit(member);
    }
  };
  for (const id of ids) {
    visit(id);
  }
  return out;
}

/** The non-group elements reached from `ids` through group membership. */
export function leafElements(
  store: Store,
  ids: Iterable<ElementId>,
): Element[] {
  const out: Element[] = [];
  for (const id of expandGroups(store, ids)) {
    const element = store.get(id);
    if (element && !isGroup(element)) {
      out.push(element);
    }
  }
  return out;
}

/**
 * Elements on `page` that no group on the page claims: what "select all"
 * selects, and what a marquee reports when groups are resolved.
 */
export function topLevelIds(store: Store, page: PageId): ElementId[] {
  const claimed = new Set<ElementId>();
  const elements = store.getPageElements(page);
  for (const element of elements) {
    for (const member of memberIdsOf(element)) {
      claimed.add(member);
    }
  }
  return elements
    .filter((element) => !claimed.has(element.id))
    .map((element) => element.id);
}

/**
 * Which element a click on `hit` selects, given the current selection:
 * the outermost group normally, or one level further in when that group
 * (or a group inside it) is already selected. Clicking a selected member
 * keeps it.
 */
export function resolveSelectionTarget(
  store: Store,
  hit: ElementId,
  selected: ReadonlySet<ElementId>,
): ElementId {
  const chain = ancestorChain(store, hit).reverse(); // outermost first
  for (let at = 0; at < chain.length; at += 1) {
    const id = chain[at] as ElementId;
    if (selected.has(id)) {
      return chain[at + 1] ?? id;
    }
  }
  return chain[0] ?? hit;
}

/**
 * Selection ids reduced to units: a selected element whose group is also
 * selected is dropped, because the group already speaks for it.
 */
export function selectionUnits(
  store: Store,
  ids: Iterable<ElementId>,
): ElementId[] {
  const selected = new Set(ids);
  const out: ElementId[] = [];
  for (const id of selected) {
    const chain = ancestorChain(store, id);
    const covered = chain.slice(1).some((ancestor) => selected.has(ancestor));
    if (!covered) {
      out.push(id);
    }
  }
  return out;
}

export interface GroupPlan {
  readonly id: ElementId;
  readonly commands: readonly Command[];
}

/**
 * A `createElement` for a group holding `memberIds`, placed in z-order
 * just above its topmost member. `null` when fewer than two distinct
 * members exist on one page.
 */
export function planGroup(
  store: Store,
  memberIds: Iterable<ElementId>,
  id: ElementId,
  rng: Rng,
): GroupPlan | null {
  const members: Element[] = [];
  const seen = new Set<ElementId>();
  for (const memberId of memberIds) {
    const element = store.get(memberId);
    if (element && !seen.has(memberId)) {
      seen.add(memberId);
      members.push(element);
    }
  }
  const page = members[0]?.page;
  if (page === undefined || members.length < 2) {
    return null;
  }
  if (members.some((member) => member.page !== page)) {
    return null;
  }
  const ordered = store.getPageElements(page);
  const orderedMembers = ordered.filter((element) => seen.has(element.id));
  let topAt = -1;
  for (const [at, element] of ordered.entries()) {
    if (seen.has(element.id)) {
      topAt = at;
    }
  }
  const below = ordered[topAt]?.index ?? null;
  const above = ordered[topAt + 1]?.index ?? null;
  // A foreign document may carry keys `keyBetween` cannot split; landing
  // on top of the page is the safe answer then.
  const splittable =
    (below === null || isFractionalKey(below)) &&
    (above === null || isFractionalKey(above));
  const index = splittable
    ? keyBetween(below, above, rng)
    : keyAfter(ordered[ordered.length - 1]?.index ?? null, rng);
  const element: Element = {
    id,
    page,
    type: GROUP_TYPE,
    index,
    semantic: { memberIds: orderedMembers.map((member) => member.id) },
    visual: {},
  };
  return { id, commands: [{ type: "createElement", element }] };
}

/**
 * Dissolve the groups among `ids`: the group elements are deleted, their
 * members stay. Returns the ids that should be selected afterwards.
 */
export function planUngroup(
  store: Store,
  ids: Iterable<ElementId>,
): { readonly commands: readonly Command[]; readonly select: ElementId[] } {
  const groups: Element[] = [];
  const select: ElementId[] = [];
  for (const id of ids) {
    const element = store.get(id);
    if (!element) {
      continue;
    }
    if (isGroup(element)) {
      groups.push(element);
      for (const member of memberIdsOf(element)) {
        if (store.has(member)) {
          select.push(member);
        }
      }
    } else {
      select.push(id);
    }
  }
  if (groups.length === 0) {
    return { commands: [], select: [] };
  }
  return {
    commands: [
      { type: "deleteElements", ids: groups.map((group) => group.id) },
    ],
    select,
  };
}

export const groupShapeUtil: ShapeUtil = {
  type: GROUP_TYPE,
  canResize: false,
  getBounds(element, context) {
    const boxes = [];
    for (const member of memberIdsOf(element)) {
      const box = context.boundsOf(member);
      if (box) {
        boxes.push(box);
      }
    }
    return unionBoxes(boxes);
  },
  // Members are what the pointer hits; the group is reached through them.
  hitTest() {
    return false;
  },
  defaultSemantic() {
    return { memberIds: [] };
  },
  defaultVisual() {
    return {};
  },
};
