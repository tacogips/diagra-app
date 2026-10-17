import type { Element, UiControlSemantic } from "@nodetto/ir";
import { For, Match, Switch, type JSX } from "solid-js";
import { fillPaintStyle, strokeBorderStyle } from "./visual.ts";
import "./UiControlView.css";
export function UiControlView(props: {
  element: Element;
  interactive?: boolean;
}): JSX.Element {
  const value = () => props.element.semantic as UiControlSemantic;
  const tab = () => (props.interactive ? 0 : -1);
  const style = () => ({
    ...fillPaintStyle(props.element.visual),
    ...strokeBorderStyle(props.element.visual),
    color: props.element.visual.style?.color,
    "font-size": `${props.element.visual.style?.fontSize ?? 14}px`,
  });
  return (
    <div class="nodetto-ui-control" data-control={value().control}>
      <Switch>
        <Match when={value().control === "button"}>
          <button
            type="button"
            tabIndex={tab()}
            disabled={value().disabled}
            style={style()}
          >
            {value().label}
          </button>
        </Match>
        <Match when={value().control === "input"}>
          <input
            type={value().inputType ?? "text"}
            tabIndex={tab()}
            aria-label={value().label}
            value={value().value ?? ""}
            placeholder={value().placeholder}
            readOnly={!props.interactive}
            disabled={value().disabled}
            style={style()}
          />
        </Match>
        <Match when={value().control === "textarea"}>
          <textarea
            tabIndex={tab()}
            aria-label={value().label}
            value={value().value ?? ""}
            placeholder={value().placeholder}
            readOnly={!props.interactive}
            disabled={value().disabled}
            style={style()}
          />
        </Match>
        <Match when={value().control === "select"}>
          <select
            tabIndex={tab()}
            aria-label={value().label}
            value={value().value ?? value().options?.[0] ?? ""}
            disabled={value().disabled}
            style={style()}
          >
            <For each={value().options ?? []}>
              {(option) => <option value={option}>{option}</option>}
            </For>
          </select>
        </Match>
        <Match
          when={value().control === "checkbox" || value().control === "switch"}
        >
          <label
            style={{
              color: props.element.visual.style?.color,
              "font-size": `${props.element.visual.style?.fontSize ?? 14}px`,
            }}
          >
            <input
              type="checkbox"
              role={value().control === "switch" ? "switch" : undefined}
              tabIndex={tab()}
              checked={value().checked ?? false}
              disabled={value().disabled}
              aria-label={value().label}
            />
            <span>{value().label}</span>
          </label>
        </Match>
      </Switch>
    </div>
  );
}
