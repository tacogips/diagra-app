// App shell: file controls, cloud controls, the toolbar, page tabs, the
// canvas with its floating chrome, and the Inspector column.
//
// The tool lives here rather than inside either component because both read
// it and both write it — the canvas resets to "select" after placing a
// shape, so the toolbar's highlight has to follow. The same goes for the
// snapping switches, grid visibility, the viewport size, the inline editing
// target and the context menu: each is read by one component and written by
// another, so the shell owns the signal and hands it both ways.
//
// The shell holds no document state of its own: it mirrors each session's
// state into a signal and calls back in. What it does own is the *mode* —
// one editor can be showing a local file or a cloud room, never both — and
// everything that has two implementations (undo, the title, which controls
// are live) is routed through that discriminator rather than guessed at.

import {
  type Box,
  createReviewComment,
  type EditableField,
  type Editor,
  type NewReviewMessage,
  type Vec,
} from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import {
  type ActionContext,
  ContextMenu,
  DiagraCanvas,
  getAction,
  Inspector,
  Layers,
  PageTabs,
  ReviewCommentPins,
  runAction,
  SelectionToolbar,
  type SnapSettings,
  TextEditor,
  Toolbar,
  type ToolKind,
  ZoomControls,
} from "@diagra/ui-solid";
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
import type { ExportBackend } from "./file/backend.ts";
import type { DocumentSession, SessionState } from "./file/session.ts";

export interface AppProps {
  readonly editor: Editor;
  readonly session: DocumentSession;
  readonly cloud: CloudSession;
  /** False outside Tauri: there is no filesystem to reach. */
  readonly filesAvailable: boolean;
  /** Save dialog and writer for exports; falls back to a download. */
  readonly exportBackend: ExportBackend;
  readonly cloudSettings: CloudSettings;
  readonly onCloudSettingsChange: (settings: CloudSettings) => void;
}

/** Which document the editor is showing. File mode is the default. */
export type DocumentMode =
  | { readonly kind: "file" }
  | { readonly kind: "cloud" };

/** The inline text editor's target (design editor-ux 3.3). */
export interface EditingTarget {
  readonly id: ElementId;
  readonly field: EditableField;
}

/** Which element (and row) the Inspector should scroll to and highlight. */
export interface InspectorFocus {
  readonly id: ElementId;
  readonly row?: number;
}

const DISCARD_PROMPT = "Discard unsaved changes?";
/** Presence is a pointer trail; 20 Hz is plenty and keeps the socket quiet. */
const CURSOR_THROTTLE_MS = 50;
/** `--diagra-canvas` in style.css; exports carry the same ground. */
const CANVAS_BACKGROUND = "#f6f4ee";
const EXPORT_EXTENSION = "svg";

