import { componentOverrides, type Editor } from "@nodetto/core";
import type { ElementId } from "@nodetto/ir";
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
      <section
        class="nodetto-inspector-section"
        aria-label="Changes to this copy"
      >
        <h3>Changes to this copy</h3>
        <For each={overrides()}>
          {(item) => (
            <div>
              <strong>{item.field}</strong>
              <p style={{ "overflow-wrap": "anywhere" }}>
                Current: {shown(item.current)}
                <br />
                Original: {shown(item.source)}
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
                      ? "Restored the original value."
                      : "Could not reset: this item or its original changed.",
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
