// Undo/redo as inverse command lists.
//
// Every recorded apply contributes an entry holding the commands that undo
// it and the commands that replay it. Both directions run back through the
// normal command pipeline with recording switched off, so undo is validated
// exactly like any other edit.
//
// Gestures (a drag emits one apply per pointer move) are coalesced with
// `beginBatch`/`endBatch`: everything in between collapses to one entry, so
// a drag undoes in one step rather than pixel by pixel.

import type { Command } from "./commands.ts";

export interface HistoryEntry {
  readonly undo: readonly Command[];
  readonly redo: readonly Command[];
}

/** Runs commands without recording them. Supplied by the editor. */
export type HistoryRunner = (commands: readonly Command[]) => void;

/**
 * Notified whenever the undo or redo stack changes depth.
 *
 * Stack depth does not move in step with the document: closing a batch adds
 * an entry without touching a single element, and the last edit of a drag
 * lands while the batch is still open. Anything showing `canUndo` — a
 * toolbar button, a menu item — has to listen here rather than to the store,
 * or it renders one edit behind.
 */
export type HistoryListener = () => void;

/** Entries kept per direction before the oldest is dropped. */
export const HISTORY_LIMIT = 1024;

export class History {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<HistoryListener>();
  private batchDepth = 0;
  private pending: HistoryEntry | null = null;

  constructor(
    private readonly run: HistoryRunner,
    private readonly limit: number = HISTORY_LIMIT,
  ) {}

  /** Subscribe to changes in undo/redo availability. */
  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoSize(): number {
    return this.undoStack.length;
  }

  get redoSize(): number {
    return this.redoStack.length;
  }

  get batching(): boolean {
    return this.batchDepth > 0;
  }

  /**
   * Record one applied batch.
   *
   * An empty inverse means the batch changed nothing — `applyCommands` emits
   * an undo command for every mutation it makes — so the entry is dropped
   * rather than stacked. Keeping it would cost the user a press of Ctrl+Z
   * that visibly does nothing (deleting an id that is already gone is the
   * usual way to produce one).
   */
  push(entry: HistoryEntry): void {
    if (entry.undo.length === 0) {
      return;
    }
    if (this.batchDepth > 0) {
      this.pending = this.pending
        ? {
            // Undo runs newest first; replay runs oldest first.
            undo: [...entry.undo, ...this.pending.undo],
            redo: [...this.pending.redo, ...entry.redo],
          }
        : entry;
      return;
    }
    this.commit(entry);
  }

  beginBatch(): void {
    this.batchDepth += 1;
  }

  /** Close the innermost batch; the outermost close records one entry. */
  endBatch(): void {
    if (this.batchDepth === 0) {
      return;
    }
    this.batchDepth -= 1;
    if (this.batchDepth > 0) {
      return;
    }
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      this.commit(pending);
    }
  }

  /**
   * Close the innermost batch by reverting it instead of recording it.
   *
   * Like {@link endBatch}, only the outermost close decides — an inner abort
   * just closes its level and leaves the decision to the batch around it.
   * The revert runs through the same runner as an undo, so a cancelled
   * gesture costs no undo step and leaves nothing to redo.
   */
  abortBatch(): void {
    if (this.batchDepth === 0) {
      return;
    }
    this.batchDepth -= 1;
    if (this.batchDepth > 0) {
      return;
    }
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      this.run(pending.undo);
    }
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) {
      return false;
    }
    this.run(entry.undo);
    this.redoStack.push(entry);
    this.emit();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) {
      return false;
    }
    this.run(entry.redo);
    this.undoStack.push(entry);
    this.emit();
    return true;
  }

  clear(): void {
    const wasEmpty = this.undoStack.length === 0 && this.redoStack.length === 0;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
    this.batchDepth = 0;
    if (!wasEmpty) {
      this.emit();
    }
  }

  private commit(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    // A new edit invalidates the redo branch.
    this.redoStack.length = 0;
    while (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
