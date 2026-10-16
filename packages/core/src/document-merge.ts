// Three-way document merge and document-to-store diffs.
//
// Used when a file the app has open changes on disk (for example nodetto-cli
// edited it). Elements and pages merge by id; inside an element that both
// sides changed, plain objects merge key by key, so an agent moving a table
// and a person renaming a column of that table both survive. Arrays and
// scalars are atomic: when both sides changed the same one differently, the
// local value wins and the element is reported as a conflict.

import type { Document, Element, Page } from "@nodetto/ir";
import { isPlainObject } from "@nodetto/ir";
import type { StoreCommit } from "./store.ts";

export interface MergeConflict {
  readonly id: string;
  readonly kind: "element" | "page" | "document";
  readonly reason: "both-changed" | "deleted-locally" | "deleted-remotely";
}

export interface MergeResult {
  readonly document: Document;
  readonly conflicts: readonly MergeConflict[];
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Merge one JSON value; `conflict` is set when local overrode a remote change. */
function mergeValue(
  base: unknown,
  local: unknown,
  remote: unknown,
  conflict: { value: boolean },
): unknown {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);
    for (const key of keys) {
      const merged = mergeValue(base[key], local[key], remote[key], conflict);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }
  conflict.value = true;
  return local;
}

function mergeById<T extends { readonly id: string }>(
  kind: "element" | "page",
  base: readonly T[],
  local: readonly T[],
  remote: readonly T[],
  conflicts: MergeConflict[],
): T[] {
  const baseMap = new Map(base.map((item) => [item.id, item]));
  const localMap = new Map(local.map((item) => [item.id, item]));
  const remoteMap = new Map(remote.map((item) => [item.id, item]));
  const ids = [
    ...new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]),
  ];
  const result: T[] = [];
  for (const id of ids) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    if (l === undefined && r === undefined) continue;
    if (b === undefined) {
      // Added on one or both sides.
      if (l !== undefined && r !== undefined && !same(l, r)) {
        const conflict = { value: false };
        result.push(mergeValue({}, l, r, conflict) as T);
        if (conflict.value)
          conflicts.push({ id, kind, reason: "both-changed" });
      } else result.push((l ?? r) as T);
      continue;
    }
    if (l === undefined) {
      // Deleted locally: stays deleted unless remote changed it meanwhile.
      if (r !== undefined && !same(r, b))
        conflicts.push({ id, kind, reason: "deleted-locally" });
      continue;
    }
    if (r === undefined) {
      if (!same(l, b)) {
        // Remote deleted what the person is editing: keep the local edit.
        conflicts.push({ id, kind, reason: "deleted-remotely" });
        result.push(l);
      }
      continue;
    }
    const conflict = { value: false };
    result.push(mergeValue(b, l, r, conflict) as T);
    if (conflict.value) conflicts.push({ id, kind, reason: "both-changed" });
  }
  return result;
}

/** Merge `local` and `remote`, which both derive from `base`. */
export function mergeDocuments(
  base: Document,
  local: Document,
  remote: Document,
): MergeResult {
  const conflicts: MergeConflict[] = [];
  const pages = mergeById<Page>(
    "page",
    base.pages,
    local.pages,
    remote.pages,
    conflicts,
  );
  const pageIds = new Set(pages.map((page) => page.id));
  const elements = mergeById<Element>(
    "element",
    base.elements,
    local.elements,
    remote.elements,
    conflicts,
  ).filter((element) => pageIds.has(element.page));
  const meta = { value: false };
  const title = mergeValue(base.title, local.title, remote.title, meta);
  const extensions = mergeValue(
    base.extensions,
    local.extensions,
    remote.extensions,
    meta,
  );
  if (meta.value)
    conflicts.push({ id: local.id, kind: "document", reason: "both-changed" });
  return {
    document: {
      ...local,
      title: typeof title === "string" ? title : local.title,
      ...(extensions === undefined
        ? {}
        : { extensions: extensions as Document["extensions"] }),
      pages,
      elements,
    },
    conflicts,
  };
}

/**
 * The store commit that turns `current` into `target`, or null when document
 * metadata changed and only a full load can express it.
 */
export function diffDocuments(
  current: Document,
  target: Document,
): StoreCommit | null {
  if (
    current.id !== target.id ||
    current.title !== target.title ||
    current.schemaVersion !== target.schemaVersion ||
    !same(current.extensions, target.extensions) ||
    !same(current.unknownRecords, target.unknownRecords)
  )
    return null;
  const currentElements = new Map(
    current.elements.map((element) => [element.id, element]),
  );
  const targetElements = new Map(
    target.elements.map((element) => [element.id, element]),
  );
  const currentPages = new Map(current.pages.map((page) => [page.id, page]));
  const targetPages = new Map(target.pages.map((page) => [page.id, page]));
  return {
    insertPages: target.pages.filter((page) => !currentPages.has(page.id)),
    updatePages: target.pages.filter((page) => {
      const before = currentPages.get(page.id);
      return before !== undefined && !same(before, page);
    }),
    removePages: current.pages
      .filter((page) => !targetPages.has(page.id))
      .map((page) => page.id),
    insert: target.elements.filter(
      (element) => !currentElements.has(element.id),
    ),
    update: target.elements.filter((element) => {
      const before = currentElements.get(element.id);
      return before !== undefined && !same(before, element);
    }),
    remove: current.elements
      .filter((element) => !targetElements.has(element.id))
      .map((element) => element.id),
  };
}

export function isEmptyCommit(commit: StoreCommit): boolean {
  return (
    !commit.insert?.length &&
    !commit.update?.length &&
    !commit.remove?.length &&
    !commit.insertPages?.length &&
    !commit.updatePages?.length &&
    !commit.removePages?.length
  );
}
