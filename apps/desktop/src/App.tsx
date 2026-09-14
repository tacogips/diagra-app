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
  HelpHint,
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
import { handleHistoryShortcut } from "./history-shortcuts.ts";
import { PresenceChip, PresenceOverlay } from "./cloud/PresenceOverlay.tsx";
import type { CloudSession, CloudSessionState } from "./cloud/session.ts";
import { bindCloudFileOwnership } from "./cloud/file-ownership.ts";
import type { CloudSettings } from "./cloud/settings.ts";
import type { ExportBackend } from "./file/backend.ts";
import type { DocumentSession, SessionState } from "./file/session.ts";
import {
  CANVAS_MIN_WIDTH,
  clampPaneWidth,
  PANE_MIN_WIDTH,
  paneBounds,
  paneWidthFromKey,
  paneWidthFromPointer,
  type PaneSide,
} from "./layout/pane.ts";
import "./square-chrome.css";
import "./pane.css";

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
  /** Opaque account lifecycle signal for invalidating cloud list pages. */
  readonly cloudRefreshToken?: unknown;
  /** Hosted shells can add account controls without coupling to public cloud code. */
  readonly headerContent?: JSX.Element;
  /** Hosted shells can mount workspace navigation above the shared Layers pane. */
  readonly navigationContent?: JSX.Element;
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
  const [cloudPanelExpanded, setCloudPanelExpanded] = createSignal(false);

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
  const [leftPaneOpen, setLeftPaneOpen] = createSignal(true);
  const [rightPaneOpen, setRightPaneOpen] = createSignal(true);
  const [leftPaneWidth, setLeftPaneWidth] = createSignal(260);
  const [rightPaneWidth, setRightPaneWidth] = createSignal(300);
  const [draggingPane, setDraggingPane] = createSignal<PaneSide | null>(null);
  let inspectorHost: HTMLDivElement | undefined;
  let editorBody: HTMLDivElement | undefined;
  let dragTarget: HTMLButtonElement | undefined;
  let dragPointerId: number | undefined;
  let leftRestoreButton: HTMLButtonElement | undefined;
  let rightRestoreButton: HTMLButtonElement | undefined;
  let leftCollapseButton: HTMLButtonElement | undefined;
  let rightCollapseButton: HTMLButtonElement | undefined;
  let fileMenu: HTMLDetailsElement | undefined;
  let settingsMenu: HTMLDetailsElement | undefined;
  let cloudPanelHost: HTMLDivElement | undefined;
  let headerHost: HTMLElement | undefined;
  const [cloudPanelTop, setCloudPanelTop] = createSignal(44);
  const dismissCloudPanel = (): void => {
    setCloudPanelExpanded(false);
    settingsMenu?.querySelector<HTMLElement>("summary")?.focus();
  };
  const [editorBodyWidth, setEditorBodyWidth] = createSignal(0);

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
  onCleanup(bindCloudFileOwnership(props.cloud, props.session));
  onCleanup(props.cloud.subscribe(setCloud));

  /**
   * Ownership is independent of transport status: reconnect permission probes
   * and fresh viewer snapshots must not reactivate local autosave.
   *
   * Not from the moment one is *requested*: `connecting` and `syncing` have
   * not touched the editor yet, and a connect that fails its authorization
   * probe must leave the user's open file exactly as it was.
   */
  const mode = (): DocumentMode =>
    cloud().ownsEditor ? { kind: "cloud" } : { kind: "file" };
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
    restorePane("right");
    queueMicrotask(() => inspectorHost?.focus());
  };

  const paneInput = (side: PaneSide) => {
    const rect = editorBody?.getBoundingClientRect();
    return {
      containerWidth: rect?.width ?? window.innerWidth,
      oppositeWidth:
        side === "left"
          ? rightPaneOpen()
            ? rightPaneWidth()
            : 34
          : leftPaneOpen()
            ? leftPaneWidth()
            : 34,
      overlaysCanvas: paneOverlaysCanvas(),
    };
  };
  const setPaneWidth = (side: PaneSide, width: number): void => {
    const next = clampPaneWidth(width, paneInput(side));
    if (side === "left") setLeftPaneWidth(next);
    else setRightPaneWidth(next);
  };
  const keepCanvasUseful = (): void => {
    const width = editorBody?.getBoundingClientRect().width;
    if (!width) return;
    setEditorBodyWidth(width);
    if (!leftPaneOpen() && !rightPaneOpen()) return;
    if (!leftPaneOpen()) {
      setRightPaneWidth(
        clampPaneWidth(rightPaneWidth(), {
          containerWidth: width,
          oppositeWidth: 34,
          overlaysCanvas: width < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + 34,
        }),
      );
      return;
    }
    if (!rightPaneOpen()) {
      setLeftPaneWidth(
        clampPaneWidth(leftPaneWidth(), {
          containerWidth: width,
          oppositeWidth: 34,
          overlaysCanvas: width < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + 34,
        }),
      );
      return;
    }
    const fittedLeft = clampPaneWidth(leftPaneWidth(), {
      containerWidth: width,
      oppositeWidth: 34,
      overlaysCanvas: width < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + 34,
    });
    if (width < CANVAS_MIN_WIDTH + fittedLeft + rightPaneWidth()) {
      setRightPaneOpen(false);
      setLeftPaneWidth(fittedLeft);
    } else {
      setLeftPaneWidth(fittedLeft);
      setRightPaneWidth(
        clampPaneWidth(rightPaneWidth(), {
          containerWidth: width,
          oppositeWidth: fittedLeft,
          overlaysCanvas: width < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + 34,
        }),
      );
    }
  };
  const restorePane = (side: PaneSide, focusContent = false): void => {
    const width =
      editorBody?.getBoundingClientRect().width ?? window.innerWidth;
    if (side === "left") {
      if (
        rightPaneOpen() &&
        width < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + rightPaneWidth()
      )
        setRightPaneOpen(false);
      setLeftPaneWidth(
        clampPaneWidth(leftPaneWidth(), {
          containerWidth: width,
          oppositeWidth: rightPaneOpen() ? rightPaneWidth() : 34,
          overlaysCanvas: width < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + 34,
        }),
      );
      setLeftPaneOpen(true);
    } else {
      if (
        leftPaneOpen() &&
        width < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + leftPaneWidth()
      )
        setLeftPaneOpen(false);
      setRightPaneWidth(
        clampPaneWidth(rightPaneWidth(), {
          containerWidth: width,
          oppositeWidth: leftPaneOpen() ? leftPaneWidth() : 34,
          overlaysCanvas: width < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + 34,
        }),
      );
      setRightPaneOpen(true);
    }
    if (focusContent) {
      queueMicrotask(() => {
        (side === "left" ? leftCollapseButton : rightCollapseButton)?.focus({
          preventScroll: true,
        });
      });
    }
  };
  const hidePane = (side: PaneSide): void => {
    if (side === "left") setLeftPaneOpen(false);
    else setRightPaneOpen(false);
    queueMicrotask(() => {
      (side === "left" ? leftRestoreButton : rightRestoreButton)?.focus();
    });
  };
  const paneOverlaysCanvas = (): boolean =>
    editorBodyWidth() < CANVAS_MIN_WIDTH + PANE_MIN_WIDTH + 34;
  const beginPaneResize = (side: PaneSide, event: PointerEvent): void => {
    if (event.button !== 0) return;
    restorePane(side);
    const target = event.currentTarget as HTMLButtonElement;
    target.setPointerCapture(event.pointerId);
    dragTarget = target;
    dragPointerId = event.pointerId;
    setDraggingPane(side);
    event.preventDefault();
  };
  const movePaneResize = (side: PaneSide, event: PointerEvent): void => {
    if (draggingPane() !== side || dragPointerId !== event.pointerId) return;
    const rect = editorBody?.getBoundingClientRect();
    if (!rect) return;
    setPaneWidth(
      side,
      paneWidthFromPointer(side, event.clientX, rect.left, rect.right),
    );
  };
  const endPaneResize = (event: PointerEvent): void => {
    if (dragPointerId !== event.pointerId) return;
    if (dragTarget?.hasPointerCapture(event.pointerId)) {
      dragTarget.releasePointerCapture(event.pointerId);
    }
    dragTarget = undefined;
    dragPointerId = undefined;
    setDraggingPane(null);
  };
  const resizePaneByKey = (side: PaneSide, event: KeyboardEvent): void => {
    const width = side === "left" ? leftPaneWidth() : rightPaneWidth();
    const next = paneWidthFromKey(side, width, event.key, paneInput(side));
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setPaneWidth(side, next);
  };
  onCleanup(() => {
    if (
      dragTarget &&
      dragPointerId !== undefined &&
      dragTarget.hasPointerCapture(dragPointerId)
    ) {
      dragTarget.releasePointerCapture(dragPointerId);
    }
  });
  onMount(() => {
    const header = headerHost;
    if (!header) return;
    const positionCloud = (): void => {
      setCloudPanelTop(header.getBoundingClientRect().bottom + 4);
    };
    const observer = new ResizeObserver(positionCloud);
    observer.observe(header);
    window.addEventListener("resize", positionCloud);
    positionCloud();
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("resize", positionCloud);
    });
  });
  onMount(() => {
    if (!editorBody) return;
    const observer = new ResizeObserver(keepCanvasUseful);
    observer.observe(editorBody);
    keepCanvasUseful();
    onCleanup(() => observer.disconnect());
  });

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
      if (isCloud() && handleHistoryShortcut(event, props.cloud)) return;

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
    const localHistory = (event: KeyboardEvent): void => {
      if (!isCloud()) handleHistoryShortcut(event, props.editor);
    };
    // Bubble after canvas handlers so their nudge/gesture bookkeeping runs
    // first and a handled chord cannot undo twice.
    window.addEventListener("keydown", localHistory);
    const dismissHeaderMenus = (event: KeyboardEvent | MouseEvent): void => {
      if (
        cloudPanelExpanded() &&
        event instanceof MouseEvent &&
        event.target instanceof Node &&
        !cloudPanelHost?.contains(event.target) &&
        !settingsMenu?.contains(event.target) &&
        !(
          event.target instanceof Element &&
          event.target.closest(".diagra-help-tooltip")
        )
      ) {
        setCloudPanelExpanded(false);
      }
      for (const menu of [fileMenu, settingsMenu]) {
        if (
          !menu?.open ||
          !(
            (event instanceof KeyboardEvent && event.key === "Escape") ||
            (event instanceof MouseEvent &&
              !menu.contains(event.target as Node))
          )
        )
          continue;
        menu.removeAttribute("open");
        if (event instanceof KeyboardEvent) {
          event.preventDefault();
          event.stopPropagation();
          menu.querySelector<HTMLElement>("summary")?.focus();
        }
      }
    };
    window.addEventListener("keydown", dismissHeaderMenus, true);
    window.addEventListener("pointerdown", dismissHeaderMenus, true);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keydown", localHistory);
      window.removeEventListener("keydown", dismissHeaderMenus, true);
      window.removeEventListener("pointerdown", dismissHeaderMenus, true);
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
      <header class="app-header" ref={headerHost}>
        <span class="app-title">diagra</span>
        <details class="app-file-menu" ref={fileMenu}>
          <summary
            class="app-file-button"
            title={
              props.filesAvailable
                ? undefined
                : "Local file commands require the desktop app. In the browser, use Import design and Download design."
            }
          >
            File
          </summary>
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
        </details>
        <details class="app-settings-menu" ref={settingsMenu}>
          <summary class="app-file-button">Settings</summary>
          <div class="app-settings-controls">
            <button
              type="button"
              class="app-file-button"
              aria-expanded={cloudPanelExpanded()}
              onClick={() => {
                const next = !cloudPanelExpanded();
                setCloudPanelExpanded(next);
                settingsMenu?.removeAttribute("open");
                queueMicrotask(() => {
                  if (next) {
                    cloudPanelHost
                      ?.querySelector<HTMLElement>(
                        ".app-cloud-body input, .app-cloud-body button, .app-cloud-body select",
                      )
                      ?.focus();
                  } else {
                    settingsMenu
                      ?.querySelector<HTMLElement>("summary")
                      ?.focus();
                  }
                });
              }}
            >
              {cloudPanelExpanded() ? "Hide cloud" : "Cloud"}
            </button>
          </div>
        </details>
        <div class="app-header-slot">{props.headerContent}</div>
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
              aria-label="Undo"
              title="Undo (Cmd/Ctrl+Z)"
              disabled={!cloud().canUndo}
              onClick={() => props.cloud.undo()}
            >
              <svg
                class="app-history-icon"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M8 6l-5 5 5 5v-3c5 0 7 2 8 5 0-6-3-9-8-9z" />
              </svg>
            </button>
            <button
              type="button"
              class="app-file-button"
              aria-label="Redo"
              title="Redo (Cmd/Ctrl+Shift+Z)"
              disabled={!cloud().canRedo}
              onClick={() => props.cloud.redo()}
            >
              <svg
                class="app-history-icon"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M12 6l5 5-5 5v-3c-5 0-7 2-8 5 0-6 3-9 8-9z" />
              </svg>
            </button>
          </div>
        </Show>
        <Show when={file().status === "saving" && !isCloud()}>
          <span class="app-file-status">saving…</span>
        </Show>
        <HelpHint text="Double-click to edit text; right-click for the menu; Ctrl/Cmd + wheel to zoom; Shift + 1 to fit; Ctrl/Cmd + Z to undo; Ctrl/Cmd + S to save." />
      </header>
      <div
        ref={cloudPanelHost}
        style={{ "--app-cloud-top": `${cloudPanelTop()}px` }}
      >
        <CloudPanel
          editor={props.editor}
          session={props.cloud}
          state={cloud()}
          settings={settings()}
          onSettingsChange={updateSettings}
          refreshToken={props.cloudRefreshToken}
          expanded={cloudPanelExpanded()}
          onExpandedChange={(expanded) => {
            if (expanded) setCloudPanelExpanded(true);
            else dismissCloudPanel();
          }}
          renderToggle={false}
          // Opening a room replaces what is on the canvas, exactly like opening
          // a file does, so it asks the same question first.
          mayDiscard={mayDiscard}
        />
      </div>
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
      <div class="app-editor-body" ref={editorBody}>
        <aside
          class="app-pane app-pane-left"
          classList={{
            "is-collapsed": !leftPaneOpen(),
            "is-overlay": leftPaneOpen() && paneOverlaysCanvas(),
          }}
          style={{ "--pane-width": `${leftPaneWidth()}px` }}
          aria-label="Layers"
        >
          <div
            class="app-pane-content"
            aria-hidden={!leftPaneOpen()}
            inert={!leftPaneOpen()}
          >
            <button
              type="button"
              class="app-pane-collapse"
              onClick={() => hidePane("left")}
              aria-label="Hide Layers"
              ref={leftCollapseButton}
              title="Hide Layers"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M11 4l-5 6 5 6" />
              </svg>
            </button>
            <div class="app-pane-navigation">{props.navigationContent}</div>
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
          </div>
          <button
            type="button"
            class="app-pane-restore"
            onClick={() => restorePane("left", true)}
            aria-label="Show Layers"
            ref={leftRestoreButton}
          >
            Layers
          </button>
        </aside>
        <button
          type="button"
          class="app-pane-divider"
          classList={{
            "is-dragging": draggingPane() === "left",
            "is-overlay-divider": leftPaneOpen() && paneOverlaysCanvas(),
          }}
          style={
            leftPaneOpen() && paneOverlaysCanvas()
              ? { left: `${leftPaneWidth() - 4}px` }
              : undefined
          }
          role="separator"
          aria-label="Resize Layers"
          aria-orientation="vertical"
          aria-valuemin={paneBounds(paneInput("left")).min}
          aria-valuemax={paneBounds(paneInput("left")).max}
          aria-valuenow={leftPaneWidth()}
          onPointerDown={(event) => beginPaneResize("left", event)}
          onPointerMove={(event) => movePaneResize("left", event)}
          onPointerUp={endPaneResize}
          onPointerCancel={endPaneResize}
          onKeyDown={(event) => resizePaneByKey("left", event)}
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
        <button
          type="button"
          class="app-pane-divider"
          classList={{
            "is-dragging": draggingPane() === "right",
            "is-overlay-divider": rightPaneOpen() && paneOverlaysCanvas(),
          }}
          style={
            rightPaneOpen() && paneOverlaysCanvas()
              ? { right: `${rightPaneWidth() - 4}px` }
              : undefined
          }
          role="separator"
          aria-label="Resize Inspector"
          aria-orientation="vertical"
          aria-valuemin={paneBounds(paneInput("right")).min}
          aria-valuemax={paneBounds(paneInput("right")).max}
          aria-valuenow={rightPaneWidth()}
          onPointerDown={(event) => beginPaneResize("right", event)}
          onPointerMove={(event) => movePaneResize("right", event)}
          onPointerUp={endPaneResize}
          onPointerCancel={endPaneResize}
          onKeyDown={(event) => resizePaneByKey("right", event)}
        />
        <aside
          class="app-pane app-pane-right"
          classList={{
            "is-collapsed": !rightPaneOpen(),
            "is-overlay": rightPaneOpen() && paneOverlaysCanvas(),
          }}
          style={{ "--pane-width": `${rightPaneWidth()}px` }}
          aria-label="Inspector"
        >
          <div
            class="app-pane-content"
            aria-hidden={!rightPaneOpen()}
            inert={!rightPaneOpen()}
          >
            <button
              type="button"
              class="app-pane-collapse"
              onClick={() => hidePane("right")}
              aria-label="Hide Inspector"
              ref={rightCollapseButton}
              title="Hide Inspector"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M9 4l5 6-5 6" />
              </svg>
            </button>
            <div class="app-inspector" tabIndex={-1} ref={inspectorHost}>
              <Inspector editor={props.editor} focus={inspectorFocus()} />
            </div>
          </div>
          <button
            type="button"
            class="app-pane-restore"
            onClick={() => restorePane("right", true)}
            aria-label="Show Inspector"
            ref={rightRestoreButton}
          >
            Inspector
          </button>
        </aside>
      </div>
    </div>
  );
}
