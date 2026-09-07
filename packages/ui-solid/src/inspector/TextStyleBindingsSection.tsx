import {
  bindSelectionTextStyle,
  type Editor,
  selectionTextStyleBinding,
  textStyles,
} from "@diagra/core";
import { createMemo, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import { Field, Section } from "./controls.tsx";

export function TextStyleBindingsSection(props: {
  readonly editor: Editor;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const binding = createMemo(() => {
    signals.rev();
    signals.selection();
    return selectionTextStyleBinding(props.editor);
  });
  const styles = createMemo(() => {
    signals.rev();
    return textStyles(props.editor);
  });
  const current = () =>
    binding().mixed
      ? "mixed"
      : binding().id === null
        ? "unlinked"
        : JSON.stringify(binding().id);
  return (
    <Show when={binding().count > 0}>
      <Section title="Typography style">
        <p>
          A linked style updates every consumer. Direct type edits detach it.
        </p>
        <Field label="Text style">
          <select
            aria-label="Typography style binding"
            value={current()}
            disabled={binding().editable === 0}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value !== "mixed")
                bindSelectionTextStyle(
                  props.editor,
                  value === "unlinked" ? null : (JSON.parse(value) as string),
                );
              event.currentTarget.value = current();
            }}
          >
            <Show when={binding().mixed}>
              <option value="mixed" disabled>
                Mixed styles
              </option>
            </Show>
            <option value="unlinked">Unlinked</option>
            <Show when={binding().missing}>
              <option value={JSON.stringify(binding().id)} disabled>
                Missing style
              </option>
            </Show>
            <For each={styles()}>
              {(style) => (
                <option value={JSON.stringify(style.id)}>
                  {style.name} · {style.value.fontSize}px /{" "}
                  {style.value.fontWeight}
                </option>
              )}
            </For>
          </select>
        </Field>
        <Show when={binding().deferred > 0}>
          <p>{binding().deferred} locked layer(s) retain an earlier version.</p>
        </Show>
      </Section>
    </Show>
  );
}
