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

import {
  diffDocuments,
  DocumentChangeMonitor,
  type DocumentChangeSource,
  type Editor,
  isEmptyCommit,
  mergeDocuments,
  newElementId,
} from "@nodetto/core";
import {
  assertValidDocument,
  type Document,
  formatIssue,
  getElementTypeDefinition,
  SCHEMA_VERSION,
} from "@nodetto/ir";
import { parseDocumentResult, serializeDocument } from "@nodetto/io";
import type { BpmnImportWarning } from "@nodetto/io";
import type { SaveMode } from "./save-mode.ts";
import { createFileDocumentChangeSource } from "./change-source.ts";
import type { FileBackend, RecentEntry } from "./backend.ts";

export type SessionStatus = "idle" | "loading" | "saving";

export interface SessionConflict {
  /** What the file holds now, ready to be loaded if the user reloads. */
  readonly diskText: string;
  /**
   * Ids changed on both sides when an outside change was merged into unsaved
   * local edits; the local version of those was kept. Absent when the disk
   * change could not be merged at all.
   */
  readonly mergedConflicts?: readonly string[];
}

/** The last change another writer made to the open file, shown live. */
export interface OutsideChange {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  /** True when it was merged into unsaved local edits. */
  readonly merged: boolean;
}

export interface SessionState {
  readonly saveMode: SaveMode;
  readonly filePath: string | null;
  readonly fileName: string | null;
  readonly dirty: boolean;
  readonly conflict: SessionConflict | null;
  /** Cleared by the next local edit, open or new document. */
  readonly outsideChange: OutsideChange | null;
  readonly recent: readonly RecentEntry[];
  readonly importWarnings: readonly BpmnImportWarning[];
  readonly status: SessionStatus;
  readonly error: string | null;
}

export type SessionListener = (state: SessionState) => void;

/** Opaque timer token, so tests can hand over their own scheduler. */
export type TimerHandle = unknown;

