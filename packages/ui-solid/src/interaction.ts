// Pointer and keyboard gestures.
//
// One state machine, one gesture at a time. Everything it does to the
// document goes through `editor.apply` (or an editor helper that does), and
// every drag is wrapped in `beginBatch`/`endBatch` so a hundred pointer
// moves undo as one step.
//
// Camera changes deliberately do not touch history: panning and zooming are
// not edits.

import type { Box, Editor, Vec } from "@diagra/core";
import { normalizeBox } from "@diagra/core";
import type { Element, ElementId } from "@diagra/ir";
import { type Accessor, createSignal } from "solid-js";
import { creationFor, type ToolKind } from "./tools.ts";

export const RESIZE_HANDLES = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;

export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** Nothing may be resized below this, in page units. */
export const MIN_SHAPE_SIZE = 8;

/** Wheel delta in "lines" is converted to pixels with this factor. */
const LINE_HEIGHT = 16;

export interface PendingConnection {
  readonly from: Vec;
  readonly to: Vec;
}

type Gesture =
  | { readonly kind: "idle" }
  | { readonly kind: "panning"; lastScreen: Vec }
  | {
      readonly kind: "translating";
      readonly startPage: Vec;
      readonly origins: ReadonlyMap<ElementId, Vec>;
    }
  | {
      readonly kind: "resizing";
      readonly id: ElementId;
      readonly handle: ResizeHandle;
      readonly startPage: Vec;
      readonly startBox: Box;
    }
  | { readonly kind: "connecting"; readonly from: ElementId };

export interface InteractionOptions {
  readonly tool: Accessor<ToolKind>;
  readonly setTool: (tool: ToolKind) => void;
  readonly container: () => HTMLElement | undefined;
}

export interface Interaction {
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(event: PointerEvent): void;
  onPointerCancel(event: PointerEvent): void;
  onWheel(event: WheelEvent): void;
  onKeyDown(event: KeyboardEvent): void;
  startResize(id: ElementId, handle: ResizeHandle, event: PointerEvent): void;
  readonly pending: Accessor<PendingConnection | null>;
}

function wheelPixels(delta: number, mode: number): number {
  return mode === 0 ? delta : delta * LINE_HEIGHT;
}

/** Grow the edges the handle owns, then normalize and enforce a minimum. */
export function resizeBox(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): Box {
  const left = handle.includes("w") ? start.x + dx : start.x;
  const right = handle.includes("e")
    ? start.x + start.width + dx
    : start.x + start.width;
  const top = handle.includes("n") ? start.y + dy : start.y;
  const bottom = handle.includes("s")
    ? start.y + start.height + dy
    : start.y + start.height;
  const box = normalizeBox({ x: left, y: top }, { x: right, y: bottom });
  return {
    x: box.x,
    y: box.y,
    width: Math.max(MIN_SHAPE_SIZE, box.width),
    height: Math.max(MIN_SHAPE_SIZE, box.height),
  };
}

function elementOrigin(element: Element): Vec | null {
  const { x, y } = element.visual;
  return x === undefined || y === undefined ? null : { x, y };
}

