import type { Editor } from "@diagra/core";
import {
  type MermaidDiagramKind,
  availableMermaidKinds,
  exportMermaid,
} from "@diagra/io";
import type { PageId } from "@diagra/ir";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";

const LABELS: Readonly<Record<MermaidDiagramKind, string>> = {
  erDiagram: "Entity relationship diagram",
  classDiagram: "UML class diagram",
  sequenceDiagram: "Sequence diagram",
};

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

export function MermaidExportSection(props: {
  readonly editor: Editor;
  readonly pageId: PageId;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [selected, setSelected] = createSignal<MermaidDiagramKind>("erDiagram");
  const [status, setStatus] = createSignal("");
  const kinds = createMemo(() => {
    signals.rev();
    return availableMermaidKinds(props.editor.getSnapshot(), props.pageId);
  });
  const kind = (): MermaidDiagramKind | null => {
    const choices = kinds();
    return choices.includes(selected()) ? selected() : (choices[0] ?? null);
  };
  const report = createMemo(() => {
    signals.rev();
    const current = kind();
    return current
      ? exportMermaid(props.editor.getSnapshot(), props.pageId, current)
      : null;
  });
  const copy = async (): Promise<void> => {
    const current = report();
    if (!current) return;
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(current.code);
      else if (!fallbackCopy(current.code)) throw new Error("copy failed");
      setStatus("Mermaid source copied.");
    } catch {
      setStatus("Clipboard unavailable. Select and copy the source below.");
    }
  };
  const download = (): void => {
    const current = report();
    if (!current) return;
    const pageName =
      props.editor.store.getPage(props.pageId)?.name ?? "diagram";
    const url = URL.createObjectURL(
      new Blob([current.code], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileStem(pageName)}.${current.kind}.mmd`;
    document.body.append(link);
    try {
      link.click();
      setStatus("Mermaid download requested.");
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  return (
    <details class="diagra-inspector-section">
      <summary>Mermaid export</summary>
      <p>
        Export semantic ER, UML class or sequence layers for Markdown,
        documentation sites and version-controlled engineering workflows.
      </p>
      <Show
        when={kinds().length > 0}
        fallback={
          <p>
            Add an ER table, UML class or sequence participant to this page to
            enable Mermaid export.
          </p>
        }
      >
        <label>
          Diagram kind
          <select
            aria-label="Mermaid diagram kind"
            value={kind() ?? ""}
            onChange={(event) => {
              setSelected(event.currentTarget.value as MermaidDiagramKind);
              setStatus("");
            }}
          >
            <For each={kinds()}>
              {(value) => <option value={value}>{LABELS[value]}</option>}
            </For>
          </select>
        </label>
        <Show when={report()} keyed>
          {(current) => (
            <>
              <p>
                {`${current.elementCount} definitions, ${current.relationCount} relationships/messages, ${current.warnings.length} warnings`}
              </p>
              <button type="button" onClick={() => void copy()}>
                Copy Mermaid
              </button>
              <button type="button" onClick={download}>
                Download .mmd
              </button>
              <textarea
                aria-label="Generated Mermaid source"
                readOnly
                rows={14}
                value={current.code}
                style={{
                  width: "100%",
                  "box-sizing": "border-box",
                  "font-family": "monospace",
                }}
              />
              <Show when={current.warnings.length > 0}>
                <ul>
                  <For each={current.warnings}>
                    {(warning) => <li>{warning.message}</li>}
                  </For>
                </ul>
              </Show>
            </>
          )}
        </Show>
      </Show>
      <p role="status">{status()}</p>
    </details>
  );
}

export default MermaidExportSection;