export interface DocumentSessionOptions {
  readonly editor: Editor;
  readonly backend: FileBackend;
  readonly changes?: DocumentChangeSource;
  readonly saveMode?: SaveMode;
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
 * How the backend reports a file that is not there. Must match
 * `MISSING_FILE_MESSAGE` in `apps/desktop/src-tauri/src/fs.rs`; both sides
 * carry a comment saying so, and both sides have a test pinning it.
 */
const MISSING_FILE_MARKER = "file not found";

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

function isMermaidPath(path: string): boolean {
  return /\.(?:mmd|mermaid)$/i.test(path);
}

function mermaidTitle(path: string): string {
  return baseName(path).replace(/\.(?:mmd|mermaid)$/i, "");
}

function isBpmnPath(path: string): boolean {
  return /\.bpmn$/i.test(path);
}

function bpmnTitle(path: string): string {
  return baseName(path).replace(/\.bpmn$/i, "");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when a read failed because the file does not exist. */
function isMissingFile(error: unknown): boolean {
  return describe(error).startsWith(MISSING_FILE_MARKER);
}

export class DocumentSession {
  private readonly editor: Editor;
  private readonly backend: FileBackend;
  private readonly changes: DocumentChangeSource;
  private readonly changeMonitor = new DocumentChangeMonitor();
  private autosaveDelayMs: number;
  private readonly scheduleTimer: (
    callback: () => void,
    delayMs: number,
  ) => TimerHandle;
  private readonly cancelTimer: (handle: TimerHandle) => void;

  private readonly listeners = new Set<SessionListener>();
  private readonly unsubscribeEditor: () => void;

  private current: SessionState = {
    saveMode: "automatic",
    filePath: null,
    fileName: null,
    dirty: false,
    conflict: null,
    outsideChange: null,
    recent: [],
    importWarnings: [],
    status: "idle",
    error: null,
  };

  /** The bytes on disk as of our last read or write. */
  private lastSavedText: string | null = null;
  /** Bumped by every document load; see `write` and `performWrite`. */
  private documentGeneration = 0;
  /**
   * Bumped by every open request and by anything else that replaces the
   * document. An open whose number is no longer current when its read
   * settles was overtaken and must not touch the editor, the dirty flag, the
   * recent list or the watch; see `openPath`.
   */
  private openRequest = 0;
  private loading = false;
  /** True while another mode owns the editor; see `suspend`. */
  private suspended = false;
  private autosaveHandle: TimerHandle | null = null;
  /** Serializes writes, so two saves can never interleave on one file. */
  private writes: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private automaticSave: {
    generation: number;
    promise: Promise<boolean>;
  } | null = null;

  constructor(options: DocumentSessionOptions) {
    this.current = {
      ...this.current,
      saveMode: options.saveMode ?? "automatic",
    };
    this.editor = options.editor;
    this.backend = options.backend;
    this.changes =
      options.changes ?? createFileDocumentChangeSource(options.backend);
    this.autosaveDelayMs = options.autosaveDelayMs ?? DEFAULT_AUTOSAVE_DELAY_MS;
    this.scheduleTimer =
      options.scheduleTimer ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimer =
      options.cancelTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });

    this.unsubscribeEditor = this.editor.store.subscribe((diff) => {
      // Observe persisted content directly: editor notifications also include
      // active-page switches and history availability, which are view state.
      const changed =
        diff.pagesChanged ||
        diff.added.length > 0 ||
        diff.updated.length > 0 ||
        diff.removed.length > 0;
      if (changed && !this.loading && !this.suspended) {
        // The note describes the last outside change; a local edit retires it.
        if (this.current.outsideChange !== null)
          this.patch({ outsideChange: null });
        this.markDirty();
      }
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

  setSaveMode(mode: SaveMode): void {
    if (mode === this.current.saveMode) return;
    this.cancelAutosave();
    this.patch({ saveMode: mode });
    if (this.canAutosave()) this.scheduleAutosave();
  }

  setAutosaveDelayMs(delayMs: number): void {
    if (!Number.isFinite(delayMs) || delayMs < 100 || delayMs > 60000) return;
    this.autosaveDelayMs = delayMs;
    if (this.canAutosave()) this.scheduleAutosave();
  }

  /** Discard the open file and start from an empty document. */
  async newDocument(): Promise<void> {
    this.openRequest += 1;
    this.cancelAutosave();
    await this.stopWatching();
    this.load(emptyLocalDocument());
    this.lastSavedText = null;
    this.patch({
      filePath: null,
      fileName: null,
      dirty: false,
      importWarnings: [],
      conflict: null,
      outsideChange: null,
      status: "idle",
      error: null,
    });
  }

  /**
   * Import a detached document; no previous file may receive its autosave.
   * Returns false when refused (a cloud room owns the editor) or overtaken by
   * a newer open, import or hand-over while the old watch was stopping.
   */
  async importDocument(
    document: Document,
    name: string,
    importWarnings: readonly BpmnImportWarning[] = [],
  ): Promise<boolean> {
    assertValidDocument(document);
    if (this.refuseWhileSuspended()) {
      return false;
    }
    const request = ++this.openRequest;
    this.cancelAutosave();
    await this.stopWatching();
    if (request !== this.openRequest || this.suspended || this.disposed) {
      return false;
    }
    this.load(document);
    this.lastSavedText = null;
    this.patch({
      filePath: null,
      fileName: baseName(name),
      dirty: true,
      importWarnings,
      conflict: null,
      status: "idle",
      error: null,
    });
    return true;
  }

  /** Ask for a file and open it. Returns false when cancelled or failed. */
  async open(): Promise<boolean> {
    if (this.refuseWhileSuspended()) {
      return false;
    }
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
    // While a cloud room owns the editor, loading a file would write it
    // straight into the shared document.
    if (this.refuseWhileSuspended()) {
      return false;
    }
    const request = ++this.openRequest;
    // Overtaken by a newer open, a new or imported document, or a hand-over
    // to another mode: this request must leave everything alone.
    const stale = (): boolean =>
      request !== this.openRequest || this.suspended || this.disposed;
    this.cancelAutosave();
    this.patch({ status: "loading", error: null });

    let diskText: string;
    try {
      diskText = await this.backend.readDocument(path);
    } catch (error) {
      // Only a file that is genuinely gone leaves the recent list. A
      // document on a share that happens to be offline is still the user's
      // document, and pruning it would make them hunt for it again.
      if (isMissingFile(error)) {
        await this.forgetRecent(path);
      }
      if (!stale()) {
        this.fail(`could not open ${baseName(path)}: ${describe(error)}`);
      }
      return false;
    }
    if (stale()) {
      return false;
    }

    if (isMermaidPath(path)) {
      try {
        const { importMermaid } = await import("@nodetto/io/mermaid/import");
        if (stale()) {
          return false;
        }
        const imported = importMermaid(diskText, { title: mermaidTitle(path) });
        // Mermaid is an interchange source, not our persistence format. Keep
        // the imported document detached so autosave can never rewrite it.
        return await this.importDocument(imported.document, baseName(path));
      } catch (error) {
        this.fail(`could not import ${baseName(path)}: ${describe(error)}`);
        return false;
      }
    }

    if (isBpmnPath(path)) {
      try {
        const { importBpmnXml } = await import("@nodetto/io/bpmn");
        if (stale()) {
          return false;
        }
        const report = importBpmnXml(diskText, { title: bpmnTitle(path) });
        // BPMN XML is an interchange source, not our persistence format.
        // Keep it detached so autosave can never rewrite the source file.
        return await this.importDocument(
          report.document,
          baseName(path),
          report.warnings,
        );
      } catch (error) {
        if (!stale()) {
          this.fail(`could not import ${baseName(path)}: ${describe(error)}`);
        }
        return false;
      }
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
      importWarnings: [],
      conflict: null,
      status: "idle",
      error: null,
    });
    await this.rememberRecent(path, stale);
    if (stale()) {
      // A newer document replaced this one while the recent list was
      // updating; its watch, not ours, is the one that must stay.
      return true;
    }
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
    const written = await this.saveAutomatically();
    await this.writes;
    // Edits made while the first write was in flight still need to land.
    if (written && this.canAutosave()) return this.saveAutomatically();
    return written;
  }

  /**
   * Let go of the editor because another document mode is taking it over.
   *
   * A cloud room writes other people's edits straight into the store, and
   * every one of them would otherwise look like the user editing the open
   * file — the debounced autosave would then copy a completely different
   * document over it. Suspending closes the file rather than merely pausing:
   * once the editor holds something else, this session has no claim on that
   * path any more, and the next explicit save has to ask where to write.
   */
  suspend(): void {
    if (this.suspended) {
      return;
    }
    this.suspended = true;
    this.openRequest += 1;
    this.cancelAutosave();
    // Retire anything already queued for the document being handed over.
    this.documentGeneration += 1;
    void this.stopWatching();
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

  /** Take the editor back. The file controls are live again. */
  resume(): void {
    this.suspended = false;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelAutosave();
    this.unsubscribeEditor();
    void this.changeMonitor.close().catch(() => {});
    this.listeners.clear();
  }

  private load(document: Document): void {
    // Every load retires the writes queued for the outgoing document; see
    // `performWrite`.
    this.documentGeneration += 1;
    if (this.current.outsideChange !== null)
      this.patch({ outsideChange: null });
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
    // An unresolved conflict suspends autosave. The banner exists to ask
    // which version wins; writing while it is up would answer that question
    // for the user and destroy the other writer's work. Explicit saves are
    // still allowed - those are the user answering "keep mine" themselves.
    if (this.canAutosave()) {
      this.scheduleAutosave();
    }
  }

  private canAutosave(): boolean {
    return (
      !this.disposed &&
      !this.suspended &&
      this.backend.available &&
      this.current.saveMode === "automatic" &&
      this.current.dirty &&
      this.current.conflict === null &&
      (this.current.filePath !== null ||
        (this.backend.autosavePath !== undefined &&
          this.editor.store
            .listElements()
            .some(
              (element) =>
                getElementTypeDefinition(element.type)?.category !== "resource",
            )))
    );
  }

  private saveAutomatically(): Promise<boolean> {
    this.cancelAutosave();
    if (this.automaticSave?.generation === this.documentGeneration) {
      return this.automaticSave.promise;
    }
    const pending = {
      generation: this.documentGeneration,
      promise: this.performAutomaticSave(),
    };
    this.automaticSave = pending;
    void pending.promise.finally(() => {
      if (this.automaticSave === pending) this.automaticSave = null;
    });
    return pending.promise;
  }

  private async performAutomaticSave(): Promise<boolean> {
    if (!this.canAutosave()) return false;
    const generation = this.documentGeneration;
    let path = this.current.filePath;
    const firstSave = path === null;
    try {
      if (path === null) path = (await this.backend.autosavePath?.()) ?? null;
    } catch (error) {
      if (generation === this.documentGeneration)
        this.fail(`could not create autosave file: ${describe(error)}`);
      return false;
    }
    if (!path || generation !== this.documentGeneration || !this.canAutosave())
      return false;
    // An explicit Save As may have chosen a path while allocation was pending.
    path = this.current.filePath ?? path;
    const written = await this.write(path, true);
    const stale = () =>
      generation !== this.documentGeneration || this.current.filePath !== path;
    if (written && firstSave && !stale()) {
      await this.rememberRecent(path, stale);
      if (!stale()) await this.startWatching(path);
    }
    return written;
  }

  private scheduleAutosave(): void {
    this.cancelAutosave();
    this.autosaveHandle = this.scheduleTimer(() => {
      this.autosaveHandle = null;
      void this.saveAutomatically();
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
   *
   * The generation is captured here, at queue time, and checked again when
   * the write runs: the target path is fixed now but the document is only
   * serialized later, so without it a write queued for one document would
   * write whatever document the session held by the time its turn came.
   */
  private write(path: string, automatic = false): Promise<boolean> {
    const generation = this.documentGeneration;
    // Which banner, if any, this write is an answer to.
    const answering = this.current.conflict;
    const queued = this.writes.then(
      () => this.performWrite(path, generation, answering, automatic),
      () => this.performWrite(path, generation, answering, automatic),
    );
    this.writes = queued;
    return queued;
  }

  private async performWrite(
    requestedPath: string,
    generation: number,
    answering: SessionConflict | null,
    automatic: boolean,
  ): Promise<boolean> {
    if (automatic && !this.canAutosave()) return false;
    if (generation !== this.documentGeneration) {
      // The session opened another document while this write waited its
      // turn. Writing now would put the new document into the old
      // document's file.
      return false;
    }

    // An explicit Save As may have completed while this automatic write
    // waited in the queue. Keep following the chosen destination.
    const path = automatic
      ? (this.current.filePath ?? requestedPath)
      : requestedPath;
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

    if (generation !== this.documentGeneration) {
      // The bytes were correct for the file they landed in, but the session
      // has moved on: adopting this path would name the file the user left
      // while the canvas shows the one they opened, and `lastSavedText`
      // would then describe the wrong file.
      return false;
    }

    this.lastSavedText = text;
    const dirty = serializeDocument(this.editor.getSnapshot()) !== text;
    this.patch({
      filePath: path,
      fileName: baseName(path),
      dirty,
      // Saving with a banner up is the user choosing "keep mine", and disk
      // now holds their document, so that banner is answered. A banner
      // raised *during* this write is a different question about a change
      // these bytes just overwrote - it stays up, because reloading it is
      // the only way back to what the other writer had.
      ...(this.current.conflict === answering ? { conflict: null } : {}),
      status: "idle",
      error: null,
    });
    if (dirty) this.markDirty();
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
    if (
      this.disposed ||
      path !== this.current.filePath ||
      diskText === this.lastSavedText
    ) {
      return;
    }
    if (this.applyOutsideChange(diskText)) {
      return;
    }
    // An autosave armed before the event arrived would otherwise land after
    // the banner is up, overwriting the change the user is being asked
    // about. `resolveConflict` re-arms it once the question is answered.
    this.cancelAutosave();
    this.patch({ conflict: { diskText } });
  }

  /**
   * Show another writer's change (nodetto-cli, a script, another editor) live.
   *
   * With no unsaved local edits the disk version is applied as an in-place
   * diff, so camera, page and surviving selection stay put. With unsaved
   * edits it is merged three ways against the last saved text; disjoint
   * changes need no question and are autosaved, so the other writer sees the
   * person's edits on its next read. Returns false when the change cannot be
   * merged automatically and the banner has to ask.
   */
  private applyOutsideChange(diskText: string): boolean {
    const remote = parseDocumentResult(diskText);
    // Ask instead when: the file is unreadable, a question is already open,
    // our own write is in flight (it would overwrite what we merge), or the
    // file now holds a different document altogether.
    if (
      !remote.ok ||
      this.current.conflict !== null ||
      this.current.status === "saving"
    ) {
      return false;
    }
    const local = this.editor.getSnapshot();
    if (remote.document.id !== local.id) {
      return false;
    }
    let target = remote.document;
    let conflicts: readonly string[] = [];
    if (this.current.dirty) {
      const base =
        this.lastSavedText === null
          ? null
          : parseDocumentResult(this.lastSavedText);
      if (base === null || !base.ok || base.document.id !== local.id) {
        return false;
      }
      const merged = mergeDocuments(base.document, local, remote.document);
      target = merged.document;
      conflicts = merged.conflicts.map((conflict) => conflict.id);
    }
    const commit = diffDocuments(local, target);
    const outsideChange = {
      added: (commit?.insert?.length ?? 0) + (commit?.insertPages?.length ?? 0),
      updated:
        (commit?.update?.length ?? 0) + (commit?.updatePages?.length ?? 0),
      removed:
        (commit?.remove?.length ?? 0) + (commit?.removePages?.length ?? 0),
      merged: this.current.dirty,
    };
    this.loading = true;
    try {
      if (commit === null) {
        this.editor.loadDocument(target, { preserveView: true });
      } else if (!isEmptyCommit(commit)) {
        this.editor.store.commit(commit);
        this.editor.reconcileDerivedState();
      }
    } finally {
      this.loading = false;
    }
    this.lastSavedText = diskText;
    this.patch({ outsideChange });
    if (conflicts.length > 0) {
      this.cancelAutosave();
      this.patch({ conflict: { diskText, mergedConflicts: conflicts } });
    } else if (this.current.dirty) {
      // The merged document still holds local edits the file lacks.
      this.markDirty();
    }
    return true;
  }

  private async startWatching(path: string): Promise<void> {
    try {
      await this.changeMonitor.watch(this.changes, path, (change) => {
        void this.handleFileChanged(change.documentId);
      });
    } catch {
      // Losing the watch costs the reload prompt, not the document.
    }
  }

  private async stopWatching(): Promise<void> {
    try {
      await this.changeMonitor.close();
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

  private async rememberRecent(
    path: string,
    stale: () => boolean = () => false,
  ): Promise<void> {
    try {
      const recent = await this.backend.addRecent(path);
      if (!stale()) {
        this.patch({ recent });
      }
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

  /** Report and refuse a file open while another mode owns the editor. */
  private refuseWhileSuspended(): boolean {
    if (!this.suspended) {
      return false;
    }
    this.fail(
      "close the cloud document before opening a file; opening it now would replace the shared document",
    );
    return true;
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
