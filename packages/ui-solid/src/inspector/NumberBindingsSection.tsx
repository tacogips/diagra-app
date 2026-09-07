import {
  bindSelectionNumber,
  type Editor,
  numberTokens,
  selectionNumberBindings,
} from "@diagra/core";
import { createMemo, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import { Field, Section } from "./controls.tsx";

const LABELS = {
  width: "Width",
  height: "Height",
  minWidth: "Minimum width",
  maxWidth: "Maximum width",
  minHeight: "Minimum height",
  maxHeight: "Maximum height",
  cornerRadius: "Corner radius",
  cornerTopLeft: "Top-left radius",
  cornerTopRight: "Top-right radius",
  cornerBottomRight: "Bottom-right radius",
  cornerBottomLeft: "Bottom-left radius",
  strokeWidth: "Stroke width",
  fontSize: "Font size",
  letterSpacing: "Letter spacing",
  gap: "Layout gap",
  crossGap: "Wrapped line gap",
  padding: "Layout padding",
  paddingTop: "Padding top",
  paddingRight: "Padding right",
  paddingBottom: "Padding bottom",
  paddingLeft: "Padding left",
} as const;

export function NumberBindingsSection(props: {
  readonly editor: Editor;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const bindings = createMemo(() => {
    signals.rev();
    signals.selection();
    return selectionNumberBindings(props.editor);
  });
  const tokens = createMemo(() => {
    signals.rev();
    return numberTokens(props.editor);
  });
  return (
    <Show when={bindings().length > 0}>
      <Section title="Measurement bindings">
        <p>
          Link numeric properties to reusable values. Direct edits unlink only
          that property.
        </p>
        <For each={bindings()}>
          {(binding) => {
            const current = () =>
              binding.mixed
                ? "mixed"
                : binding.tokenId === null
                  ? "unlinked"
                  : JSON.stringify(binding.tokenId);
            return (
              <Field label={LABELS[binding.field]}>
                <select
                  aria-label={`${LABELS[binding.field]} measurement binding`}
                  value={current()}
                  disabled={binding.editable === 0}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value !== "mixed")
                      bindSelectionNumber(
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
                        {token.name} · {token.value}px
                      </option>
                    )}
                  </For>
                </select>
                <Show when={binding.deferred > 0}>
                  <p>
                    {binding.deferred} locked layer(s) retain a previous value
                    until unlocked.
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
