// App shell: file controls, the toolbar and the canvas, plus the tool
// signal the last two share.
//
// The tool lives here rather than inside either component because both read
// it and both write it — the canvas resets to "select" after placing a
// shape, so the toolbar's highlight has to follow.
//
// The file controls are a thin view over the session: this component holds
// no document state of its own, it mirrors `session.state()` into a signal
// and calls back in.

import type { Editor } from "@diagra/core";
import { DiagraCanvas, Toolbar, type ToolKind } from "@diagra/ui-solid";
import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { DocumentSession, SessionState } from "./file/session.ts";

export interface AppProps {
  readonly editor: Editor;
  readonly session: DocumentSession;
  /** False outside Tauri: there is no filesystem to reach. */
  readonly filesAvailable: boolean;
}

const DISCARD_PROMPT = "Discard unsaved changes?";

export function App(props: AppProps): JSX.Element {
  const [tool, setTool] = createSignal<ToolKind>("select");
  const [file, setFile] = createSignal<SessionState>(props.session.state());

  const unsubscribe = props.session.subscribe(setFile);
  onCleanup(unsubscribe);

  /** True when it is safe to throw away what is in the editor. */
  const mayDiscard = (): boolean =>
    !file().dirty || window.confirm(DISCARD_PROMPT);

  const newDocument = (): void => {
    if (mayDiscard()) {
      void props.session.newDocument();
    }
  };

  const open = (): void => {
    if (mayDiscard()) {
      void props.session.open();
    }
  };

  const openRecent = (path: string): void => {
    if (path !== "" && mayDiscard()) {
      void props.session.openPath(path);
    }
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Exactly cmd/ctrl + S. Anything else — including the shift variant
      // and the canvas's own delete and undo bindings — is left alone.
      const chord =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "s";
      if (!chord || !props.filesAvailable) {
        return;
      }
      event.preventDefault();
      void props.session.save();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <div class="app-shell">
      <header class="app-header">
        <span class="app-title">diagra</span>
        <div class="app-file-controls">
          <button
            type="button"
            class="app-file-button"
            disabled={!props.filesAvailable}
            onClick={newDocument}
          >
            New
          </button>
          <button
            type="button"
            class="app-file-button"
            disabled={!props.filesAvailable}
            onClick={open}
          >
            Open
          </button>
          <button
            type="button"
            class="app-file-button"
            disabled={!props.filesAvailable}
            onClick={() => void props.session.save()}
          >
            Save
          </button>
          <button
            type="button"
            class="app-file-button"
            disabled={!props.filesAvailable}
            onClick={() => void props.session.saveAs()}
          >
            Save As
          </button>
          <select
            class="app-recent-select"
            disabled={!props.filesAvailable || file().recent.length === 0}
            value=""
            onChange={(event) => {
              const path = event.currentTarget.value;
              // Reset first: reopening the same entry twice in a row must
              // still fire a change event.
              event.currentTarget.value = "";
              openRecent(path);
            }}
          >
            <option value="">Recent</option>
            <For each={file().recent}>
              {(entry) => <option value={entry.path}>{entry.path}</option>}
            </For>
          </select>
        </div>
        <span class="app-file-name">
          {file().fileName ?? "untitled"}
          <Show when={file().dirty}>
            <span class="app-dirty-marker" title="unsaved changes">
              *
            </span>
          </Show>
        </span>
        <Show when={file().status === "saving"}>
          <span class="app-file-status">saving…</span>
        </Show>
        <span class="app-hint">
          drag to pan, ctrl/cmd + wheel to zoom, delete to remove, cmd/ctrl + Z
          to undo, cmd/ctrl + S to save
        </span>
      </header>
      <Show when={!props.filesAvailable}>
        <p class="app-notice">
          Local files are only available in the desktop app.
        </p>
      </Show>
      <Show when={file().error}>
        {(message) => <pre class="app-error">{message()}</pre>}
      </Show>
      <Show when={file().conflict}>
        <div class="app-conflict" role="alert">
          <span>File changed on disk.</span>
          <button
            type="button"
            class="app-file-button"
            onClick={() => void props.session.resolveConflict("reload")}
          >
            Reload
          </button>
          <button
            type="button"
            class="app-file-button"
            onClick={() => void props.session.resolveConflict("keep")}
          >
            Keep mine
          </button>
        </div>
      </Show>
      <Toolbar editor={props.editor} tool={tool()} onToolChange={setTool} />
      <DiagraCanvas
        editor={props.editor}
        tool={tool()}
        onToolChange={setTool}
      />
    </div>
  );
}
