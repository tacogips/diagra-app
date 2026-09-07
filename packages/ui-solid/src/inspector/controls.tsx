// The Inspector's input vocabulary.
//
// Every control here commits on `change` (blur or Enter), never per
// keystroke, so one edit is one undo step, and it resets itself to the
// committed value afterwards so a write the core rejected snaps back rather
// than lingering as text the document does not hold. Keyboard events use
// native (`on:`) listeners so a stopPropagation in the panel really stops
// the event before any window-level shortcut handler sees it.

import { For, type JSX } from "solid-js";
import type { PaletteEntry } from "./palette.ts";
import { isComposing } from "../NumberInput.tsx";
export {
  NumberInput,
  type NumberInputProps,
  isComposing,
} from "../NumberInput.tsx";

export interface SectionProps {
  readonly title: string;
  readonly children: JSX.Element;
}

export function Section(props: SectionProps): JSX.Element {
  return (
    <section class="diagra-inspector-section">
      <h3 class="diagra-inspector-title">{props.title}</h3>
      <div class="diagra-inspector-body">{props.children}</div>
    </section>
  );
}

export interface FieldProps {
  readonly label: string;
  readonly children: JSX.Element;
}

export function Field(props: FieldProps): JSX.Element {
  return (
    <div class="diagra-field">
      <span class="diagra-field-label">{props.label}</span>
      <div class="diagra-field-control">{props.children}</div>
    </div>
  );
}

export interface TextInputProps {
  readonly value: string;
  readonly onCommit: (value: string) => void;
  /** Accessible name; the visible label is the surrounding `Field`. */
  readonly label: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly ref?: (element: HTMLInputElement) => void;
}

export function TextInput(props: TextInputProps): JSX.Element {
  const commit = (element: HTMLInputElement): void => {
    const next = element.value;
    if (next !== props.value) {
      props.onCommit(next);
    }
    element.value = props.value;
  };
  return (
    <input
      ref={(element) => props.ref?.(element)}
      type="text"
      class="diagra-input"
      aria-label={props.label}
      placeholder={props.placeholder}
      disabled={props.disabled}
      value={props.value}
      on:change={(event) => commit(event.currentTarget)}
      on:keydown={(event) => {
        if (isComposing(event)) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.value = props.value;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export interface TextAreaProps {
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly label: string;
  readonly rows?: number;
  readonly onSelectionChange?: (start: number, end: number) => void;
}

/** Multiline text: Enter inserts a newline, Cmd/Ctrl+Enter or blur commits. */
export function TextArea(props: TextAreaProps): JSX.Element {
  const commit = (element: HTMLTextAreaElement): void => {
    const next = element.value;
    if (next !== props.value) {
      props.onCommit(next);
    }
    element.value = props.value;
  };
  return (
    <textarea
      class="diagra-input diagra-textarea"
      aria-label={props.label}
      rows={props.rows ?? 4}
      value={props.value}
      on:select={(event) =>
        props.onSelectionChange?.(
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
        )
      }
      on:change={(event) => commit(event.currentTarget)}
      on:keydown={(event) => {
        if (isComposing(event)) {
          return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commit(event.currentTarget);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.value = props.value;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectInputProps {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onCommit: (value: string) => void;
  readonly label: string;
  readonly disabled?: boolean;
}

export function SelectInput(props: SelectInputProps): JSX.Element {
  return (
    <select
      class="diagra-select"
      aria-label={props.label}
      disabled={props.disabled}
      value={props.value}
      on:change={(event) => {
        if (event.currentTarget.value !== props.value) {
          props.onCommit(event.currentTarget.value);
        }
        event.currentTarget.value = props.value;
      }}
    >
      <For each={props.options}>
        {(option) => (
          <option value={option.value} selected={option.value === props.value}>
            {option.label}
          </option>
        )}
      </For>
    </select>
  );
}

export interface CheckboxProps {
  readonly checked: boolean;
  readonly onCommit: (checked: boolean) => void;
  readonly label: string;
  readonly title?: string;
  readonly disabled?: boolean;
}

export function Checkbox(props: CheckboxProps): JSX.Element {
  return (
    <label class="diagra-check" title={props.title}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        on:change={(event) => props.onCommit(event.currentTarget.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function normaliseColour(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

export interface SwatchesProps {
  readonly entries: readonly PaletteEntry[];
  /** The current colour, or `undefined` for the stylesheet default. */
  readonly value: string | undefined;
  /** `null` clears the field back to the default. */
  readonly onPick: (value: string | null) => void;
  readonly label: string;
}

/** A preset row plus a custom colour picker and a "default" swatch. */
export function Swatches(props: SwatchesProps): JSX.Element {
  const current = (): string | undefined => normaliseColour(props.value);
  const custom = (): string => {
    const value = current();
    return value !== undefined && /^#[0-9a-f]{6}$/.test(value)
      ? value
      : "#1d2a2e";
  };
  return (
    <div class="diagra-swatches" role="group" aria-label={props.label}>
      <button
        type="button"
        class="diagra-swatch diagra-swatch-none"
        title="Default"
        aria-label="Default"
        aria-pressed={props.value === undefined}
        onClick={() => props.onPick(null)}
      />
      <For each={props.entries}>
        {(entry) => (
          <button
            type="button"
            class="diagra-swatch"
            style={{ background: entry.value }}
            title={`${entry.name} (${entry.value})`}
            aria-label={entry.name}
            aria-pressed={current() === normaliseColour(entry.value)}
            onClick={() => props.onPick(entry.value)}
          />
        )}
      </For>
      <input
        type="color"
        class="diagra-color"
        aria-label={`Custom ${props.label.toLowerCase()}`}
        title="Custom colour"
        value={custom()}
        on:change={(event) => props.onPick(event.currentTarget.value)}
      />
    </div>
  );
}

export interface RowToolsProps {
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onMove: (delta: number) => void;
  readonly onRemove: () => void;
}

/** Up / down / remove buttons that every row editor shares. */
export function RowTools(props: RowToolsProps): JSX.Element {
  return (
    <span class="diagra-row-tools">
      <button
        type="button"
        class="diagra-row-button"
        title="Move up"
        aria-label="Move up"
        disabled={!props.canMoveUp}
        onClick={() => props.onMove(-1)}
      >
        {"↑"}
      </button>
      <button
        type="button"
        class="diagra-row-button"
        title="Move down"
        aria-label="Move down"
        disabled={!props.canMoveDown}
        onClick={() => props.onMove(1)}
      >
        {"↓"}
      </button>
      <button
        type="button"
        class="diagra-row-button diagra-row-remove"
        title="Remove"
        aria-label="Remove"
        onClick={() => props.onRemove()}
      >
        {"×"}
      </button>
    </span>
  );
}

/** Scroll a row's name input into view and put the caret in it. */
export function focusRowInput(element: HTMLInputElement | undefined): void {
  if (!element) {
    return;
  }
  element.scrollIntoView({ block: "nearest" });
  element.focus();
  element.select();
}
