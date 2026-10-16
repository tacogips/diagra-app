import { isDatabaseObjectType } from "@nodetto/ir";
import type { Editor } from "@nodetto/core";
import { availableMermaidKinds } from "@nodetto/io";
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  lazy,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import type {
  ExportFormat,
  SaveArtwork,
} from "./inspector/AssetExportSection.tsx";
import "./ExportDialog.css";

const Artwork = lazy(() =>
  import("./inspector/AssetExportSection.tsx").then((m) => ({
    default: m.AssetExportSection,
  })),
);
const Mermaid = lazy(() => import("./inspector/MermaidExportSection.tsx"));
const D2 = lazy(() => import("./inspector/D2ExportSection.tsx"));
const Database = lazy(() => import("./inspector/DatabaseExportSection.tsx"));
const Code = lazy(() =>
  import("./inspector/HandoffSection.tsx").then((m) => ({
    default: m.HandoffSection,
  })),
);
type Tab = ExportFormat | "mermaid" | "d2" | "sql" | "bpmn" | "code";

export interface ExportDialogProps {
  readonly editor: Editor;
  readonly saveArtwork?: SaveArtwork;
  readonly exportBpmn: () => Promise<void>;
  readonly error?: string | null;
  readonly onClose: () => void;
}

export function ExportDialog(props: ExportDialogProps): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [tab, setTab] = createSignal<Tab>("svg");
  let dialog: HTMLDialogElement | undefined;
  const page = createMemo(() => {
    signals.rev();
    return props.editor.store.getPage(props.editor.currentPageId);
  });
  const selected = createMemo(() => {
    signals.rev();
    const ids = [...signals.selection()];
    const id = ids.length === 1 ? ids[0] : undefined;
    return id ? props.editor.store.get(id) : undefined;
  });
  const tabs = createMemo(() => {
    signals.rev();
    return [
      { id: "svg", label: "SVG", enabled: true },
      { id: "png", label: "PNG", enabled: true },
      { id: "pdf", label: "PDF", enabled: true },
      {
        id: "mermaid",
        label: "Mermaid",
        enabled:
          availableMermaidKinds(
            props.editor.getSnapshot(),
            props.editor.currentPageId,
          ).length > 0,
      },
      { id: "d2", label: "D2", enabled: true },
      {
        id: "sql",
        label: "SQL",
        enabled: props.editor.store
          .getPageElements(props.editor.currentPageId)
          .some((e) => e.type === "erd.table" || isDatabaseObjectType(e.type)),
      },
      { id: "bpmn", label: "BPMN", enabled: page()?.kind === "bpmn" },
      { id: "code", label: "Code", enabled: selected() !== undefined },
    ] satisfies readonly { id: Tab; label: string; enabled: boolean }[];
  });
  // Switching pages or deleting the selection cannot leave an unavailable panel active.
  const active = () =>
    tabs().find((t) => t.id === tab())?.enabled ? tab() : "svg";
  const artworkFormat = (): ExportFormat | undefined => {
    const value = active();
    return value === "svg" || value === "png" || value === "pdf"
      ? value
      : undefined;
  };
  onMount(() => {
    const previous = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    onCleanup(() => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    });
  });
  const navigate = (event: KeyboardEvent) => {
    const direction =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const enabled = tabs().filter((t) => t.enabled);
    const index = enabled.findIndex((t) => t.id === active());
    const next =
      event.key === "Home"
        ? enabled[0]
        : event.key === "End"
          ? enabled.at(-1)
          : enabled[(index + direction + enabled.length) % enabled.length];
    if (!next) return;
    setTab(next.id);
    dialog
      ?.querySelector<HTMLButtonElement>(`#nodetto-export-tab-${next.id}`)
      ?.focus();
  };
  return (
    <dialog
      ref={dialog}
      class="nodetto-export-dialog"
      aria-labelledby="nodetto-export-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header>
        <h2 id="nodetto-export-title">Export</h2>
        <button type="button" onClick={props.onClose} aria-label="Close export">
          Close
        </button>
      </header>
      <div role="tablist" aria-label="Export format" onKeyDown={navigate}>
        <For each={tabs()}>
          {(item) => (
            <button
              type="button"
              role="tab"
              id={`nodetto-export-tab-${item.id}`}
              aria-controls="nodetto-export-panel"
              aria-selected={active() === item.id}
              tabIndex={active() === item.id ? 0 : -1}
              disabled={!item.enabled}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
      <div
        role="tabpanel"
        id="nodetto-export-panel"
        aria-labelledby={`nodetto-export-tab-${active()}`}
      >
        <Suspense fallback={<p role="status">Loading…</p>}>
          <Switch>
            <Match when={artworkFormat()}>
              {(format) => (
                <Artwork
                  editor={props.editor}
                  format={format()}
                  save={props.saveArtwork}
                  hasSelection={signals.selection().size > 0}
                  id={selected()?.type === "frame" ? selected()?.id : undefined}
                />
              )}
            </Match>
            <Match when={active() === "mermaid"}>
              <Mermaid
                editor={props.editor}
                pageId={props.editor.currentPageId}
              />
            </Match>
            <Match when={active() === "d2"}>
              <D2 editor={props.editor} pageId={props.editor.currentPageId} />
            </Match>
            <Match when={active() === "sql"}>
              <Database
                editor={props.editor}
                pageId={props.editor.currentPageId}
              />
            </Match>
            <Match when={active() === "bpmn"}>
              <button type="button" onClick={() => void props.exportBpmn()}>
                Export .bpmn
              </button>
            </Match>
            <Match when={active() === "code" && selected()}>
              {(element) => <Code editor={props.editor} id={element().id} />}
            </Match>
          </Switch>
        </Suspense>
        <Show when={props.error}>
          {(error) => <p role="alert">{error()}</p>}
        </Show>
      </div>
    </dialog>
  );
}
