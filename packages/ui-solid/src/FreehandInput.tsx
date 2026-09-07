import {
  type Editor,
  FreehandGesture,
  pressureStrokeOutline,
} from "@diagra/core";
import type { FreehandPoint } from "@diagra/ir";
import { createMemo, createSignal, type JSX, onCleanup } from "solid-js";
export function FreehandInput(props: { editor: Editor }): JSX.Element {
  const [points, setPoints] = createSignal<readonly FreehandPoint[]>([]);
  const gesture = new FreehandGesture(props.editor, setPoints);
  const cancelOnEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") gesture.cancel();
  };
  const cancel = (): void => gesture.cancel();
  window.addEventListener("keydown", cancelOnEscape, true);
  window.addEventListener("blur", cancel);
  onCleanup(() => {
    window.removeEventListener("keydown", cancelOnEscape, true);
    window.removeEventListener("blur", cancel);
    gesture.dispose();
  });
  const sample = (event: PointerEvent): FreehandPoint => {
    const bounds = (
      event.currentTarget as SVGSVGElement
    ).getBoundingClientRect();
    return {
      ...props.editor.camera.screenToPage({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      }),
      pressure:
        event.pointerType === "mouse" && event.pressure === 0
          ? 0.5
          : event.pressure,
    };
  };
  const preview = createMemo(() =>
    pressureStrokeOutline(
      points().map((point) => ({
        ...props.editor.camera.pageToScreen(point),
        pressure: point.pressure,
      })),
      false,
      2,
      0.25,
    ),
  );
  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        "touch-action": "none",
        cursor: "crosshair",
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (
          event.button !== 0 ||
          !gesture.start(event.pointerId, sample(event))
        )
          return;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        gesture.move(event.pointerId, sample(event));
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        gesture.finish(event.pointerId, sample(event));
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        gesture.cancel(event.pointerId);
      }}
      onLostPointerCapture={(event) => gesture.cancel(event.pointerId)}
    >
      <title>Freehand drawing surface</title>
      <path d={preview()?.path ?? ""} fill="#1d2a2e" fill-rule="evenodd" />
    </svg>
  );
}
