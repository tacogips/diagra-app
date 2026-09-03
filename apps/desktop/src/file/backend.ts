// The seam between the document session and the OS.
//
// Everything the session needs from the host is behind this interface: the
// Tauri implementation invokes the Rust commands, and the fallback exists so
// `bun test` and `vite dev` in a plain browser can load the same module
// without a Tauri runtime. Nothing here interprets file contents.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** One entry of the Rust-owned recent-files list. */
export interface RecentEntry {
  readonly path: string;
  readonly openedAtMs: number;
}

/** Called with the path of the document whose file changed on disk. */
export type FileChangedListener = (path: string) => void;

export interface FileBackend {
  /** False when the app runs outside Tauri; file controls are disabled. */
  readonly available: boolean;
  /** The chosen path, or `null` when the dialog was cancelled. */
  pickOpenPath(): Promise<string | null>;
  pickSavePath(defaultName?: string): Promise<string | null>;
  readDocument(path: string): Promise<string>;
  /** Writes atomically: readers never observe a partial document. */
  writeDocument(path: string, contents: string): Promise<void>;
  listRecent(): Promise<readonly RecentEntry[]>;
  addRecent(path: string): Promise<readonly RecentEntry[]>;
  removeRecent(path: string): Promise<readonly RecentEntry[]>;
  /** Watch one document; replaces any previous watch. */
  watch(path: string): Promise<void>;
  unwatch(): Promise<void>;
  /** Returns an unsubscribe function. */
  onFileChanged(listener: FileChangedListener): () => void;
}

const FILE_CHANGED_EVENT = "document-file-changed";

interface ChangedPayload {
  readonly path: string;
}

export function createTauriBackend(): FileBackend {
  return {
    available: true,
    pickOpenPath: () => invoke<string | null>("pick_open_path"),
    pickSavePath: (defaultName?: string) =>
      invoke<string | null>("pick_save_path", {
        defaultName: defaultName ?? null,
      }),
    readDocument: (path: string) => invoke<string>("read_document", { path }),
    writeDocument: (path: string, contents: string) =>
      invoke<void>("write_document_atomic", { path, contents }),
    listRecent: () => invoke<RecentEntry[]>("recent_files_list"),
    addRecent: (path: string) =>
      invoke<RecentEntry[]>("recent_files_add", { path }),
    removeRecent: (path: string) =>
      invoke<RecentEntry[]>("recent_files_remove", { path }),
    watch: (path: string) => invoke<void>("watch_document", { path }),
    unwatch: () => invoke<void>("unwatch_document"),
    onFileChanged: (listener: FileChangedListener) => {
      // `listen` resolves asynchronously, but callers want a plain
      // unsubscribe now; a disposal that lands first is remembered so the
      // late listener is torn down as soon as it exists.
      let unlisten: UnlistenFn | null = null;
      let disposed = false;
      void listen<ChangedPayload>(FILE_CHANGED_EVENT, (event) => {
        listener(event.payload.path);
      }).then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      });
      return () => {
        disposed = true;
        unlisten?.();
        unlisten = null;
      };
    },
  };
}

function unavailable(): Promise<never> {
  return Promise.reject(
    new Error("local files are only available in the desktop app"),
  );
}

/**
 * Outside Tauri there is no filesystem to talk to. Reads and writes reject
 * rather than pretending to succeed; the passive operations answer empty so
 * the UI can render its disabled state without special cases.
 */
export function createUnavailableBackend(): FileBackend {
  return {
    available: false,
    pickOpenPath: () => Promise.resolve(null),
    pickSavePath: () => Promise.resolve(null),
    readDocument: unavailable,
    writeDocument: unavailable,
    listRecent: () => Promise.resolve([]),
    addRecent: () => Promise.resolve([]),
    removeRecent: () => Promise.resolve([]),
    watch: () => Promise.resolve(),
    unwatch: () => Promise.resolve(),
    onFileChanged: () => () => {},
  };
}

export function createFileBackend(): FileBackend {
  return isTauri() ? createTauriBackend() : createUnavailableBackend();
}

// ------------------------------------------------------------------ export

/**
 * The host side of "Export SVG" (design editor-ux 10). Kept apart from
 * `FileBackend` so the document session's contract does not grow a method it
 * never calls; the desktop implementation shares the same Rust commands.
 */
export interface ExportBackend {
  /** False outside Tauri: the shell falls back to a browser download. */
  readonly available: boolean;
  /**
   * Native save dialog filtered to `extension` (no leading dot). The chosen
   * path always carries the extension; `null` when the dialog was cancelled.
   */
  pickExportPath(
    defaultName: string,
    extension: string,
  ): Promise<string | null>;
  /** Writes text atomically, like `writeDocument`, for any file type. */
  writeText(path: string, contents: string): Promise<void>;
}

export function createTauriExportBackend(): ExportBackend {
  return {
    available: true,
    pickExportPath: (defaultName: string, extension: string) =>
      invoke<string | null>("pick_export_path", { defaultName, extension }),
    writeText: (path: string, contents: string) =>
      invoke<void>("write_document_atomic", { path, contents }),
  };
}

export function createUnavailableExportBackend(): ExportBackend {
  return {
    available: false,
    pickExportPath: () => Promise.resolve(null),
    writeText: unavailable,
  };
}

export function createExportBackend(): ExportBackend {
  return isTauri()
    ? createTauriExportBackend()
    : createUnavailableExportBackend();
}
