import {
  bindSelectionColor,
  colorTokens,
  type Editor,
  selectionColorBindings,
} from "@diagra/core";
import { createMemo, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import { Field, Section } from "./controls.tsx";

export function ColorBindingsSection(props: {
  readonly editor: Editor;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const bindings = createMemo(() => {
    signals.rev();
    signals.selection();
    return selectionColorBindings(props.editor);
  });
  const tokens = createMemo(() => {
    signals.rev();
    return colorTokens(props.editor);
  });
  return (
    <Show when={(bindings()[0]?.count ?? 0) > 0}>
      <Section title="Color bindings">
        <p>
          Choose a shared color or unlink while keeping its current appearance.
          Locked layers are skipped.
        </p>
        <For each={bindings()}>
          {(binding) => {
            const label =
              binding.field === "color"
                ? "Text"
                : binding.field === "fill"
                  ? "Fill"
                  : "Stroke";
            // JSON encoding prevents reserved UI values from colliding with arbitrary resource IDs.
            const current = () =>
              binding.mixed
                ? "mixed"
                : binding.tokenId === null
                  ? "unlinked"
                  : JSON.stringify(binding.tokenId);
            return (
              <Field label={label}>
                <select
                  aria-label={`${label} color binding`}
                  value={current()}
                  disabled={binding.editable === 0}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value !== "mixed")
                      bindSelectionColor(
                        props.editor,
                        binding.field,
                        value === "unlinked"
                          ? null
                          : (JSON.parse(value) as string),
                      );
                    event.currentTarget.value = current();
                  }}
                >
                  <Show when={binding.mixed}>
                    <option value="mixed" disabled>
                      Mixed bindings
                    </option>
                  </Show>
                  <option value="unlinked">Unlinked</option>
                  <Show when={binding.missing}>
                    <option value={JSON.stringify(binding.tokenId)} disabled>
                      Missing token
                    </option>
                  </Show>
                  <For each={tokens()}>
                    {(token) => (
                      <option value={JSON.stringify(token.id)}>
                        {token.name} · {token.value}
                      </option>
                    )}
                  </For>
                </select>
                <Show when={binding.deferred > 0}>
                  <p>
                    {binding.deferred} layer(s) retain a previous color. Locked
                    layers refresh when unlocked.
                  </p>
                </Show>
              </Field>
            );
          }}
        </For>
      </Section>
    </Show>
  );
}
