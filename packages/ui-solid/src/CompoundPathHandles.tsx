import {
  type Editor,
  PathAnchorDrag,
  pathWorldContours,
  strokePath,
  type Vec,
} from "@diagra/core";
import type { Element, FreehandPoint } from "@diagra/ir";
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";

export function CompoundPathHandles(props: {
  editor: Editor;
  element: Element;
  zoom: number;
  toPage: (event: PointerEvent) => Vec;
}): JSX.Element {
  const [preview, setPreview] = createSignal<
    readonly (readonly FreehandPoint[])[] | null
  >(null);
  const source = createMemo(() => pathWorldContours(props.element));
  const drag = new PathAnchorDrag(props.editor, setPreview);
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
  const at = (contour: number, index: number) =>
    (preview() ?? source())[contour]?.[index];
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
        {(contours) => (
          <path
            d={contours()
              .map((contour) => strokePath(contour, true))
              .join(" ")}
            fill="none"
            stroke="#db6d28"
            stroke-width={2 / props.zoom}
            style={{ "pointer-events": "none" }}
          />
        )}
      </Show>
      <For each={source()}>
        {(points, contourIndex) => (
          <For each={points}>
            {(_, pointIndex) => (
              <>
                <For each={["controlIn", "controlOut"] as const}>
                  {(control) => (
                    <Show when={at(contourIndex(), pointIndex())?.[control]}>
                      {(handle) => (
                        <>
                          <line
                            x1={at(contourIndex(), pointIndex())?.x}
                            y1={at(contourIndex(), pointIndex())?.y}
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
                                  contourIndex(),
                                  pointIndex(),
                                  control,
                                )
                              )
                                return;
                              event.preventDefault();
                              event.currentTarget.setPointerCapture(
                                event.pointerId,
                              );
                            }}
                          >
                            <title>{`${control === "controlIn" ? "Incoming" : "Outgoing"} handle for contour ${contourIndex() + 1}, anchor ${pointIndex() + 1}`}</title>
                          </rect>
                        </>
                      )}
                    </Show>
                  )}
                </For>
                <circle
                  cx={at(contourIndex(), pointIndex())?.x}
                  cy={at(contourIndex(), pointIndex())?.y}
                  r={4 / props.zoom}
                  fill="white"
                  stroke="#db6d28"
                  stroke-width={1.5 / props.zoom}
                  style={{ "pointer-events": "all", cursor: "move" }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (
                      event.button !== 0 ||
                      !drag.start(
                        event.pointerId,
                        props.element.id,
                        contourIndex(),
                        pointIndex(),
                      )
                    )
                      return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                >
                  <title>{`Contour ${contourIndex() + 1}, anchor ${pointIndex() + 1}`}</title>
                </circle>
              </>
            )}
          </For>
        )}
      </For>
    </g>
  );
}
