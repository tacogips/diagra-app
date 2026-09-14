import type { Editor } from "@diagra/core";
import { createSignal, type JSX, Show } from "solid-js";
import { importRasterFiles } from "./image-import.ts";
import { createEditorSignals } from "./adapter.ts";
import "./ImageImport.css";

export function ImageImport(props: {
  readonly editor: Editor;
  readonly compact?: boolean;
  readonly label?: JSX.Element;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const insert = async (file: File): Promise<void> => {
    if (props.editor.readOnly) return;
    setBusy(true);
    setError("");
    try {
      const point = props.editor.camera.screenToPage({ x: 40, y: 40 });
      await importRasterFiles(props.editor, [file], point);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      class="diagra-tool-group"
      classList={{ "diagra-image-import-compact": props.compact ?? false }}
    >
      <input
        ref={(element) => {
          input = element;
        }}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void insert(file);
        }}
      />
      <button
        ref={trigger}
        type="button"
        class="diagra-tool-button"
        aria-label="Import image"
        title="Import image"
        disabled={busy() || readOnly()}
        onClick={() => input?.click()}
      >
        {props.label ?? "Image"}
      </button>
      <Show when={busy()}>
        <span class="diagra-image-import-status" role="status">
          Importing image
        </span>
      </Show>
      <Show when={error()}>
        <span role="alert" class="diagra-image-import-error">
          <span>{error()}</span>
          <button
            type="button"
            class="diagra-image-error-dismiss"
            aria-label="Dismiss image error"
            title="Dismiss image error"
            onClick={() => {
              setError("");
              queueMicrotask(() => trigger?.focus({ preventScroll: true }));
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </button>
        </span>
      </Show>
    </div>
  );
}
