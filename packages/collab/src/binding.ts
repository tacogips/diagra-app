// The Editor <-> Y.Doc adapter (design 4).
//
// The editor core stays the source of truth: it validates, it owns selection
// and camera, and it never learns that a second writer exists. Yjs attaches
// as an adapter on either side of it —
//
//   store diff  -> one Y transaction tagged with `localOrigin` (design 4.1)
//   Y events    -> one `store.commit` under `applyingRemote` (design 4.3)
//
// Two guards keep that from looping: local writes carry `localOrigin` and are
// skipped by the observers, and the commit a remote event produces is applied
// with `applyingRemote` set so the store listener ignores its own echo.
//
// The binding is provider-agnostic. It binds an `Editor` to a `Y.Doc` and
// does not know how updates travel, so the same class is exercised by two
// in-memory docs in `binding.test.ts` and by two websockets against a real
// Durable Object in the cloud repo's `collab-binding.test.ts`.

import type { Editor, StoreCommit, StoreDiff } from "@diagra/core";
import type { Element, ElementId } from "@diagra/ir";
import * as Y from "yjs";
import { syncElementToY } from "./diff.ts";
import {
  applyIrToDoc,
  ELEMENTS_KEY,
  elementFromY,
  elementToY,
  META_KEY,
  PAGES_KEY,
  ydocToIr,
} from "./ydoc.ts";

export interface CollabBindingOptions {
  readonly editor: Editor;
  readonly doc: Y.Doc;
  /** Origin tag for local transactions; defaults to the binding itself. */
  readonly origin?: unknown;
  /** `Y.UndoManager` capture window. Tests set 0 to keep steps separate. */
  readonly captureTimeout?: number;
}

type YMapEvents = readonly Y.YEvent<Y.AbstractType<unknown>>[];

export class CollabBinding {
  private readonly editor: Editor;
  private readonly doc: Y.Doc;
  private readonly localOrigin: unknown;
  private readonly captureTimeout: number | undefined;

  private readonly meta: Y.Map<unknown>;
  private readonly pages: Y.Map<unknown>;
  private readonly elements: Y.Map<unknown>;

  /** The elements as this binding last synchronized them, either direction. */
  private readonly shadow = new Map<ElementId, Element>();
  private readonly undoListeners = new Set<() => void>();

  private unsubscribeStore: (() => void) | null = null;
  private undoManager: Y.UndoManager | null = null;
  private applyingRemote = false;
  private attached = false;

  private readonly onElements = (
    events: YMapEvents,
    transaction: Y.Transaction,
  ): void => {
    this.applyRemoteElements(events, transaction);
  };
  private readonly onDocument = (
    _events: YMapEvents,
    transaction: Y.Transaction,
  ): void => {
    this.applyRemoteDocument(transaction);
  };
  private readonly onUndoStack = (): void => {
    for (const listener of [...this.undoListeners]) {
      listener();
    }
  };

  constructor(options: CollabBindingOptions) {
    this.editor = options.editor;
    this.doc = options.doc;
    this.localOrigin = options.origin ?? this;
    this.captureTimeout = options.captureTimeout;
    this.meta = this.doc.getMap<unknown>(META_KEY);
    this.pages = this.doc.getMap<unknown>(PAGES_KEY);
    this.elements = this.doc.getMap<unknown>(ELEMENTS_KEY);
  }

  /** The origin every local transaction carries. Never applied to remotes. */
  get origin(): unknown {
    return this.localOrigin;
  }

  /**
   * Adopt the room's document and start syncing both ways (design 4.4).
   *
   * Call it once the provider reports `synced`: attaching to a doc that has
   * not received the room state yet looks exactly like an empty room, and the
   * seed below would then publish a local document over a real one.
   */
  attach(): void {
    if (this.attached) {
      return;
    }

    if (this.meta.get("schemaVersion") === undefined) {
      // Defensive: the supported path seeds through REST import at create
      // time, so an empty room here means nobody ever wrote one.
      applyIrToDoc(this.doc, this.editor.getSnapshot(), this.localOrigin);
    } else {
      this.editor.loadDocument(ydocToIr(this.doc));
    }

    this.resetShadow();
    this.attached = true;
    this.unsubscribeStore = this.editor.store.subscribe((diff) => {
      this.applyLocalDiff(diff);
    });
    this.elements.observeDeep(this.onElements);
    this.meta.observeDeep(this.onDocument);
    this.pages.observeDeep(this.onDocument);

    this.undoManager = new Y.UndoManager(
      [this.meta, this.pages, this.elements],
      {
        // Undo may only ever revert this client's own work (design 7.1). A
        // remote transaction carries the provider as its origin and is not
        // tracked, so it can never end up on this stack.
        trackedOrigins: new Set([this.localOrigin]),
        ...(this.captureTimeout === undefined
          ? {}
          : { captureTimeout: this.captureTimeout }),
      },
    );
    this.undoManager.on("stack-item-added", this.onUndoStack);
    this.undoManager.on("stack-item-popped", this.onUndoStack);
    this.undoManager.on("stack-cleared", this.onUndoStack);
  }