export function createInteraction(
  editor: Editor,
  options: InteractionOptions,
): Interaction {
  let gesture: Gesture = { kind: "idle" };
  const [pending, setPending] = createSignal<PendingConnection | null>(null);

  const screenPoint = (event: { clientX: number; clientY: number }): Vec => {
    const container = options.container();
    if (!container) {
      return { x: event.clientX, y: event.clientY };
    }
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pagePoint = (event: { clientX: number; clientY: number }): Vec =>
    editor.camera.screenToPage(screenPoint(event));

  const capture = (event: PointerEvent): void => {
    try {
      options.container()?.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone, or the event was synthesized. Capture is
      // an optimisation - it keeps a drag alive outside the canvas - so
      // losing it must not abort the gesture that was about to start.
    }
  };

  const release = (event: PointerEvent): void => {
    const container = options.container();
    if (container?.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
  };

  const finishGesture = (): void => {
    if (gesture.kind === "translating" || gesture.kind === "resizing") {
      editor.endBatch();
    }
    gesture = { kind: "idle" };
    setPending(null);
  };

  const beginTranslate = (startPage: Vec): boolean => {
    const origins = new Map<ElementId, Vec>();
    for (const id of editor.selection.ids()) {
      const element = editor.store.get(id);
      const origin = element ? elementOrigin(element) : null;
      if (origin) {
        origins.set(id, origin);
      }
    }
    if (origins.size === 0) {
      return false;
    }
    editor.beginBatch();
    gesture = { kind: "translating", startPage, origins };
    return true;
  };

  const placeShape = (point: Vec, tool: ToolKind): void => {
    const creation = creationFor(tool);
    if (!creation) {
      return;
    }
    const draft = editor.buildElement(creation.type, {
      semantic: creation.semantic,
      visual: { x: point.x, y: point.y },
    });
    const box = editor
      .getShapeUtil(creation.type)
      .getBounds(draft, editor.createShapeContext());
    const element: Element = {
      ...draft,
      visual: {
        ...draft.visual,
        x: point.x - (box?.width ?? 0) / 2,
        y: point.y - (box?.height ?? 0) / 2,
      },
    };
    editor.apply([{ type: "createElement", element }]);
    editor.selection.set([element.id]);
    options.setTool("select");
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    options.container()?.focus();
    const tool = options.tool();
    const point = pagePoint(event);
    capture(event);

    // Middle button and the hand tool always pan, whatever else is active.
    if (event.button === 1 || tool === "hand") {
      gesture = { kind: "panning", lastScreen: screenPoint(event) };
      return;
    }

    if (creationFor(tool)) {
      placeShape(point, tool);
      return;
    }

    const hit = editor.hitTest(point);

    if (tool === "edge") {
      if (hit) {
        gesture = { kind: "connecting", from: hit };
        setPending({ from: point, to: point });
      }
      return;
    }

    if (!hit) {
      editor.selection.clear();
      gesture = { kind: "panning", lastScreen: screenPoint(event) };
      return;
    }

    if (event.shiftKey) {
      editor.selection.toggle(hit);
    } else if (!editor.selection.has(hit)) {
      editor.selection.set([hit]);
    }
    if (!beginTranslate(point)) {
      gesture = { kind: "panning", lastScreen: screenPoint(event) };
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    switch (gesture.kind) {
      case "panning": {
        const now = screenPoint(event);
        editor.camera.panBy(
          now.x - gesture.lastScreen.x,
          now.y - gesture.lastScreen.y,
        );
        gesture.lastScreen = now;
        return;
      }
      case "translating": {
        const point = pagePoint(event);
        const dx = point.x - gesture.startPage.x;
        const dy = point.y - gesture.startPage.y;
        editor.moveElements(
          [...gesture.origins].map(([id, origin]) => ({
            id,
            x: origin.x + dx,
            y: origin.y + dy,
          })),
        );
        return;
      }
      case "resizing": {
        const point = pagePoint(event);
        editor.resizeElement(
          gesture.id,
          resizeBox(
            gesture.startBox,
            gesture.handle,
            point.x - gesture.startPage.x,
            point.y - gesture.startPage.y,
          ),
        );
        return;
      }
      case "connecting": {
        const from = editor.getBounds(gesture.from);
        const point = pagePoint(event);
        setPending({
          from: from
            ? { x: from.x + from.width / 2, y: from.y + from.height / 2 }
            : point,
          to: point,
        });
        return;
      }
      default:
        return;
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (gesture.kind === "connecting") {
      const target = editor.hitTest(pagePoint(event));
      if (target) {
        const created = editor.connect(gesture.from, target);
        if (created) {
          editor.selection.set([created]);
        }
      }
    }
    release(event);
    finishGesture();
  };

  const onPointerCancel = (event: PointerEvent): void => {
    release(event);
    finishGesture();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const dy = wheelPixels(event.deltaY, event.deltaMode);
    if (event.ctrlKey || event.metaKey) {
      editor.camera.zoomBy(Math.exp(-dy * 0.0015), screenPoint(event));
      return;
    }
    editor.camera.panBy(-wheelPixels(event.deltaX, event.deltaMode), -dy);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        editor.redo();
      } else {
        editor.undo();
      }
      return;
    }
    if (modifier && key === "y") {
      event.preventDefault();
      editor.redo();
      return;
    }
    if (key === "delete" || key === "backspace") {
      if (editor.selection.size > 0) {
        event.preventDefault();
        editor.deleteSelection();
      }
      return;
    }
    if (key === "escape") {
      event.preventDefault();
      finishGesture();
      editor.selection.clear();
      options.setTool("select");
    }
  };

  const startResize = (
    id: ElementId,
    handle: ResizeHandle,
    event: PointerEvent,
  ): void => {
    const startBox = editor.getBounds(id);
    if (!startBox) {
      return;
    }
    event.stopPropagation();
    capture(event);
    editor.beginBatch();
    gesture = {
      kind: "resizing",
      id,
      handle,
      startPage: pagePoint(event),
      startBox,
    };
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onWheel,
    onKeyDown,
    startResize,
    pending,
  };
}
