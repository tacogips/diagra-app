import type { Element, FreehandPoint } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import type { Vec } from "./geometry.ts";
import { moveStrokeAnchor } from "./stroke-edit.ts";
import { planStrokeWorldPoints, strokeWorldPoints } from "./stroke-world.ts";

export class StrokeAnchorDrag {
  private active: {
    pointer: number;
    element: Element;
    index: number;
    points: FreehandPoint[];
    control?: "controlIn" | "controlOut";
  } | null = null;
  private readonly unsubscribes: (() => void)[];
  constructor(
    private readonly editor: Editor,
    private readonly preview: (points: readonly FreehandPoint[] | null) => void,
  ) {
    this.unsubscribes = [
      editor.subscribe(() => this.cancel()),
      editor.camera.subscribe(() => this.cancel()),
      editor.selection.subscribe(() => this.cancel()),
    ];
  }
  start(
    pointer: number,
    id: string,
    index: number,
    control?: "controlIn" | "controlOut",
  ): boolean {
    const element = this.editor.store.get(id);
    if (
      this.active ||
      !element ||
      element.type !== "draw.freehand" ||
      this.editor.createShapeContext().isLocked?.(id)
    )
      return false;
    const points = strokeWorldPoints(element);
    if (!Number.isInteger(index) || !points[index]) return false;
    if (control && !points[index]?.[control]) return false;
    this.active = { pointer, element, index, points, control };
    this.preview(points);
    return true;
  }
  move(pointer: number, point: Vec): void {
    const active = this.active;
    if (
      !active ||
      active.pointer !== pointer ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    )
      return;
    active.points = active.points.map((previous, index) =>
      index === active.index
        ? active.control
          ? { ...previous, [active.control]: { ...point } }
          : moveStrokeAnchor(previous, point)
        : previous,
    );
    this.preview(active.points);
  }
  finish(pointer: number, point: Vec): void {
    if (this.active?.pointer !== pointer) return;
    this.move(pointer, point);
    const active = this.active;
    this.cancel();
    if (!active) return;
    const originalPoint = strokeWorldPoints(active.element)[active.index];
    const nextPoint = active.points[active.index];
    const original = active.control
      ? originalPoint?.[active.control]
      : originalPoint;
    const next = active.control ? nextPoint?.[active.control] : nextPoint;
    if (original?.x === next?.x && original?.y === next?.y) return;
    this.editor.apply(planStrokeWorldPoints(active.element, active.points));
  }
  cancel(pointer?: number): void {
    if (
      !this.active ||
      (pointer !== undefined && this.active.pointer !== pointer)
    )
      return;
    this.active = null;
    this.preview(null);
  }
  dispose(): void {
    this.cancel();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
  }
}
