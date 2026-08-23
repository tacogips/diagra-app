// Selection: which elements the next gesture acts on.
//
// Ephemeral like the camera — never serialized, never undoable — but it does
// listen to the store so a deleted element cannot stay selected and hand a
// stale id to the next command.

import type { ElementId } from "@diagra/ir";
import { type Box, unionBoxes } from "./geometry.ts";
import type { ShapeContext, ShapeUtilRegistry } from "./shape-util.ts";
import type { Store, StoreDiff } from "./store.ts";

export type SelectionListener = (ids: ReadonlySet<ElementId>) => void;

export class Selection {
  private selected: ReadonlySet<ElementId> = new Set();
  private readonly listeners = new Set<SelectionListener>();

  ids(): ReadonlySet<ElementId> {
    return this.selected;
  }

  get size(): number {
    return this.selected.size;
  }

  has(id: ElementId): boolean {
    return this.selected.has(id);
  }

  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(ids: Iterable<ElementId>): void {
    this.replace(new Set(ids));
  }

  add(id: ElementId): void {
    if (this.selected.has(id)) {
      return;
    }
    const next = new Set(this.selected);
    next.add(id);
    this.replace(next);
  }

  toggle(id: ElementId): void {
    const next = new Set(this.selected);
    if (!next.delete(id)) {
      next.add(id);
    }
    this.replace(next);
  }

  clear(): void {
    if (this.selected.size === 0) {
      return;
    }
    this.replace(new Set());
  }

  /** Drop ids the store no longer holds. Wired to the store by the editor. */
  prune(diff: StoreDiff): void {
    if (diff.removed.length === 0 || this.selected.size === 0) {
      return;
    }
    const next = new Set(this.selected);
    let changed = false;
    for (const id of diff.removed) {
      changed = next.delete(id) || changed;
    }
    if (changed) {
      this.replace(next);
    }
  }

  private replace(next: ReadonlySet<ElementId>): void {
    this.selected = next;
    for (const listener of [...this.listeners]) {
      listener(next);
    }
  }
}

/**
 * Union of the selected elements' bounds, or `null` when nothing selected
 * contributes geometry (an unresolved connector, for instance).
 */
export function getSelectionBounds(
  selection: Selection,
  store: Store,
  registry: ShapeUtilRegistry,
  context: ShapeContext,
): Box | null {
  const boxes: Box[] = [];
  for (const id of selection.ids()) {
    const element = store.get(id);
    if (!element) {
      continue;
    }
    const box = registry
      .getOrFallback(element.type)
      .getBounds(element, context);
    if (box) {
      boxes.push(box);
    }
  }
  return unionBoxes(boxes);
}
