import type { ElementId } from "@diagra/ir";
import { isReviewComment, moveReviewComment } from "./comments.ts";
import type { Editor } from "./editor.ts";
import type { Vec } from "./geometry.ts";

export interface ReviewCommentPinPreview {
  readonly id: ElementId;
  readonly point: Vec;
}

/**
 * Preview a comment-pin drag without writing transient pointer moves into the
 * document. The final page-space position is one undoable editor command.
 */
export class ReviewCommentPinDrag {
  private active: {
    readonly pointer: number;
    readonly id: ElementId;
    readonly startScreen: Vec;
    readonly origin: Vec;
    readonly zoom: number;
    point: Vec;
  } | null = null;
  private readonly unsubscribes: (() => void)[];

  constructor(
    private readonly editor: Editor,
    private readonly preview: (value: ReviewCommentPinPreview | null) => void,
  ) {
    this.unsubscribes = [
      editor.subscribe(() => this.cancel()),
      editor.camera.subscribe(() => this.cancel()),
    ];
  }

  start(pointer: number, id: ElementId, screen: Vec, zoom: number): boolean {
    const element = this.editor.store.get(id);
    if (
      this.active ||
      !isReviewComment(element) ||
      element.semantic.resolved ||
      this.editor.createShapeContext().isLocked?.(id) ||
      !Number.isFinite(screen.x) ||
      !Number.isFinite(screen.y) ||
      !Number.isFinite(zoom) ||
      zoom <= 0
    )
      return false;
    const origin = {
      x: element.visual.x ?? 0,
      y: element.visual.y ?? 0,
    };
    this.active = {
      pointer,
      id,
      startScreen: { ...screen },
      origin,
      zoom,
      point: origin,
    };
    this.preview({ id, point: origin });
    return true;
  }

  move(pointer: number, screen: Vec): void {
    const active = this.active;
    if (
      !active ||
      active.pointer !== pointer ||
      !Number.isFinite(screen.x) ||
      !Number.isFinite(screen.y)
    )
      return;
    active.point = {
      x: active.origin.x + (screen.x - active.startScreen.x) / active.zoom,
      y: active.origin.y + (screen.y - active.startScreen.y) / active.zoom,
    };
    this.preview({ id: active.id, point: active.point });
  }

  finish(pointer: number, screen: Vec): boolean {
    if (this.active?.pointer !== pointer) return false;
    this.move(pointer, screen);
    const active = this.active;
    this.active = null;
    this.preview(null);
    return active
      ? moveReviewComment(this.editor, active.id, active.point)
      : false;
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
