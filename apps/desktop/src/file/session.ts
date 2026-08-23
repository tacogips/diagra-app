// The document lifecycle: which file is open, whether it has unsaved edits,
// and what to do when the file changes underneath us.
//
// Framework-free on purpose. The session owns no rendering and no Tauri
// import (only the `FileBackend` type), so the whole lifecycle is testable
// headlessly and the UI is a thin subscriber.
//
// Two invariants drive most of the code:
//
//   - `lastSavedText` is the exact text on disk as we last saw it. A change
//     event carrying those same bytes is our own write echoing back, and is
//     ignored. Comparing text rather than timestamps means an editor that
//     rewrites the file identically also stays quiet.
//   - `loading` is set while the editor is being replaced, so the diffs a
//     load produces never mark the fresh document dirty.

import { type Editor, newElementId } from "@diagra/core";
import { type Document, formatIssue, SCHEMA_VERSION } from "@diagra/ir";
import { parseDocumentResult, serializeDocument } from "@diagra/io";
import type { FileBackend, RecentEntry } from "./backend.ts";

export type SessionStatus = "idle" | "loading" | "saving";

export interface SessionConflict {
  /** What the file holds now, ready to be loaded if the user reloads. */
  readonly diskText: string;
}

export interface SessionState {
  readonly filePath: string | null;
  readonly fileName: string | null;
  readonly dirty: boolean;
  readonly conflict: SessionConflict | null;
  readonly recent: readonly RecentEntry[];
  readonly status: SessionStatus;
  readonly error: string | null;
}

export type SessionListener = (state: SessionState) => void;

/** Opaque timer token, so tests can hand over their own scheduler. */
export type TimerHandle = unknown;

export interface DocumentSessionOptions {
  readonly editor: Editor;
  readonly backend: FileBackend;
  /** Quiet period after the last edit before autosave writes. */
  readonly autosaveDelayMs?: number;
  readonly scheduleTimer?: (
    callback: () => void,
    delayMs: number,
  ) => TimerHandle;
  readonly cancelTimer?: (handle: TimerHandle) => void;
}

const DEFAULT_AUTOSAVE_DELAY_MS = 1000;
const UNTITLED_FILE_NAME = "untitled.jsonl";

/**
 * The document a new file starts from: one empty freeform page, matching
 * what `Editor` builds for itself when constructed without a document.
 */
export function emptyLocalDocument(): Document {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newElementId(),
    title: "Untitled",
    pages: [{ id: newElementId(), name: "Page 1", kind: "freeform" }],
    elements: [],
  };
}

