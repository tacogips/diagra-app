import type { Editor, Vec } from "@nodetto/core";
import type { PageId } from "@nodetto/ir";

export interface PageTabBox {
  readonly id: PageId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface PageTabDrop {
  readonly id: PageId;
  readonly side: "before" | "after";
}

/** Hit the tab row under the pointer, including wrapped tab strips. */
export function pageTabDropAt(
  point: Vec,
  boxes: readonly PageTabBox[],
): PageTabDrop | null {
  const row = boxes.filter(
    (box) => point.y >= box.y && point.y <= box.y + box.height,
  );
  const first = row[0];
  const last = row.at(-1);
  if (
    !first ||
    !last ||
    point.x < first.x - 16 ||
    point.x > last.x + last.width + 16
  )
    return null;
  const before = row.find((box) => point.x < box.x + box.width / 2);
  return before
    ? { id: before.id, side: "before" }
    : { id: last.id, side: "after" };
}

/** Preview while moving; only the release writes the page order. */
export class PageTabDrag {
  private pending: {
    id: PageId;
    pointerId: number;
    start: Vec;
    revision: number;
    moved: boolean;
    drop: PageTabDrop | null;
  } | null = null;
  constructor(private readonly editor: Editor) {}

  owns(pointerId: number): boolean {
    return this.pending?.pointerId === pointerId;
  }

  get id(): PageId | null {
    return this.pending?.id ?? null;
  }
  get moved(): boolean {
    return this.pending?.moved ?? false;
  }
  get available(): boolean {
    return (
      this.pending !== null &&
      !this.editor.readOnly &&
      this.pending.revision === this.editor.documentOpenRevision &&
      this.editor.store.getPage(this.pending.id) !== undefined
    );
  }
  start(id: PageId, pointerId: number, point: Vec): boolean {
    if (this.pending || this.editor.readOnly || !this.editor.store.getPage(id))
      return false;
    this.pending = {
      id,
      pointerId,
      start: point,
      revision: this.editor.documentOpenRevision,
      moved: false,
      drop: null,
    };
    return true;
  }
  move(
    pointerId: number,
    point: Vec,
    boxes: readonly PageTabBox[],
  ): PageTabDrop | null {
    const pending = this.pending;
    if (!pending || pending.pointerId !== pointerId || !this.available)
      return null;
    if (Math.hypot(point.x - pending.start.x, point.y - pending.start.y) > 4)
      pending.moved = true;
    pending.drop = pending.moved ? pageTabDropAt(point, boxes) : null;
    return pending.drop;
  }
  finish(pointerId: number): { dragged: boolean; reordered: boolean } {
    const pending = this.pending;
    if (!pending || pending.pointerId !== pointerId)
      return { dragged: false, reordered: false };
    const available = this.available;
    this.pending = null;
    if (
      !available ||
      !pending.moved ||
      !pending.drop ||
      pending.drop.id === pending.id
    )
      return { dragged: pending.moved, reordered: false };
    const remaining = this.editor.store
      .listPages()
      .filter((page) => page.id !== pending.id);
    const anchor = remaining.findIndex((page) => page.id === pending.drop?.id);
    if (anchor < 0) return { dragged: true, reordered: false };
    return {
      dragged: true,
      reordered: this.editor.reorderPageTo(
        pending.id,
        anchor + (pending.drop.side === "after" ? 1 : 0),
      ),
    };
  }
  cancel(): void {
    this.pending = null;
  }
}
