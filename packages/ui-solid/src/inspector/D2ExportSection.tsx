import type { Editor } from "@diagra/core";
import { exportD2 } from "@diagra/io";
import type { PageId } from "@diagra/ir";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";

function fileStem(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "diagram"
  );
}

function fallbackCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
  }
}

export function D2ExportSection(props: {
  readonly editor: Editor;
  readonly pageId: PageId;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [status, setStatus] = createSignal("");
  const report = createMemo(() => {
    signals.rev();
    return exportD2(props.editor.getSnapshot(), props.pageId);
  });
  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(report().code);
      else if (!fallbackCopy(report().code)) throw new Error("copy failed");
      setStatus("D2 source copied.");
    } catch {
      setStatus("Clipboard unavailable. Select and copy the source below.");
    }
  };
  const download = (): void => {
    const pageName =
      props.editor.store.getPage(props.pageId)?.name ?? "diagram";
    const url = URL.createObjectURL(
      new Blob([report().code], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileStem(pageName)}.d2`;
    document.body.append(link);
    try {
      link.click();
      setStatus("D2 download requested.");
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  return (
    <details class="diagra-inspector-section">
      <summary>D2 export</summary>
      <p>
        Export architecture, flow, ER, UML and sequence layers as reviewable D2
        source for engineering documentation and version control.
      </p>
      <p>
        {`${report().elementCount} definitions, ${report().relationCount} relationships/messages, ${report().warnings.length} warnings`}
      </p>
      <button
        type="button"
        disabled={report().elementCount === 0}
        onClick={() => void copy()}
      >
        Copy D2
      </button>
      <button
        type="button"
        disabled={report().elementCount === 0}
        onClick={download}
      >
        Download .d2
      </button>
      <textarea
        aria-label="Generated D2 source"
        readOnly
        rows={14}
        value={report().code}
        style={{
          width: "100%",
          "box-sizing": "border-box",
          "font-family": "monospace",
        }}
      />
      <Show when={report().warnings.length > 0}>
        <ul>
          <For each={report().warnings}>
            {(warning) => (
              <li>
                {warning.elementId
                  ? `${warning.elementId}: ${warning.message}`
                  : warning.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p role="status">{status()}</p>
    </details>
  );
}

export default D2ExportSection;