/** The last path segment, for either separator. */
export function baseName(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator === -1 ? path : path.slice(separator + 1);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DocumentSession {
  private readonly editor: Editor;
  private readonly backend: FileBackend;
  private readonly autosaveDelayMs: number;
  private readonly scheduleTimer: (
    callback: () => void,
    delayMs: number,
  ) => TimerHandle;
  private readonly cancelTimer: (handle: TimerHandle) => void;

  private readonly listeners = new Set<SessionListener>();
  private readonly unsubscribeEditor: () => void;
  private readonly unsubscribeFileChanged: () => void;

  private current: SessionState = {
    filePath: null,
    fileName: null,
    dirty: false,
    conflict: null,
    recent: [],
    status: "idle",
    error: null,
  };

  /** The bytes on disk as of our last read or write. */
  private lastSavedText: string | null = null;
  private loading = false;
  private autosaveHandle: TimerHandle | null = null;
  /** Serializes writes, so two saves can never interleave on one file. */
  private writes: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(options: DocumentSessionOptions) {
    this.editor = options.editor;
    this.backend = options.backend;
    this.autosaveDelayMs = options.autosaveDelayMs ?? DEFAULT_AUTOSAVE_DELAY_MS;
    this.scheduleTimer =
      options.scheduleTimer ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimer =
      options.cancelTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });

    this.unsubscribeEditor = this.editor.subscribe((diff) => {
      // Page switches and history-only notifications carry no element
      // change, and nothing in the current UI edits the page list, so an
      // element diff is exactly "the document changed".
      const changed =
        diff.added.length > 0 ||
        diff.updated.length > 0 ||
        diff.removed.length > 0;
      if (changed && !this.loading) {
        this.markDirty();
      }
    });
    this.unsubscribeFileChanged = this.backend.onFileChanged((path) => {
      void this.handleFileChanged(path);
    });

    void this.refreshRecent();
  }

  state(): SessionState {
    return this.current;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Discard the open file and start from an empty document. */
  async newDocument(): Promise<void> {
    this.cancelAutosave();
    await this.stopWatching();
    this.load(emptyLocalDocument());
    this.lastSavedText = null;
    this.patch({
      filePath: null,
      fileName: null,
      dirty: false,
      conflict: null,
      status: "idle",
      error: null,
    });
  }

  /** Ask for a file and open it. Returns false when cancelled or failed. */
  async open(): Promise<boolean> {
    let path: string | null;
    try {
      path = await this.backend.pickOpenPath();
    } catch (error) {
      this.fail(describe(error));
      return false;
    }
    if (path === null) {
      return false;
    }
    return this.openPath(path);
  }

  async openPath(path: string): Promise<boolean> {
    this.cancelAutosave();
    this.patch({ status: "loading", error: null });

    let diskText: string;
    try {
      diskText = await this.backend.readDocument(path);
    } catch (error) {
      // The file is gone or unreadable, so it is no longer worth offering.
      await this.forgetRecent(path);
      this.fail(`could not open ${baseName(path)}: ${describe(error)}`);
      return false;
    }

    const parsed = parseDocumentResult(diskText);
    if (!parsed.ok) {
      // A file we cannot parse leaves the open document untouched: losing
      // the user's work to someone else's malformed file is unacceptable.
      this.fail(
        `could not parse ${baseName(path)}:\n${parsed.issues
          .filter((issue) => issue.severity === "error")
          .map(formatIssue)
          .join("\n")}`,
      );
      return false;
    }

    this.load(parsed.document);
    this.lastSavedText = diskText;
    this.patch({
      filePath: path,
      fileName: baseName(path),
      dirty: false,
      conflict: null,
      status: "idle",
      error: null,
    });
    await this.rememberRecent(path);
    await this.startWatching(path);
    return true;
  }

  /** Write to the open file, asking for a path first if there is none. */
  async save(): Promise<boolean> {
    const path = this.current.filePath;
    if (path === null) {
      return this.saveAs();
    }
    this.cancelAutosave();
    return this.write(path);
  }

  async saveAs(): Promise<boolean> {
    let path: string | null;
    try {
      path = await this.backend.pickSavePath(
        this.current.fileName ?? UNTITLED_FILE_NAME,
      );
    } catch (error) {
      this.fail(describe(error));
      return false;
    }
    if (path === null) {
      return false;
    }
    this.cancelAutosave();
    const written = await this.write(path);
    if (!written) {
      return false;
    }
    await this.rememberRecent(path);
    await this.startWatching(path);
    return true;
  }

  /**
   * Answer the conflict banner: `"reload"` takes the file, `"keep"` keeps
   * the in-memory document and lets the next save overwrite the file.
   */
  async resolveConflict(choice: "reload" | "keep"): Promise<boolean> {
    const conflict = this.current.conflict;
    if (conflict === null) {
      return false;
    }
    if (choice === "keep") {
      this.patch({ conflict: null });
      this.markDirty();
      return true;
    }

    const parsed = parseDocumentResult(conflict.diskText);
    if (!parsed.ok) {
      // Keep the banner up: the user still has to decide, and their only
      // safe option now is to keep what is in memory.
      this.patch({
        error: `could not parse the file on disk:\n${parsed.issues
          .filter((issue) => issue.severity === "error")
          .map(formatIssue)
          .join("\n")}`,
      });
      return false;
    }

    this.cancelAutosave();
    this.load(parsed.document);
    this.lastSavedText = conflict.diskText;
    this.patch({ dirty: false, conflict: null, error: null });
    return true;
  }

  /**
   * Write any pending autosave now. Best effort on the way out: a debounce
   * that has not fired yet would otherwise take the last edit with it.
   */
  async flush(): Promise<boolean> {
    if (this.autosaveHandle === null || this.current.filePath === null) {
      return false;
    }
    return this.save();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelAutosave();
    this.unsubscribeEditor();
    this.unsubscribeFileChanged();
    void this.backend.unwatch().catch(() => {});
    this.listeners.clear();
  }

  private load(document: Document): void {
    this.loading = true;
    try {
      this.editor.loadDocument(document);
    } finally {
      this.loading = false;
    }
  }

  private markDirty(): void {
    if (!this.current.dirty) {
      this.patch({ dirty: true });
    }
    if (this.current.filePath !== null) {
      this.scheduleAutosave();
    }
  }

  private scheduleAutosave(): void {
    this.cancelAutosave();
    this.autosaveHandle = this.scheduleTimer(() => {
      this.autosaveHandle = null;
      void this.save();
    }, this.autosaveDelayMs);
  }

  private cancelAutosave(): void {
    if (this.autosaveHandle !== null) {
      this.cancelTimer(this.autosaveHandle);
      this.autosaveHandle = null;
    }
  }

  /**
   * Queue one write behind any write already running. Serializing them
   * keeps `lastSavedText` describing the bytes that actually landed last.
   */
  private write(path: string): Promise<boolean> {
    const queued = this.writes.then(
      () => this.performWrite(path),
      () => this.performWrite(path),
    );
    this.writes = queued;
    return queued;
  }

  private async performWrite(path: string): Promise<boolean> {
    let text: string;
    try {
      text = serializeDocument(this.editor.getSnapshot());
    } catch (error) {
      this.fail(`could not serialize the document: ${describe(error)}`);
      return false;
    }

    this.patch({ status: "saving", error: null });
    try {
      await this.backend.writeDocument(path, text);
    } catch (error) {
      this.fail(`could not save ${baseName(path)}: ${describe(error)}`);
      return false;
    }

    this.lastSavedText = text;
    this.patch({
      filePath: path,
      fileName: baseName(path),
      dirty: false,
      status: "idle",
      error: null,
    });
    return true;
  }

  private async handleFileChanged(path: string): Promise<void> {
    if (this.disposed || path !== this.current.filePath) {
      return;
    }
    let diskText: string;
    try {
      diskText = await this.backend.readDocument(path);
    } catch {
      // A transient read failure mid-write is not worth a banner; the next
      // event carries the settled contents.
      return;
    }
    if (diskText === this.lastSavedText) {
      return;
    }
    this.patch({ conflict: { diskText } });
  }

  private async startWatching(path: string): Promise<void> {
    try {
      await this.backend.watch(path);
    } catch {
      // Losing the watch costs the reload prompt, not the document.
    }
  }

  private async stopWatching(): Promise<void> {
    try {
      await this.backend.unwatch();
    } catch {
      // Nothing to recover: there is no longer a watch we depend on.
    }
  }

  private async refreshRecent(): Promise<void> {
    try {
      this.patch({ recent: await this.backend.listRecent() });
    } catch {
      // An unreadable list is an empty list, not an error the user must act
      // on.
    }
  }

  private async rememberRecent(path: string): Promise<void> {
    try {
      this.patch({ recent: await this.backend.addRecent(path) });
    } catch {
      // Same as above: the recent list is a convenience.
    }
  }

  private async forgetRecent(path: string): Promise<void> {
    try {
      this.patch({ recent: await this.backend.removeRecent(path) });
    } catch {
      // Same as above.
    }
  }

  private fail(message: string): void {
    this.patch({ status: "idle", error: message });
  }

  private patch(changes: Partial<SessionState>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of [...this.listeners]) {
      listener(this.current);
    }
  }
}
