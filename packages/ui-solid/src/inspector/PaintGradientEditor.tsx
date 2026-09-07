import type { FillGradient, GradientStop } from "@diagra/ir";
import { For, type JSX, Show } from "solid-js";
import { Field, NumberInput, SelectInput } from "./controls.tsx";

export function PaintGradientEditor(props: {
  readonly label: string;
  readonly gradient: FillGradient | undefined;
  readonly fallback: string;
  readonly onCommit: (gradient: FillGradient | null) => void;
}): JSX.Element {
  const defaultGradient = (): FillGradient => ({
    type: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: props.fallback },
      { offset: 1, color: "#7c3aed" },
    ],
  });
  const gradient = (): FillGradient => props.gradient ?? defaultGradient();
  const centered = () => {
    const current = gradient();
    return current.type === "linear" ? null : current;
  };
  const angled = () => {
    const current = gradient();
    return current.type === "radial" ? null : current;
  };
  const sized = () => {
    const current = gradient();
    return current.type === "radial" || current.type === "diamond"
      ? current
      : null;
  };
  const updateStop = (index: number, patch: Partial<GradientStop>): void => {
    const current = gradient();
    props.onCommit({
      ...current,
      stops: current.stops.map((stop, at) =>
        at === index ? { ...stop, ...patch } : stop,
      ),
    } as FillGradient);
  };
  return (
    <div class="diagra-gradient-editor">
      <label>
        <input
          type="checkbox"
          checked={props.gradient !== undefined}
          onChange={(event) =>
            props.onCommit(
              event.currentTarget.checked ? defaultGradient() : null,
            )
          }
        />
        {props.label} gradient
      </label>
      <Show when={props.gradient}>
        <Field label={`${props.label} type`}>
          <SelectInput
            label={`${props.label} gradient type`}
            value={gradient().type}
            options={[
              { value: "linear", label: "Linear" },
              { value: "radial", label: "Radial" },
              { value: "angular", label: "Angular" },
              { value: "diamond", label: "Diamond" },
            ]}
            onCommit={(type) => {
              const stops = gradient().stops;
              if (type === "linear") props.onCommit({ type, angle: 90, stops });
              else if (type === "radial")
                props.onCommit({
                  type,
                  centerX: 0.5,
                  centerY: 0.5,
                  radius: 0.5,
                  stops,
                });
              else if (type === "angular")
                props.onCommit({
                  type,
                  centerX: 0.5,
                  centerY: 0.5,
                  angle: 0,
                  stops,
                });
              else
                props.onCommit({
                  type: "diamond",
                  centerX: 0.5,
                  centerY: 0.5,
                  radius: 0.5,
                  angle: 0,
                  stops,
                });
            }}
          />
        </Field>
        <Show when={centered()}>
          <For each={["centerX", "centerY"] as const}>
            {(field) => (
              <Field label={field === "centerX" ? "Center X" : "Center Y"}>
                <NumberInput
                  label={`${props.label} gradient ${field} percent`}
                  min={0}
                  max={100}
                  value={(centered()?.[field] ?? 0.5) * 100}
                  onCommit={(percent) => {
                    const current = gradient();
                    if (current.type !== "linear")
                      props.onCommit({
                        ...current,
                        [field]: percent / 100,
                      } as FillGradient);
                  }}
                />
              </Field>
            )}
          </For>
        </Show>
        <Show when={sized()}>
          <Field label="Radius">
            <NumberInput
              label={`${props.label} gradient radius percent`}
              min={1}
              max={200}
              value={(sized()?.radius ?? 0.5) * 100}
              onCommit={(percent) => {
                const current = gradient();
                if (current.type === "radial" || current.type === "diamond")
                  props.onCommit({ ...current, radius: percent / 100 });
              }}
            />
          </Field>
        </Show>
        <Show when={angled()}>
          <Field label="Angle">
            <NumberInput
              label={`${props.label} gradient angle`}
              value={angled()?.angle ?? 0}
              onCommit={(angle) => {
                const current = gradient();
                if (current.type !== "radial")
                  props.onCommit({ ...current, angle } as FillGradient);
              }}
            />
          </Field>
        </Show>
        <For each={gradient().stops}>
          {(stop, index) => (
            <div class="diagra-gradient-stop">
              <input
                type="color"
                aria-label={`${props.label} gradient stop ${index() + 1} color`}
                value={stop.color}
                onChange={(event) =>
                  updateStop(index(), { color: event.currentTarget.value })
                }
              />
              <NumberInput
                label={`${props.label} gradient stop ${index() + 1} position percent`}
                min={0}
                max={100}
                value={Math.round(stop.offset * 100)}
                onCommit={(percent) => {
                  const stops = gradient().stops;
                  updateStop(index(), {
                    offset: Math.max(
                      stops[index() - 1]?.offset ?? 0,
                      Math.min(stops[index() + 1]?.offset ?? 1, percent / 100),
                    ),
                  });
                }}
              />
              <NumberInput
                label={`${props.label} gradient stop ${index() + 1} opacity percent`}
                min={0}
                max={100}
                value={Math.round((stop.opacity ?? 1) * 100)}
                onCommit={(opacity) =>
                  updateStop(index(), { opacity: opacity / 100 })
                }
              />
              <button
                type="button"
                disabled={gradient().stops.length <= 2}
                onClick={() => {
                  const current = gradient();
                  props.onCommit({
                    ...current,
                    stops: current.stops.filter((_, at) => at !== index()),
                  } as FillGradient);
                }}
              >
                Remove stop
              </button>
            </div>
          )}
        </For>
        <button
          type="button"
          disabled={gradient().stops.length >= 8}
          onClick={() => {
            const current = gradient();
            const last = current.stops.at(-1) as GradientStop;
            const previous = current.stops.at(-2) as GradientStop;
            props.onCommit({
              ...current,
              stops: [
                ...current.stops.slice(0, -1),
                {
                  offset: (previous.offset + last.offset) / 2,
                  color: previous.color,
                },
                last,
              ],
            } as FillGradient);
          }}
        >
          Add {props.label.toLowerCase()} gradient stop
        </button>
      </Show>
    </div>
  );
}
