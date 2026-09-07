import {
  boxCenter,
  gradientHandleGeometry,
  type Box,
  type Editor,
  type GradientHandle,
  moveGradientHandle,
  rotatePoint,
  setElementFillGradient,
  setElementStrokeGradient,
  type Vec,
} from "@diagra/core";
import type { Element, FillGradient } from "@diagra/ir";
import { createMemo, createSignal, For, type JSX, onCleanup } from "solid-js";

export function GradientHandles(props: {
  readonly editor: Editor;
  readonly element: Element;
  readonly box: Box;
  readonly zoom: number;
  readonly toPage: (event: PointerEvent) => Vec;
  readonly paint: "fill" | "stroke";
}): JSX.Element {
  const source = () =>
    (props.paint === "fill"
      ? props.element.visual.style?.fillGradient
      : props.element.visual.style?.strokeGradient) as FillGradient;
  const [preview, setPreview] = createSignal<FillGradient | null>(null);
  let active: { pointer: number; handle: GradientHandle } | null = null;
  const gradient = () => preview() ?? source();
  const geometry = createMemo(() =>
    gradientHandleGeometry(gradient(), props.box),
  );
  const rotation = () => props.element.visual.rotation ?? 0;
  const localPoint = (event: PointerEvent) =>
    rotatePoint(props.toPage(event), boxCenter(props.box), -rotation());
  const cancel = (): void => {
    active = null;
    setPreview(null);
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") cancel();
  };
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
  onCleanup(() => {
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
  });
  const move = (event: PointerEvent): void => {
    if (active?.pointer !== event.pointerId) return;
    setPreview(
      moveGradientHandle(
        gradient(),
        active.handle,
        localPoint(event),
        props.box,
      ),
    );
  };
  const finish = (event: PointerEvent): void => {
    if (active?.pointer !== event.pointerId) return;
    move(event);
    const next = preview();
    cancel();
    if (!next) return;
    if (props.paint === "fill")
      setElementFillGradient(props.editor, props.element.id, next);
    else setElementStrokeGradient(props.editor, props.element.id, next);
  };
  const start = (
    handle: GradientHandle,
    event: PointerEvent & { currentTarget: SVGElement },
  ): void => {
    event.stopPropagation();
    if (event.button !== 0 || active) return;
    event.preventDefault();
    active = { pointer: event.pointerId, handle };
    setPreview(source());
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleRadius = () => 6 / props.zoom;
  const stopRadius = () => 5 / props.zoom;
  const startHandle = (): GradientHandle => {
    switch (gradient().type) {
      case "linear":
        return { kind: "linear-start" };
      case "radial":
        return { kind: "radial-center" };
      case "angular":
        return { kind: "angular-center" };
      case "diamond":
        return { kind: "diamond-center" };
    }
  };
  const endHandle = (): GradientHandle => {
    switch (gradient().type) {
      case "linear":
        return { kind: "linear-end" };
      case "radial":
        return { kind: "radial-radius" };
      case "angular":
        return { kind: "angular-angle" };
      case "diamond":
        return { kind: "diamond-radius" };
    }
  };
  return (
    <g
      transform={
        rotation()
          ? `rotate(${rotation()} ${boxCenter(props.box).x} ${boxCenter(props.box).y})`
          : undefined
      }
      onPointerMove={(event) => {
        event.stopPropagation();
        move(event);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        finish(event);
      }}
      onPointerCancel={(event) => {
        if (active?.pointer === event.pointerId) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (active?.pointer === event.pointerId) cancel();
      }}
    >
      <line
        class="diagra-gradient-axis"
        x1={geometry().start.x}
        y1={geometry().start.y}
        x2={geometry().end.x}
        y2={geometry().end.y}
        vector-effect="non-scaling-stroke"
      />
      <For each={geometry().stops}>
        {(point, index) => (
          <circle
            class="diagra-gradient-stop-handle"
            cx={point.x}
            cy={point.y}
            r={stopRadius()}
            fill={gradient().stops[index()]?.color ?? "#ffffff"}
            vector-effect="non-scaling-stroke"
            onPointerDown={(event) =>
              start({ kind: "stop", index: index() }, event)
            }
          >
            <title>Gradient stop {index() + 1}</title>
          </circle>
        )}
      </For>
      <circle
        class="diagra-gradient-geometry-handle"
        cx={geometry().start.x}
        cy={geometry().start.y}
        r={handleRadius()}
        vector-effect="non-scaling-stroke"
        onPointerDown={(event) => start(startHandle(), event)}
      >
        <title>
          {gradient().type === "linear"
            ? "Gradient direction"
            : "Gradient center"}
        </title>
      </circle>
      <circle
        class="diagra-gradient-geometry-handle"
        cx={geometry().end.x}
        cy={geometry().end.y}
        r={handleRadius()}
        vector-effect="non-scaling-stroke"
        onPointerDown={(event) => start(endHandle(), event)}
      >
        <title>
          {gradient().type === "angular"
            ? "Gradient zero-stop direction"
            : gradient().type === "linear"
              ? "Gradient direction"
              : "Gradient radius and direction"}
        </title>
      </circle>
    </g>
  );
}
