import type { Editor } from "@diagra/core";
import { createSignal, type JSX, Show } from "solid-js";
import { importRasterFiles } from "./image-import.ts";
import { createEditorSignals } from "./adapter.ts";

export function ImageImport(props: { editor: Editor }): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let input: HTMLInputElement | undefined;
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
    <div class="diagra-tool-group">
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
        type="button"
        class="diagra-tool-button"
        disabled={busy() || readOnly()}
        onClick={() => input?.click()}
      >
        Image
      </button>
      <Show when={error()}>
        <span role="alert">{error()}</span>
      </Show>
    </div>
  );
}
