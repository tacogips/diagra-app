import type { FreehandPoint } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { freehandGeometry } from "./shapes/freehand.ts";

/** An unfinished stroke never survives a document or camera change. */
export class FreehandGesture {
  private pointer: number | null = null;
  private points: FreehandPoint[] = [];
  private readonly unsubscribe: (() => void)[];

  constructor(
    private readonly editor: Editor,
    private readonly changed: (points: readonly FreehandPoint[]) => void,
  ) {
    this.unsubscribe = [
      editor.subscribe(() => this.cancel()),
      editor.camera.subscribe(() => this.cancel()),
    ];
  }

  start(pointer: number, point: FreehandPoint): boolean {
    if (this.pointer !== null) return false;
    this.pointer = pointer;
    this.points = [point];
    this.changed(this.points.slice());
    return true;
  }

  move(pointer: number, point: FreehandPoint): void {
    if (pointer !== this.pointer || this.points.length >= 20000) return;
    this.points.push(point);
    this.changed(this.points.slice());
  }

  finish(pointer: number, point: FreehandPoint): void {
    if (pointer !== this.pointer) return;
    this.move(pointer, point);
    const points = this.points;
    this.cancel();
    if (points.length < 2) return;
    const draft = this.editor.buildElement("draw.freehand", {
      semantic: { points },
    });
    const geometry = freehandGeometry(draft);
    if (!geometry) return;
    const element = { ...draft, visual: { ...draft.visual, ...geometry.box } };
    this.editor.apply([{ type: "createElement", element }]);
    this.editor.selection.set([element.id]);
  }

  cancel(pointer?: number): void {
    if (
      this.pointer === null ||
      (pointer !== undefined && pointer !== this.pointer)
    )
      return;
    this.pointer = null;
    this.points = [];
    this.changed([]);
  }

  dispose(): void {
    this.cancel();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
  }
}
