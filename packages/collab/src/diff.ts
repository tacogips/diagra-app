// Field-granular element diffing (design 4.2).
//
// `StoreDiff` names the elements that changed, not the fields, so the binding
// compares the element it last synchronized against the element the store
// holds now and writes only what actually moved. That is what makes design
// 7.1's headline case work: "A moves the table" writes `visual.x`/`visual.y`
// and "B renames a column" writes `semantic.columns[i].name`, so the two
// commute inside Yjs instead of overwriting each other's element.
//
// Two rules keep the write set minimal without ever guessing:
//
//   - Recursion stops at the deepest level that changed. An unchanged nested
//     object is not visited, and a changed leaf is `set` in place.
//   - Arrays of id-carrying items (columns, attributes, methods) reconcile by
//     id, so renaming one column does not rewrite its siblings. Anything else
//     — scalar lists, id-less objects — is replaced as one field write, which
//     is still a single key on the parent map.
//
// The differ never creates `Y.Text`: per-character text merging is not in v1
// (design 7.1), and introducing it here would change the document shape the
// server and every other client agree on.

import { type Element, isPlainObject } from "@diagra/ir";
import * as Y from "yjs";
import { toY } from "./ydoc.ts";

/** Structural equality over the JSON subset the IR is made of. */
function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    return (
      left.length === right.length &&
      left.every((entry, index) => jsonEqual(entry, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
    const rightKeys = Object.keys(right).filter(
      (key) => right[key] !== undefined,
    );
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => jsonEqual(left[key], right[key]))
    );
  }
  return false;
}

/** The `id` of an array item, on either side of the mapping. */
function idOf(value: unknown): string | null {
  if (value instanceof Y.Map) {
    const id = value.get("id");
    return typeof id === "string" ? id : null;
  }
  if (isPlainObject(value) && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function itemsCarryIds(items: readonly unknown[]): boolean {
  return items.every((item) => idOf(item) !== null);
}

/** First index at or after `from` holding an item with `id`. */
function indexOfId(array: Y.Array<unknown>, id: string, from: number): number {
  for (let index = from; index < array.length; index += 1) {
    if (idOf(array.get(index)) === id) {
      return index;
    }
  }
  return -1;
}

/**
 * Reconcile an array of id-carrying items in place: drop the ids that are
 * gone, insert the ones that appeared, move the ones that changed position,
 * and recurse into the ones that merely changed content.
 *
 * A moved item is deleted and re-inserted rather than edited: Y.Array has no
 * move primitive, and re-inserting one item is still one item's worth of
 * writes. Its content comes from `next`, so a move that also edits the item
 * loses nothing.
 */
function reconcileArray(
  array: Y.Array<unknown>,
  previous: readonly unknown[],
  next: readonly unknown[],
): void {
  const nextIds = new Set<string>();
  for (const item of next) {
    const id = idOf(item);
    if (id !== null) {
      nextIds.add(id);
    }
  }

  // Drop departed ids, back to front and in contiguous runs so a cleared
  // array costs one delete rather than one per item.
  let runEnd = -1;
  for (let index = array.length - 1; index >= 0; index -= 1) {
    const id = idOf(array.get(index));
    const keep = id !== null && nextIds.has(id);
    if (!keep) {
      if (runEnd === -1) {
        runEnd = index;
      }
    } else if (runEnd !== -1) {
      array.delete(index + 1, runEnd - index);
      runEnd = -1;
    }
  }
  if (runEnd !== -1) {
    array.delete(0, runEnd + 1);
  }

  const previousById = new Map<string, unknown>();
  for (const item of previous) {
    const id = idOf(item);
    if (id !== null) {
      previousById.set(id, item);
    }
  }

  for (let index = 0; index < next.length; index += 1) {
    const item = next[index];
    const id = idOf(item);
    const current = index < array.length ? array.get(index) : undefined;
    if (id !== null && idOf(current) === id) {
      const before = previousById.get(id);
      if (current instanceof Y.Map && isPlainObject(item)) {
        if (isPlainObject(before)) {
          diffObject(current, before, item);
        } else {
          diffObject(current, {}, item);
        }
        continue;
      }
      if (jsonEqual(before, item)) {
        continue;
      }
      array.delete(index, 1);
      array.insert(index, [toY(item)]);
      continue;
    }
    // Either the item is new, or it lives further along and this is a move.
    if (id !== null) {
      const at = indexOfId(array, id, index + 1);
      if (at !== -1) {
        array.delete(at, 1);
      }
    }
    array.insert(index, [toY(item)]);
  }

  if (array.length > next.length) {
    array.delete(next.length, array.length - next.length);
  }
}

/** Write `next[key]` into `parent`, as deep as the change actually goes. */
function diffValue(
  parent: Y.Map<unknown>,
  key: string,
  previous: unknown,
  next: unknown,
): void {
  if (next === undefined) {
    if (parent.has(key)) {
      parent.delete(key);
    }
    return;
  }

  const current = parent.get(key);

  if (isPlainObject(next)) {
    if (current instanceof Y.Map && isPlainObject(previous)) {
      diffObject(current, previous, next);
      return;
    }
    parent.set(key, toY(next));
    return;
  }

  if (Array.isArray(next)) {
    if (
      current instanceof Y.Array &&
      Array.isArray(previous) &&
      itemsCarryIds(previous) &&
      itemsCarryIds(next)
    ) {
      if (!jsonEqual(previous, next)) {
        reconcileArray(current as Y.Array<unknown>, previous, next);
      }
      return;
    }
    if (!jsonEqual(previous, next)) {
      parent.set(key, toY(next));
    }
    return;
  }

  // A scalar. `has` covers the case where the shadow and the Y.Doc drifted
  // apart — the value we believe is already there simply is not.
  if (previous !== next || !parent.has(key)) {
    parent.set(key, next);
  }
}

/** Recursive object diff: unchanged keys are never touched. */
function diffObject(
  map: Y.Map<unknown>,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): void {
  for (const key of [...map.keys()]) {
    if (next[key] === undefined) {
      map.delete(key);
    }
  }
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) {
      diffValue(map, key, previous[key], value);
    }
  }
}

/**
 * Write the difference between `previous` and `next` into `map`, the
 * `elements` entry for that element.
 *
 * `previous` is the element as this client last synchronized it (the
 * binding's shadow cache), not necessarily what any peer has: the point is to
 * write the user's actual change, and let Yjs merge it with whatever else
 * arrived meanwhile.
 */
export function syncElementToY(
  previous: Element,
  next: Element,
  map: Y.Map<unknown>,
): void {
  if (previous.type !== next.type) {
    map.set("type", next.type);
  }
  if (previous.page !== next.page) {
    map.set("page", next.page);
  }
  if (previous.index !== next.index) {
    map.set("index", next.index);
  }
  diffValue(map, "semantic", previous.semantic ?? {}, next.semantic ?? {});
  diffValue(map, "visual", previous.visual ?? {}, next.visual ?? {});
  diffValue(map, "extensions", previous.extensions, next.extensions);
}