/** Drop a trailing extension and anything a filesystem would refuse. */
export function exportBaseName(name: string): string {
  const stem = name.replace(/\.[^./\\]+$/, "");
  const safe = stem.replace(/[/\\:*?"<>|]+/g, "-").trim();
  return safe === "" ? "untitled" : safe;
}

/** Hand a text file to the browser when there is no native dialog. */
function downloadText(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the click has been dispatched; a synchronous revoke races
  // the download in some engines.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App(props: AppProps): JSX.Element {
  const [tool, setTool] = createSignal<ToolKind>("select");
  const [pendingComment, setPendingComment] = createSignal<{
    readonly input: NewReviewMessage;
    readonly target: ElementId | undefined;
    readonly onPlaced: () => void;
  } | null>(null);
  const [file, setFile] = createSignal<SessionState>(props.session.state());
  const [cloud, setCloud] = createSignal<CloudSessionState>(
    props.cloud.state(),
  );
  const [settings, setSettings] = createSignal<CloudSettings>(
    props.cloudSettings,
  );

  // Editor chrome state (design editor-ux 3.3, 3.5, 3.6, 4).
  const [snap, setSnap] = createSignal<SnapSettings>({
    grid: true,
    objects: true,
    guides: true,
  });
  const [showGrid, setShowGrid] = createSignal(true);
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  const [editing, setEditing] = createSignal<EditingTarget | null>(null);
  const [contextMenu, setContextMenu] = createSignal<{
    readonly at: Vec;
  } | null>(null);
  const [inspectorFocus, setInspectorFocus] = createSignal<
    InspectorFocus | undefined
  >(undefined);
  const [exportError, setExportError] = createSignal<string | null>(null);
  const [canvasHost, setCanvasHost] = createSignal<HTMLDivElement>();
  let inspectorHost: HTMLElement | undefined;

  const setActiveTool = (next: ToolKind): void => {
    if (props.editor.readOnly && next !== "select" && next !== "hand") return;
    if (next !== "comment") setPendingComment(null);
    setTool(next);
  };
  const beginCommentPlacement = (
    input: NewReviewMessage,
    onPlaced: () => void,
  ): void => {
    const [selected] = props.editor.selection.ids();
    setPendingComment({
      input,
      target: props.editor.selection.size === 1 ? selected : undefined,
      onPlaced,
    });
    setEditing(null);
    setContextMenu(null);
    setTool("comment");
  };
  const placeComment = (point: Vec): void => {
    const pending = pendingComment();
    if (!pending) return;
    const created = createReviewComment(
      props.editor,
      point,
      pending.input,
      pending.target,
    );
    if (created) pending.onPlaced();
  };

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
  let wasViewer = false;
  createEffect(() => {
    const viewer = cloud().role === "viewer";
    if (viewer === wasViewer) return;
    wasViewer = viewer;
    if (!viewer) return;
    setActiveTool("select");
    setEditing(null);
    setContextMenu(null);
  });

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

  // ------------------------------------------------------------ editing

  /** Start the inline editor on `id` when it has a text field. */
  const requestEdit = (id: ElementId): void => {
    if (props.editor.readOnly) return;
    const field = props.editor.editableField(id);
    if (field !== null) {
      setContextMenu(null);
      setEditing({ id, field });
    }
  };

  const focusInspector = (focus: InspectorFocus | undefined): void => {
    setInspectorFocus(focus);
    inspectorHost?.focus();
  };

  // A focus hint is about one element; once that element leaves the
  // selection the Inspector is showing something else and the hint is stale.
  onCleanup(
    props.editor.selection.subscribe((ids) => {
      const focus = inspectorFocus();
      if (focus && !ids.has(focus.id)) {
        setInspectorFocus(undefined);
      }
    }),
  );

  // ------------------------------------------------------------- export

  /** Document title or file name, as an `.svg` file name. */
  const exportFileName = (): string => {
    const base = isCloud()
      ? (cloud().title ?? cloud().docId ?? "untitled")
      : (file().fileName ?? props.editor.store.getMeta().title);
    return `${exportBaseName(base ?? "untitled")}.${EXPORT_EXTENSION}`;
  };

  /**
   * Export the selection when there is one, else the page (design 10). The
   * desktop asks where to write through the native dialog; a plain browser
   * gets a download.
   */
  const exportSvg = async (): Promise<void> => {
    setExportError(null);
    const options = { background: CANVAS_BACKGROUND };
    const selected = [...props.editor.selection.ids()];
    const artboard =
      selected.length === 1 &&
      props.editor.store.get(selected[0] ?? "")?.type === "frame"
        ? selected[0]
        : undefined;
    const svg = artboard
      ? props.editor.exportArtboardSvg(artboard)
      : props.editor.selection.size > 0
        ? props.editor.exportSelectionSvg(options)
        : props.editor.exportPageSvg(options);
    if (svg === null) {
      setExportError(
        artboard
          ? "Cannot export this artboard: it is hidden, rotated or has invalid dimensions."
          : "nothing to export: the page is empty",
      );
      return;
    }
    const name = exportFileName();
    if (!props.exportBackend.available) {
      downloadText(name, svg, "image/svg+xml");
      return;
    }
    try {
      const path = await props.exportBackend.pickExportPath(
        name,
        EXPORT_EXTENSION,
      );
      if (path === null) {
        return;
      }
      await props.exportBackend.writeText(path, svg);
    } catch (error) {
      setExportError(`could not export: ${describe(error)}`);
    }
  };

  /** Everything the shared action table needs from the shell. */
  const actionContext = (): ActionContext => ({
    editor: props.editor,
    viewport: viewport(),
    requestEdit,
    exportSvg: () => void exportSvg(),
  });

  // ----------------------------------------------------------- keyboard

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

      // Cmd/Ctrl+Shift+E exports wherever focus is: the export is a document
      // action, not a canvas gesture, and the canvas never binds it.
      if (modifier && event.shiftKey && !event.altKey && key === "e") {
        event.preventDefault();
        event.stopPropagation();
        runAction(getAction("exportSvg"), actionContext());
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

  // ----------------------------------------------------------- presence

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
    const host = canvasHost();
    if (!isCloud() || !host) {
      return;
    }
    const now = Date.now();
    if (now - lastCursorAt < CURSOR_THROTTLE_MS) {
      return;
    }
    lastCursorAt = now;
    const rect = host.getBoundingClientRect();
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
            {cloud().role === "viewer" ? " · Viewer" : ""}
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
          double-click to edit text, right-click for the menu, ctrl/cmd + wheel
          to zoom, shift + 1 to fit, cmd/ctrl + Z to undo, cmd/ctrl + S to save
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
      <Show when={cloud().error ?? file().error ?? exportError()}>
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
      <Toolbar
        editor={props.editor}
        tool={tool()}
        onToolChange={setActiveTool}
        context={actionContext()}
      />
      <PageTabs editor={props.editor} />
      <div class="app-editor-body">
        <Layers
          editor={props.editor}
          viewport={viewport()}
          commentAuthor={settings().userName}
          commentPlacementActive={
            tool() === "comment" && pendingComment() !== null
          }
          onPlaceComment={beginCommentPlacement}
          onCancelCommentPlacement={() => setActiveTool("select")}
        />
        <div
          class="app-canvas-host"
          ref={setCanvasHost}
          onPointerMove={onCanvasPointerMove}
          onPointerLeave={onCanvasPointerLeave}
        >
          <DiagraCanvas
            editor={props.editor}
            tool={tool()}
            onToolChange={setActiveTool}
            onMarquee={onMarquee}
            onCommentPlace={placeComment}
            snap={snap()}
            showGrid={showGrid()}
            onEditRequest={(id, region) => {
              if (region === "title" || region === "body") {
                requestEdit(id);
              } else {
                focusInspector({ id, row: region.row });
              }
            }}
            onContextMenu={(at, hit) => {
              // The menu acts on the selection. The canvas already selects
              // the hit before reporting it; this guard keeps that true if
              // the gesture layer ever stops doing so.
              if (hit !== null && !props.editor.selection.has(hit)) {
                props.editor.selection.set([hit]);
              }
              setEditing(null);
              setContextMenu({ at: at.screen });
            }}
            onViewportResize={setViewport}
          >
            <ReviewCommentPins
              editor={props.editor}
              author={settings().userName}
            />
            <Show when={editing()}>
              {(target) => (
                <TextEditor
                  editor={props.editor}
                  target={target()}
                  onDone={() => setEditing(null)}
                />
              )}
            </Show>
          </DiagraCanvas>
          <Show when={isCloud()}>
            <PresenceOverlay editor={props.editor} peers={cloud().peers} />
          </Show>
          <Show when={editing() === null}>
            <SelectionToolbar
              context={actionContext()}
              host={canvasHost()}
              onMore={() => {
                const [first] = props.editor.selection.ids();
                focusInspector(first === undefined ? undefined : { id: first });
              }}
            />
          </Show>
          <ZoomControls
            context={actionContext()}
            snap={snap()}
            showGrid={showGrid()}
            onSnapChange={setSnap}
            onShowGridChange={setShowGrid}
          />
          <Show when={contextMenu()}>
            {(menu) => (
              <ContextMenu
                context={actionContext()}
                at={menu().at}
                host={canvasHost()}
                onClose={() => setContextMenu(null)}
              />
            )}
          </Show>
        </div>
        <aside
          class="app-inspector"
          aria-label="Inspector"
          tabIndex={-1}
          ref={inspectorHost}
        >
          <Inspector editor={props.editor} focus={inspectorFocus()} />
        </aside>
      </div>
    </div>
  );
}
