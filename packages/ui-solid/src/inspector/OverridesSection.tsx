import { componentOverrides, type Editor } from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";

export function OverridesSection(props: {
  editor: Editor;
  id: ElementId;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [status, setStatus] = createSignal("");
  const overrides = createMemo(() => {
    signals.rev();
    return componentOverrides(props.editor, props.id);
  });
  const shown = (value: unknown): string =>
    value === undefined
      ? "Theme default"
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return (
    <Show when={overrides().length}>
      <section class="diagra-inspector-section" aria-label="Source overrides">
        <h3>Source overrides</h3>
        <p>
          Restore individual fields to the current source value. Other
          customizations stay unchanged.
        </p>
        <For each={overrides()}>
          {(item) => (
            <div>
              <strong>{item.field}</strong>
              <p style={{ "overflow-wrap": "anywhere" }}>
                Current: {shown(item.current)}
                <br />
                Source: {shown(item.source)}
              </p>
              <button
                type="button"
                disabled={item.locked}
                onClick={() =>
                  setStatus(
                    props.editor.resetComponentOverride(
                      item.instanceId,
                      item.targetId,
                      item.field,
                    )
                      ? "Override restored to source."
                      : "Could not reset: the layer or source changed.",
                  )
                }
              >
                Reset {item.field}
              </button>
            </div>
          )}
        </For>
        <p role="status">{status()}</p>
      </section>
    </Show>
  );
}
