import {
  type Editor,
  moveStrokeAnchor,
  planStrokeWorldPoints as planStrokePoints,
  planFitStrokeWorldBounds as planFitStrokeBounds,
  planStrokeWorldClosed as planStrokeClosed,
  strokeWorldPoints as strokePagePoints,
  splitStrokeSegment,
} from "@diagra/core";
import type { Element, FreehandPoint, FreehandSemantic } from "@diagra/ir";
import { createSignal, For, type JSX, Show } from "solid-js";
import { Field, NumberInput, Section } from "./controls.tsx";

export function StrokeSection(props: {
  editor: Editor;
  element: Element;
}): JSX.Element {
  const [chosen, setChosen] = createSignal(0);
  const points = () => strokePagePoints(props.element);
  const index = () => Math.min(chosen(), Math.max(0, points().length - 1));
  const point = () => points()[index()];
  const write = (next: FreehandPoint[]): void => {
    props.editor.apply(planStrokePoints(props.element, next));
  };
  const move = (patch: Partial<FreehandPoint>): void =>
    write(
      points().map((point, at) =>
        at === index()
          ? moveStrokeAnchor(point, {
              x: patch.x ?? point.x,
              y: patch.y ?? point.y,
            })
          : point,
      ),
    );
  return (
    <Section title="Stroke anchors">
      <button
        type="button"
        disabled={props.element.visual.strokeBounds === "curve"}
        onClick={() => props.editor.apply(planFitStrokeBounds(props.element))}
      >
        {props.element.visual.strokeBounds === "curve"
          ? "Frame fitted to curve"
          : "Fit frame to curve"}
      </button>
      <p>
        Fits the selection/resize frame without changing the curve. Auto-layout
        parents may reflow.
      </p>
      <p>{points().length} points. Coordinates are in page space.</p>
      <label>
        <input
          type="checkbox"
          checked={(props.element.semantic as FreehandSemantic).closed === true}
          onChange={(event) =>
            props.editor.apply(
              planStrokeClosed(props.element, event.currentTarget.checked),
            )
          }
        />
        Closed path
      </label>
      <div>
        <p>
          Anchor and handle coordinates are in page pixels, including layer
          rotation.
        </p>
        <Show when={point()}>
          <For each={["controlIn", "controlOut"] as const}>
            {(control) => (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(point()?.[control])}
                    onChange={(event) =>
                      write(
                        points().map((point, at) => {
                          if (at !== index()) return point;
                          const next = { ...point };
                          if (event.currentTarget.checked)
                            next[control] = {
                              x: point.x + (control === "controlIn" ? -20 : 20),
                              y: point.y,
                            };
                          else delete next[control];
                          return next;
                        }),
                      )
                    }
                  />
                  {control === "controlIn"
                    ? "Incoming Bézier handle"
                    : "Outgoing Bézier handle"}
                </label>
                <Show when={point()?.[control]}>
                  {(handle) => (
                    <>
                      <Field label="Handle X">
                        <NumberInput
                          label={`${control} X`}
                          value={handle().x}
                          onCommit={(x) =>
                            write(
                              points().map((point, at) =>
                                at === index()
                                  ? { ...point, [control]: { ...handle(), x } }
                                  : point,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label="Handle Y">
                        <NumberInput
                          label={`${control} Y`}
                          value={handle().y}
                          onCommit={(y) =>
                            write(
                              points().map((point, at) =>
                                at === index()
                                  ? { ...point, [control]: { ...handle(), y } }
                                  : point,
                              ),
                            )
                          }
                        />
                      </Field>
                    </>
                  )}
                </Show>
              </>
            )}
          </For>
          <Field label="Point">
            <NumberInput
              label="Point number"
              min={1}
              value={index() + 1}
              onCommit={(value) =>
                setChosen(
                  Math.max(
                    0,
                    Math.min(points().length - 1, Math.round(value) - 1),
                  ),
                )
              }
            />
          </Field>
          <Field label="Point X">
            <NumberInput
              label="Point X"
              value={point()?.x ?? 0}
              onCommit={(x) => move({ x })}
            />
          </Field>
          <Field label="Point Y">
            <NumberInput
              label="Point Y"
              value={point()?.y ?? 0}
              onCommit={(y) => move({ y })}
            />
          </Field>
          <button
            type="button"
            disabled={points().length >= 20000}
            onClick={() => {
              const split = splitStrokeSegment(
                points(),
                index(),
                (props.element.semantic as FreehandSemantic).closed === true,
              );
              if (split) {
                write(split);
                setChosen(index() + 1);
                return;
              }
              const next = points();
              const a = next[index()];
              if (!a) return;
              next.splice(index() + 1, 0, {
                ...(a.pressure === undefined ? {} : { pressure: a.pressure }),
                x: a.x + 10,
                y: a.y,
              });
              write(next);
              setChosen(index() + 1);
            }}
          >
            Insert point after
          </button>
          <button
            type="button"
            disabled={points().length <= 2}
            onClick={() => write(points().filter((_, at) => at !== index()))}
          >
            Remove point
          </button>
        </Show>
      </div>
    </Section>
  );
}
