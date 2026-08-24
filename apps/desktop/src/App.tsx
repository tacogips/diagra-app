// App shell: file controls, cloud controls, the toolbar and the canvas, plus
// the tool signal the last two share.
//
// The tool lives here rather than inside either component because both read
// it and both write it — the canvas resets to "select" after placing a
// shape, so the toolbar's highlight has to follow.
//
// The shell holds no document state of its own: it mirrors each session's
// state into a signal and calls back in. What it does own is the *mode* —
// one editor can be showing a local file or a cloud room, never both — and
// everything that has two implementations (undo, the title, which controls
// are live) is routed through that discriminator rather than guessed at.

import type { Box, Editor } from "@diagra/core";
import { DiagraCanvas, Toolbar, type ToolKind } from "@diagra/ui-solid";
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { CloudPanel } from "./cloud/CloudPanel.tsx";
import { PresenceChip, PresenceOverlay } from "./cloud/PresenceOverlay.tsx";
import type { CloudSession, CloudSessionState } from "./cloud/session.ts";
import type { CloudSettings } from "./cloud/settings.ts";
import type { DocumentSession, SessionState } from "./file/session.ts";

export interface AppProps {
  readonly editor: Editor;
  readonly session: DocumentSession;
  readonly cloud: CloudSession;
  /** False outside Tauri: there is no filesystem to reach. */
  readonly filesAvailable: boolean;
  readonly cloudSettings: CloudSettings;
  readonly onCloudSettingsChange: (settings: CloudSettings) => void;
}

/** Which document the editor is showing. File mode is the default. */
export type DocumentMode =
  | { readonly kind: "file" }
  | { readonly kind: "cloud" };

const DISCARD_PROMPT = "Discard unsaved changes?";
/** Presence is a pointer trail; 20 Hz is plenty and keeps the socket quiet. */
const CURSOR_THROTTLE_MS = 50;

