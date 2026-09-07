import type { JSX } from "solid-js";
import { parseNumberExpression } from "./inspector/number-expression.ts";

/** True while an IME is composing: Enter and Escape belong to it then. */
export function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

export interface NumberInputProps {
  readonly value: number | null;
  readonly onCommit: (value: number) => void;
  readonly label: string;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
}

export function NumberInput(props: NumberInputProps): JSX.Element {
  const shown = (): string => (props.value === null ? "" : String(props.value));
  const commit = (element: HTMLInputElement): void => {
    const parsed = parseNumberExpression(element.value);
    if (parsed !== null) {
      const minimum =
        props.min !== undefined && parsed < props.min ? props.min : parsed;
      const value =
        props.max !== undefined && minimum > props.max ? props.max : minimum;
      if (value !== props.value) {
        props.onCommit(value);
      }
    }
    element.value = shown();
  };
  return (
    <input
      type="text"
      role="spinbutton"
      class="diagra-input diagra-number"
      aria-label={props.label}
      aria-valuenow={props.value ?? undefined}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      title="Enter a number or arithmetic expression. Up/Down adjusts by one step; Shift uses ten steps."
      disabled={props.disabled}
      value={shown()}
      on:change={(event) => commit(event.currentTarget)}
      on:keydown={(event) => {
        if (isComposing(event)) {
          return;
        }
        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault();
          const base =
            parseNumberExpression(event.currentTarget.value) ??
            props.value ??
            0;
          const step = (props.step ?? 1) * (event.shiftKey ? 10 : 1);
          const next = base + (event.key === "ArrowUp" ? step : -step);
          // Remove insignificant binary rounding noise from repeated decimal steps.
          event.currentTarget.value = String(Number(next.toPrecision(15)));
          commit(event.currentTarget);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.value = shown();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
