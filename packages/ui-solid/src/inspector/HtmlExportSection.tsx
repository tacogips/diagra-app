import { encodeHtmlBundleZip, exportHtmlBundle } from "@nodetto/core";
import type { Editor } from "@nodetto/core";
import { createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";

export type SaveHtmlBundle = (
  name: string,
  blob: Blob,
  extension: string,
) => Promise<boolean>;
export function HtmlExportSection(props: {
  editor: Editor;
  save?: SaveHtmlBundle;
}): JSX.Element {
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const bundle = exportHtmlBundle(props.editor);
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
      <p>Export all artboards on this page as HTML, CSS and image files.</p>
      <button type="button" disabled={busy()} onClick={() => void run()}>
        Export website .zip
      </button>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Show when={done()}>
        <p role="status">Exported</p>
      </Show>
    </div>
  );
}
