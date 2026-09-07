import type { Editor } from "@diagra/core";
import { createSignal, createUniqueId, type JSX } from "solid-js";
import { isComposing } from "./NumberInput.tsx";
import { layerRenameDraft } from "./layer-rename.ts";

export function LayerRenameInput(props: {
  readonly editor: Editor;
  readonly id: string;
  readonly onDone: (restoreFocus: boolean) => void;
}): JSX.Element {
  const draft = layerRenameDraft(props.editor, props.id);
  const [error, setError] = createSignal("");
  const errorId = createUniqueId();
  let finished = false;
  const finish = (
    value: string,
    save: boolean,
    restoreFocus: boolean,
  ): void => {
    if (finished) return;
    finished = true;
    if (save && (!draft || draft.commit(value) === "unavailable")) {
      finished = false;
      setError(
        "Layer changed or is locked. Copy your draft, then Escape to cancel.",
      );
      return;
    }
    props.onDone(restoreFocus);
  };
  return (
    <div
      class="diagra-layer-name"
      style={{ "min-width": "0", "white-space": "normal" }}
    >
      <input
        type="text"
        aria-label="Rename layer"
        aria-invalid={Boolean(error())}
        aria-describedby={error() ? errorId : undefined}
        value={draft?.value ?? ""}
        ref={(input) =>
          queueMicrotask(() => {
            if (input.isConnected) {
              input.focus();
              input.select();
            }
          })
        }
        style={{ width: "100%", "min-width": "0", "box-sizing": "border-box" }}
        on:blur={(event) => finish(event.currentTarget.value, true, false)}
        on:keydown={(event) => {
          event.stopPropagation();
          if (isComposing(event)) return;
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            finish(event.currentTarget.value, event.key === "Enter", true);
          }
        }}
        on:keyup={(event) => event.stopPropagation()}
      />
      <span id={errorId} role="status">
        {error()}
      </span>
    </div>
  );
}
