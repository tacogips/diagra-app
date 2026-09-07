// The Editor <-> Y.Doc adapter (design 4).
//
// The editor core stays the source of truth: it validates, it owns selection
// and camera, and it never learns that a second writer exists. Yjs attaches
// as an adapter on either side of it —
//
//   store diff  -> one Y transaction tagged with `localOrigin` (design 4.1)
//   Y events    -> one `store.commit` under `applyingRemote` (design 4.3)
//
// Page commands (editor-ux 8, 11) ride the same local transaction: a diff
// with `pagesChanged` reconciles the store's page list against the `pages`
// map next to its element writes, so a peer sees "page deleted with its
// elements" as one atomic step and the UndoManager reverts it as one too.
// Remote page changes still take the coarse reload path of design 4.3.
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
import type { Element, ElementId, Page, PageId } from "@diagra/ir";
import * as Y from "yjs";
import { syncElementToY, syncPageToY } from "./diff.ts";
import { captureColors, type ColorUndo } from "./color-undo.ts";
import {
  applyIrToDoc,
  ELEMENTS_KEY,
  elementFromY,
  elementToY,
  META_KEY,
  PAGES_KEY,
  pageFromY,
  pageToY,
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
  /**
   * The pages likewise. Store pages are immutable values, so an entry that is
   * still the same object as the store's is known unchanged without a diff.
   */
  private readonly pageShadow = new Map<PageId, Page>();
  private readonly undoListeners = new Set<() => void>();

  private unsubscribeStore: (() => void) | null = null;
  private undoManager: Y.UndoManager | null = null;
  private applyingRemote = false;
  private reconcilingDerived = false;
  private readonly derivedOrigin = Symbol("derived-state");
  private readonly colorUndo = new WeakMap<object, Map<string, ColorUndo>>();
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
    this.reconcileDerivedState();
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
    this.pageShadow.clear();
  }

  undo(): boolean {
    const item = this.undoManager?.undoStack.at(-1);
    const records = item ? this.colorUndo.get(item) : undefined;
    const before = new Map(
      this.editor.store.listElements().map((element) => [element.id, element]),
    );
    if (this.undoManager?.undo() == null) return false;
    const redo = this.undoManager.redoStack.at(-1);
    if (records && redo) this.colorUndo.set(redo, records);
    const updates = new Map<string, Element>();
    for (const record of records?.values() ?? []) {
      const previous = before.get(record.id);
      const current =
        updates.get(record.id) ?? this.editor.store.get(record.id);
      const token = record.afterToken
        ? before.get(record.afterToken)
        : undefined;
      const value = (token?.semantic as { value?: unknown } | undefined)?.value;
      if (
        !current ||
        !previous ||
        record.beforeToken !== undefined ||
        !record.afterToken ||
        previous.visual.colorTokens?.[record.field] !== record.afterToken ||
        current.visual.colorTokens?.[record.field] !== undefined ||
        token?.type !== "design.token" ||
        previous.visual.style?.[record.field] !== value ||
        current.visual.style?.[record.field] !== value ||
        current.visual.style?.[record.field] === record.beforeValue
      )
        continue;
      const style = { ...current.visual.style };
      if (record.beforeValue === undefined) delete style[record.field];
      else style[record.field] = record.beforeValue;
      updates.set(current.id, {
        ...current,
        visual: { ...current.visual, style },
      });
    }
    this.reconcilingDerived = true;
    try {
      if (updates.size)
        this.editor.store.commit({ update: [...updates.values()] });
    } finally {
      this.reconcilingDerived = false;
    }
    return true;
  }

  redo(): boolean {
    const item = this.undoManager?.redoStack.at(-1);
    const records = item ? this.colorUndo.get(item) : undefined;
    if (this.undoManager?.redo() == null) return false;
    const undo = this.undoManager.undoStack.at(-1);
    if (records && undo) this.colorUndo.set(undo, records);
    return true;
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
    this.pageShadow.clear();
    for (const page of this.editor.store.listPages()) {
      this.pageShadow.set(page.id, page);
    }
  }

  /** Local edits -> one transaction (design 4.1). */
  private applyLocalDiff(diff: StoreDiff): void {
    if (this.applyingRemote || !this.attached) {
      return;
    }
    if (
      !diff.pagesChanged &&
      diff.added.length === 0 &&
      diff.updated.length === 0 &&
      diff.removed.length === 0
    ) {
      // A page switch or a history-only notification. Nothing to publish.
      return;
    }

    const colorChanges: [Element, Element][] = [];
    if (!this.reconcilingDerived)
      for (const id of diff.updated) {
        const before = this.shadow.get(id);
        const after = this.editor.store.get(id);
        if (before && after) colorChanges.push([before, after]);
      }
    Y.transact(
      this.doc,
      () => {
        if (diff.pagesChanged) {
          // Pages first: a peer integrates a transaction's structs in write
          // order, so a new page lands before the first element placed on it.
          this.syncPages();
        }
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
      this.reconcilingDerived ? this.derivedOrigin : this.localOrigin,
    );
    const item = this.undoManager?.undoStack.at(-1);
    if (item && colorChanges.length) {
      const records = this.colorUndo.get(item) ?? new Map<string, ColorUndo>();
      for (const [before, after] of colorChanges)
        captureColors(records, before, after);
      this.colorUndo.set(item, records);
    }
  }

  /**
   * Reconcile the store's page list against the `pages` map, inside the
   * caller's transaction.
   *
   * `StoreDiff` only says that pages changed, not which, so every store page
   * is visited; the page shadow makes an untouched page a pointer compare.
   * A page the store holds but the map lacks is re-added whole (add-wins,
   * as for elements), and a map entry the store no longer has is deleted.
   */
  private syncPages(): void {
    const kept = new Set<PageId>();
    for (const page of this.editor.store.listPages()) {
      kept.add(page.id);
      const previous = this.pageShadow.get(page.id);
      const existing = this.pages.get(page.id);
      if (!(existing instanceof Y.Map)) {
        this.pages.set(page.id, pageToY(page));
      } else if (previous !== page) {
        syncPageToY(
          previous ?? pageFromY(page.id, existing),
          page,
          existing as Y.Map<unknown>,
        );
      }
      this.pageShadow.set(page.id, page);
    }
    for (const id of [...this.pages.keys()]) {
      if (!kept.has(id)) {
        this.pages.delete(id);
      }
    }
    for (const id of [...this.pageShadow.keys()]) {
      if (!kept.has(id)) {
        this.pageShadow.delete(id);
      }
    }
  }

  /** Remote element edits -> one commit (design 4.3). */
  private applyRemoteElements(
    events: YMapEvents,
    transaction: Y.Transaction,
  ): void {
    if (
      transaction.origin === this.localOrigin ||
      transaction.origin === this.derivedOrigin ||
      !this.attached
    ) {
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
    this.reconcileDerivedState();
  }

  /** Remote document-level edits -> reload (design 4.3, coarse but atomic). */
  private applyRemoteDocument(transaction: Y.Transaction): void {
    if (
      transaction.origin === this.localOrigin ||
      transaction.origin === this.derivedOrigin ||
      !this.attached
    ) {
      return;
    }
    this.applyingRemote = true;
    try {
      this.editor.loadDocument(ydocToIr(this.doc), { preserveView: true });
    } finally {
      this.applyingRemote = false;
    }
    this.resetShadow();
    this.reconcileDerivedState();
  }

  /** Repairs publish with an untracked origin, so merged geometry is not user history. */
  private reconcileDerivedState(): void {
    if (this.reconcilingDerived || !this.attached) return;
    this.reconcilingDerived = true;
    try {
      this.editor.reconcileDerivedState();
    } finally {
      this.reconcilingDerived = false;
    }
  }
}
