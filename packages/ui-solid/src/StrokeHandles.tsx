import {
  type Editor,
  StrokeAnchorDrag,
  strokeWorldPoints,
  strokePath,
  type Vec,
} from "@diagra/core";
import type { Element, FreehandPoint, FreehandSemantic } from "@diagra/ir";
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";

export function StrokeHandles(props: {
  editor: Editor;
  element: Element;
  zoom: number;
  toPage: (event: PointerEvent) => Vec;
}): JSX.Element {
  const [preview, setPreview] = createSignal<readonly FreehandPoint[] | null>(
    null,
  );
  const source = createMemo(() => strokeWorldPoints(props.element));
  const drag = new StrokeAnchorDrag(props.editor, setPreview);
  const cancel = (): void => drag.cancel();
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") cancel();
  };
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
  onCleanup(() => {
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    drag.dispose();
  });
  const at = (index: number) => (preview() ?? source())[index];
  return (
    <g
      onPointerMove={(event) => {
        event.stopPropagation();
        drag.move(event.pointerId, props.toPage(event));
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        drag.finish(event.pointerId, props.toPage(event));
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        drag.cancel(event.pointerId);
      }}
      onLostPointerCapture={(event) => drag.cancel(event.pointerId)}
    >
      <Show when={preview()}>
        {(points) => (
          <path
            d={strokePath(
              points(),
              (props.element.semantic as FreehandSemantic).closed,
            )}
            fill="none"
            stroke="#db6d28"
            stroke-width={2 / props.zoom}
            style={{ "pointer-events": "none" }}
          />
        )}
      </Show>
      <For each={source()}>
        {(_, index) => (
          <For each={["controlIn", "controlOut"] as const}>
            {(control) => (
              <Show when={at(index())?.[control]}>
                {(handle) => (
                  <>
                    <line
                      x1={at(index())?.x}
                      y1={at(index())?.y}
                      x2={handle().x}
                      y2={handle().y}
                      stroke="#7c3aed"
                      stroke-width={1 / props.zoom}
                      style={{ "pointer-events": "none" }}
                    />
                    <rect
                      x={handle().x - 3.5 / props.zoom}
                      y={handle().y - 3.5 / props.zoom}
                      width={7 / props.zoom}
                      height={7 / props.zoom}
                      fill="white"
                      stroke="#7c3aed"
                      stroke-width={1.5 / props.zoom}
                      style={{ "pointer-events": "all", cursor: "move" }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (
                          event.button !== 0 ||
                          !drag.start(
                            event.pointerId,
                            props.element.id,
                            index(),
                            control,
                          )
                        )
                          return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                    >
                      <title>
                        {control === "controlIn" ? "Incoming" : "Outgoing"}{" "}
                        handle for anchor {index() + 1}
                      </title>
                    </rect>
                  </>
                )}
              </Show>
            )}
          </For>
        )}
      </For>
      <For each={source()}>
        {(_, index) => (
          <circle
            cx={at(index())?.x}
            cy={at(index())?.y}
            r={4 / props.zoom}
            fill="white"
            stroke="#db6d28"
            stroke-width={1.5 / props.zoom}
            style={{ "pointer-events": "all", cursor: "move" }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (
                event.button !== 0 ||
                !drag.start(event.pointerId, props.element.id, index())
              )
                return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
          >
            <title>
              Anchor {index() + 1}; use Stroke anchors in the inspector for
              keyboard editing
            </title>
          </circle>
        )}
      </For>
    </g>
  );
}