  /** Stop syncing. Safe to call twice, and never touches the socket. */
  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.elements.unobserveDeep(this.onElements);
    this.meta.unobserveDeep(this.onDocument);
    this.pages.unobserveDeep(this.onDocument);
    if (this.undoManager) {
      this.undoManager.off("stack-item-added", this.onUndoStack);
      this.undoManager.off("stack-item-popped", this.onUndoStack);
      this.undoManager.off("stack-cleared", this.onUndoStack);
      this.undoManager.destroy();
      this.undoManager = null;
    }
    this.shadow.clear();
  }

  undo(): boolean {
    return this.undoManager?.undo() != null;
  }

  redo(): boolean {
    return this.undoManager?.redo() != null;
  }

  canUndo(): boolean {
    return this.undoManager?.canUndo() ?? false;
  }

  canRedo(): boolean {
    return this.undoManager?.canRedo() ?? false;
  }

  /** Fires whenever `canUndo`/`canRedo` may have changed, for a toolbar. */
  onUndoState(listener: () => void): () => void {
    this.undoListeners.add(listener);
    return () => {
      this.undoListeners.delete(listener);
    };
  }

  private resetShadow(): void {
    this.shadow.clear();
    for (const element of this.editor.store.listElements()) {
      this.shadow.set(element.id, element);
    }
  }

  /** Local edits -> one transaction (design 4.1). */
  private applyLocalDiff(diff: StoreDiff): void {
    if (this.applyingRemote || !this.attached) {
      return;
    }
    if (
      diff.added.length === 0 &&
      diff.updated.length === 0 &&
      diff.removed.length === 0
    ) {
      // A page switch or a history-only notification. Nothing to publish.
      return;
    }

    Y.transact(
      this.doc,
      () => {
        for (const id of diff.added) {
          const element = this.editor.store.get(id);
          if (element) {
            this.elements.set(id, elementToY(element));
            this.shadow.set(id, element);
          }
        }
        for (const id of diff.updated) {
          const element = this.editor.store.get(id);
          if (!element) {
            continue;
          }
          const existing = this.elements.get(id);
          if (existing instanceof Y.Map) {
            // The shadow is what this client believes the Y side holds. If it
            // is missing, read the Y side instead of assuming: a wrong
            // `previous` would write fields nobody changed.
            const previous = this.shadow.get(id) ?? elementFromY(id, existing);
            syncElementToY(previous, element, existing as Y.Map<unknown>);
          } else {
            // A remote delete raced this edit. Add wins: the user keeps the
            // element they were working on (design 4.1, 10).
            this.elements.set(id, elementToY(element));
          }
          this.shadow.set(id, element);
        }
        for (const id of diff.removed) {
          this.elements.delete(id);
          this.shadow.delete(id);
        }
      },
      this.localOrigin,
    );
  }

  /** Remote element edits -> one commit (design 4.3). */
  private applyRemoteElements(
    events: YMapEvents,
    transaction: Y.Transaction,
  ): void {
    if (transaction.origin === this.localOrigin || !this.attached) {
      return;
    }

    const touched = new Set<ElementId>();
    for (const event of events) {
      const [head] = event.path;
      if (head === undefined) {
        // The `elements` map itself: added or removed element ids.
        for (const id of event.changes.keys.keys()) {
          touched.add(id);
        }
      } else if (typeof head === "string") {
        // Anything deeper belongs to exactly one element.
        touched.add(head);
      }
    }
    if (touched.size === 0) {
      return;
    }

    const insert: Element[] = [];
    const update: Element[] = [];
    const remove: ElementId[] = [];
    for (const id of touched) {
      const value = this.elements.get(id);
      if (value === undefined) {
        this.shadow.delete(id);
        if (this.editor.store.has(id)) {
          remove.push(id);
        }
        continue;
      }
      const element = elementFromY(id, value);
      this.shadow.set(id, element);
      if (this.editor.store.has(id)) {
        update.push(element);
      } else {
        insert.push(element);
      }
    }

    const commit: StoreCommit = { insert, update, remove };
    this.applyingRemote = true;
    try {
      // Deliberately not through the command layer: a remote edit was already
      // validated by its author, and running it through `editor.apply` would
      // push it onto this user's undo stack (design 4.3).
      this.editor.store.commit(commit);
    } finally {
      this.applyingRemote = false;
    }
  }

  /** Remote document-level edits -> reload (design 4.3, coarse but atomic). */
  private applyRemoteDocument(transaction: Y.Transaction): void {
    if (transaction.origin === this.localOrigin || !this.attached) {
      return;
    }
    this.applyingRemote = true;
    try {
      this.editor.loadDocument(ydocToIr(this.doc));
    } finally {
      this.applyingRemote = false;
    }
    this.resetShadow();
  }
}
