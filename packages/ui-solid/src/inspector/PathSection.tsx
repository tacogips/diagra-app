import {
  type Editor,
  moveStrokeAnchor,
  pathWorldContours,
  planPathWorldContours,
  splitStrokeSegment,
} from "@diagra/core";
import type {
  Element,
  FreehandPoint,
  PathFillRule,
  PathSemantic,
} from "@diagra/ir";
import { createSignal, For, type JSX, Show } from "solid-js";
import { Field, NumberInput, Section, SelectInput } from "./controls.tsx";

export function PathSection(props: {
  editor: Editor;
  element: Element;
}): JSX.Element {
  const [chosenContour, setChosenContour] = createSignal(0);
  const [chosenPoint, setChosenPoint] = createSignal(0);
  const contours = () => pathWorldContours(props.element);
  const contourIndex = () =>
    Math.min(chosenContour(), Math.max(0, contours().length - 1));
  const points = () => contours()[contourIndex()] ?? [];
  const pointIndex = () =>
    Math.min(chosenPoint(), Math.max(0, points().length - 1));
  const point = () => points()[pointIndex()];
  const write = (next: readonly (readonly FreehandPoint[])[]): void => {
    props.editor.apply(planPathWorldContours(props.element, next));
  };
  const replacePoints = (next: FreehandPoint[]): void =>
    write(
      contours().map((contour, index) =>
        index === contourIndex() ? next : contour,
      ),
    );
  return (
    <Section title="Vector path">
      <Field label="Fill rule">
        <SelectInput
          label="Path fill rule"
          value={(props.element.semantic as PathSemantic).fillRule}
          options={[
            { value: "evenodd", label: "Even-odd" },
            { value: "nonzero", label: "Non-zero" },
          ]}
          onCommit={(fillRule) =>
            props.editor.apply([
              {
                type: "updateSemantic",
                id: props.element.id,
                semantic: {
                  ...(props.element.semantic as PathSemantic),
                  fillRule: fillRule as PathFillRule,
                },
              },
            ])
          }
        />
      </Field>
      <p>
        {contours().length} contours, {contours().flat().length} anchors.
        Coordinates include layer rotation.
      </p>
      <Field label="Contour">
        <NumberInput
          label="Contour number"
          min={1}
          value={contourIndex() + 1}
          onCommit={(value) => {
            setChosenContour(
              Math.max(
                0,
                Math.min(contours().length - 1, Math.round(value) - 1),
              ),
            );
            setChosenPoint(0);
          }}
        />
      </Field>
      <Show when={point()}>
        <Field label="Anchor">
          <NumberInput
            label="Anchor number"
            min={1}
            value={pointIndex() + 1}
            onCommit={(value) =>
              setChosenPoint(
                Math.max(
                  0,
                  Math.min(points().length - 1, Math.round(value) - 1),
                ),
              )
            }
          />
        </Field>
        <For each={["x", "y"] as const}>
          {(axis) => (
            <Field label={`Anchor ${axis.toUpperCase()}`}>
              <NumberInput
                label={`Anchor ${axis.toUpperCase()}`}
                value={point()?.[axis] ?? 0}
                onCommit={(value) =>
                  replacePoints(
                    points().map((candidate, index) =>
                      index === pointIndex()
                        ? moveStrokeAnchor(candidate, {
                            x: axis === "x" ? value : candidate.x,
                            y: axis === "y" ? value : candidate.y,
                          })
                        : candidate,
                    ),
                  )
                }
              />
            </Field>
          )}
        </For>
        <For each={["controlIn", "controlOut"] as const}>
          {(control) => (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(point()?.[control])}
                  onChange={(event) =>
                    replacePoints(
                      points().map((candidate, index) => {
                        if (index !== pointIndex()) return candidate;
                        const next = { ...candidate };
                        if (event.currentTarget.checked)
                          next[control] = {
                            x:
                              candidate.x +
                              (control === "controlIn" ? -20 : 20),
                            y: candidate.y,
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
                  <For each={["x", "y"] as const}>
                    {(axis) => (
                      <Field label={`Handle ${axis.toUpperCase()}`}>
                        <NumberInput
                          label={`${control} ${axis.toUpperCase()}`}
                          value={handle()[axis]}
                          onCommit={(value) =>
                            replacePoints(
                              points().map((candidate, index) =>
                                index === pointIndex()
                                  ? {
                                      ...candidate,
                                      [control]: {
                                        ...handle(),
                                        [axis]: value,
                                      },
                                    }
                                  : candidate,
                              ),
                            )
                          }
                        />
                      </Field>
                    )}
                  </For>
                )}
              </Show>
            </>
          )}
        </For>
        <button
          type="button"
          disabled={contours().flat().length >= 20000}
          onClick={() => {
            const split = splitStrokeSegment(points(), pointIndex(), true);
            if (!split) return;
            replacePoints(split);
            setChosenPoint(pointIndex() + 1);
          }}
        >
          Split segment after
        </button>
        <button
          type="button"
          disabled={points().length <= 3}
          onClick={() =>
            replacePoints(points().filter((_, index) => index !== pointIndex()))
          }
        >
          Remove anchor
        </button>
      </Show>
      <button
        type="button"
        disabled={contours().length >= 1024 || contours().flat().length > 19997}
        onClick={() => {
          const origin = points()[0] ?? contours()[0]?.[0] ?? { x: 0, y: 0 };
          const next = [
            ...contours(),
            [
              { x: origin.x + 10, y: origin.y + 10 },
              { x: origin.x + 30, y: origin.y + 10 },
              { x: origin.x + 20, y: origin.y + 30 },
            ],
          ];
          write(next);
          setChosenContour(next.length - 1);
          setChosenPoint(0);
        }}
      >
        Add contour
      </button>
      <button
        type="button"
        disabled={contours().length <= 1}
        onClick={() => {
          write(contours().filter((_, index) => index !== contourIndex()));
          setChosenContour(Math.max(0, contourIndex() - 1));
          setChosenPoint(0);
        }}
      >
        Remove contour
      </button>
    </Section>
  );
}
