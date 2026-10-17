import { encodeHtmlBundleZip, exportHtmlBundle } from "@nodetto/core";
import type { ElementId, FrameSemantic } from "@nodetto/ir";
import { createEditorSignals } from "../adapter.ts";
import type { Editor } from "@nodetto/core";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";

export type SaveHtmlBundle = (
  name: string,
  blob: Blob,
  extension: string,
) => Promise<boolean>;
export function HtmlExportSection(props: {
  editor: Editor;
  save?: SaveHtmlBundle;
  id?: ElementId;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const frames = createMemo(() => {
    signals.rev();
    return props.editor.store
      .getPageElements(props.editor.currentPageId)
      .filter((e) => e.type === "frame");
  });
  const [scope, setScope] = createSignal(props.id ?? "all");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const bundle = exportHtmlBundle(
        props.editor,
        scope() === "all" ? undefined : [scope()],
      );
      const blob = new Blob([encodeHtmlBundleZip(bundle)], {
        type: "application/zip",
      });
      if (props.save) setDone(await props.save("website.zip", blob, "zip"));
      else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "website.zip";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setDone(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label>
        Pages{" "}
        <select
          aria-label="HTML pages"
          value={scope()}
          onChange={(event) => setScope(event.currentTarget.value)}
        >
          <option value="all">All artboards</option>
          <For each={frames()}>
            {(frame) => (
              <option value={frame.id}>
                {(frame.semantic as FrameSemantic).name || frame.id}
              </option>
            )}
          </For>
        </select>
      </label>
      <button type="button" disabled={busy()} onClick={() => void run()}>
        Export HTML .zip
      </button>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Show when={done()}>
        <p role="status">Exported</p>
      </Show>
    </div>
  );
}