export function App(props: AppProps): JSX.Element {
  const [tool, setTool] = createSignal<ToolKind>("select");
  const [file, setFile] = createSignal<SessionState>(props.session.state());
  const [cloud, setCloud] = createSignal<CloudSessionState>(
    props.cloud.state(),
  );
  const [settings, setSettings] = createSignal<CloudSettings>(
    props.cloudSettings,
  );

  onCleanup(props.session.subscribe(setFile));
  onCleanup(props.cloud.subscribe(setCloud));

  /**
   * A cloud document owns the editor exactly while its binding is attached —
   * which is what `connected` and `reconnecting` mean.
   *
   * Not from the moment one is *requested*: `connecting` and `syncing` have
   * not touched the editor yet, and a connect that fails its authorization
   * probe must leave the user's open file exactly as it was.
   */
  const mode = (): DocumentMode =>
    cloud().status === "connected" || cloud().status === "reconnecting"
      ? { kind: "cloud" }
      : { kind: "file" };
  const isCloud = (): boolean => mode().kind === "cloud";

  // Exactly one session may own the editor. Without this, every edit arriving
  // from a room would look to the file session like the user typing, and its
  // autosave would write the cloud document over whatever file was open.
  createEffect(() => {
    if (isCloud()) {
      props.session.suspend();
    } else {
      props.session.resume();
    }
  });

  const updateSettings = (next: CloudSettings): void => {
    setSettings(next);
    props.onCloudSettingsChange(next);
  };

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
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      // Undo in cloud mode is the Y.UndoManager's, not the core History's:
      // the core's inverse commands describe a document only this client saw,
      // so replaying them would revert whatever a peer did in between. This
      // listener runs in the capture phase and stops the event, so the
      // canvas's own binding never sees the chord while a room is open.
      if (isCloud() && modifier && (key === "z" || key === "y")) {
        event.preventDefault();
        event.stopPropagation();
        if (key === "y" || event.shiftKey) {
          props.cloud.redo();
        } else {
          props.cloud.undo();
        }
        return;
      }

      // Exactly cmd/ctrl + S, and only for a local file.
      const save =
        modifier &&
        !event.shiftKey &&
        !event.altKey &&
        key === "s" &&
        props.filesAvailable &&
        !isCloud();
      if (!save) {
        return;
      }
      event.preventDefault();
      void props.session.save();
    };
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
    });
  });

  let canvasHost: HTMLDivElement | undefined;
  let lastCursorAt = 0;
  /** Where this user's pointer was, so a republish does not lose it. */
  let cursor: { x: number; y: number } | null = null;
  let lastBrushAt = 0;
  /** The marquee this user is dragging, so a republish does not lose it. */
  let brush: Box | null = null;

  const onMarquee = (rect: Box | null): void => {
    const ended = rect === null && brush !== null;
    const started = rect !== null && brush === null;
    brush = rect;
    if (!isCloud()) {
      return;
    }
    // Start and end publish immediately so the remote brush never lingers;
    // growth in between is throttled like the cursor.
    const now = Date.now();
    if (!started && !ended && now - lastBrushAt < CURSOR_THROTTLE_MS) {
      return;
    }
    lastBrushAt = now;
    props.cloud.publishPresence(cursor, brush);
  };

  const onCanvasPointerMove = (event: PointerEvent): void => {
    if (!isCloud() || !canvasHost) {
      return;
    }
    const now = Date.now();
    if (now - lastCursorAt < CURSOR_THROTTLE_MS) {
      return;
    }
    lastCursorAt = now;
    const rect = canvasHost.getBoundingClientRect();
    cursor = props.editor.camera.screenToPage({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    props.cloud.publishPresence(cursor, brush);
  };

  const onCanvasPointerLeave = (): void => {
    cursor = null;
    if (isCloud()) {
      props.cloud.publishPresence(null, brush);
    }
  };

  // Selection and page changes are part of presence too, and neither of them
  // moves the pointer (design 6).
  onCleanup(
    props.editor.selection.subscribe(() => {
      if (isCloud()) {
        props.cloud.publishPresence(cursor, brush);
      }
    }),
  );
  onCleanup(
    props.editor.subscribe((diff) => {
      if (isCloud() && diff.pagesChanged) {
        props.cloud.publishPresence(cursor, brush);
      }
    }),
  );

  return (
    <div class="app-shell" classList={{ "app-cloud-mode": isCloud() }}>
      <header class="app-header">
        <span class="app-title">diagra</span>
        <div class="app-file-controls">
          <button
            type="button"
            class="app-file-button"
            disabled={!props.filesAvailable || isCloud()}
            onClick={newDocument}
          >
            New
          </button>
          <button
            type="button"
            class="app-file-button"
            disabled={!props.filesAvailable || isCloud()}
            onClick={open}
          >
            Open
          </button>
          <button
            type="button"
            class="app-file-button"
            disabled={!props.filesAvailable || isCloud()}
            onClick={() => void props.session.save()}
          >
            Save
          </button>
          <button
            type="button"
            class="app-file-button"
            disabled={!props.filesAvailable || isCloud()}
            onClick={() => void props.session.saveAs()}
          >
            Save As
          </button>
          <select
            class="app-recent-select"
            disabled={
              !props.filesAvailable || isCloud() || file().recent.length === 0
            }
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
        <Show
          when={isCloud()}
          fallback={
            <span class="app-file-name">
              {file().fileName ?? "untitled"}
              <Show when={file().dirty}>
                <span class="app-dirty-marker" title="unsaved changes">
                  *
                </span>
              </Show>
            </span>
          }
        >
          <span class="app-file-name">{cloud().title ?? cloud().docId}</span>
          <span class="app-cloud-badge" data-status={cloud().status}>
            {cloud().status}
          </span>
          <PresenceChip peers={cloud().peers} />
          <div class="app-file-controls">
            <button
              type="button"
              class="app-file-button"
              disabled={!cloud().canUndo}
              onClick={() => props.cloud.undo()}
            >
              Undo
            </button>
            <button
              type="button"
              class="app-file-button"
              disabled={!cloud().canRedo}
              onClick={() => props.cloud.redo()}
            >
              Redo
            </button>
          </div>
        </Show>
        <Show when={file().status === "saving" && !isCloud()}>
          <span class="app-file-status">saving…</span>
        </Show>
        <span class="app-hint">
          drag to pan, ctrl/cmd + wheel to zoom, delete to remove, cmd/ctrl + Z
          to undo, cmd/ctrl + S to save
        </span>
      </header>
      <CloudPanel
        editor={props.editor}
        session={props.cloud}
        state={cloud()}
        settings={settings()}
        onSettingsChange={updateSettings}
        // Opening a room replaces what is on the canvas, exactly like opening
        // a file does, so it asks the same question first.
        mayDiscard={mayDiscard}
      />
      <Show when={!props.filesAvailable && !isCloud()}>
        <p class="app-notice">
          Local files are only available in the desktop app.
        </p>
      </Show>
      {/* A cloud failure is reported wherever it happens: a refused connect
          leaves the app in file mode, and its message still has to be read. */}
      <Show when={cloud().error ?? file().error}>
        {(message) => <pre class="app-error">{message()}</pre>}
      </Show>
      <Show when={file().conflict && !isCloud()}>
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
      <div
        class="app-canvas-host"
        ref={canvasHost}
        onPointerMove={onCanvasPointerMove}
        onPointerLeave={onCanvasPointerLeave}
      >
        <DiagraCanvas
          editor={props.editor}
          tool={tool()}
          onToolChange={setTool}
          onMarquee={onMarquee}
        />
        <Show when={isCloud()}>
          <PresenceOverlay editor={props.editor} peers={cloud().peers} />
        </Show>
      </div>
    </div>
  );
}
