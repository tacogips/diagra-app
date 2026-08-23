// The editor facade: one object a renderer can hold.
//
// It owns the store, camera, selection and history, and it is the only
// entry point for mutation. Everything it exposes either reads state or
// funnels through `apply`, so there is no path by which a view can edit the
// document without validation and undo.

import {
  type Document,
  type Element,
  type ElementId,
  type FractionalIndex,
  type PageId,
  SCHEMA_VERSION,
  type Visual,
} from "@diagra/ir";
import { Camera, type CameraState } from "./camera.ts";
import { applyCommands, type Command, type CommandResult } from "./commands.ts";
import { compareFractional, keyAfter, type Rng } from "./fractional.ts";
import type { Box, Vec } from "./geometry.ts";
import { History } from "./history.ts";
import { createShapeContext, hitTestPoint } from "./hit-test.ts";
import { type IdSource, newElementId } from "./ids.ts";
import { getSelectionBounds, Selection } from "./selection.ts";
import type {
  ShapeContext,
  ShapeUtil,
  ShapeUtilRegistry,
} from "./shape-util.ts";
import { createDefaultRegistry } from "./shapes/index.ts";
import { Store, type StoreDiff } from "./store.ts";

export interface EditorOptions {
  /** Document to open. A single empty freeform page is created otherwise. */
  readonly document?: Document;
  readonly registry?: ShapeUtilRegistry;
  readonly idSource?: IdSource;
  readonly rng?: Rng;
  readonly camera?: CameraState;
}

export interface ApplyOptions {
  /** `"ignore"` skips the history entry, e.g. when seeding a document. */
  readonly history?: "record" | "ignore";
}

export interface CreateElementOptions {
  readonly page?: PageId;
  readonly id?: ElementId;
  readonly index?: FractionalIndex;
  readonly visual?: Partial<Visual>;
  readonly semantic?: unknown;
}

export type EditorListener = (diff: StoreDiff) => void;

/**
 * Announced when the visible page changes. No element changed, but which
 * elements a renderer should be drawing did.
 */
const PAGE_SWITCH_DIFF: StoreDiff = {
  added: [],
  updated: [],
  removed: [],
  pagesChanged: true,
};

/**
 * Announced when undo/redo availability changes on its own — closing a batch
 * adds a history entry without touching an element, so a toolbar watching
 * only the store would show the previous edit's state.
 */
const HISTORY_DIFF: StoreDiff = {
  added: [],
  updated: [],
  removed: [],
  pagesChanged: false,
};

function emptyDocument(id: string, pageId: string): Document {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: "Untitled",
    pages: [{ id: pageId, name: "Page 1", kind: "freeform" }],
    elements: [],
  };
}

export class Editor {
  readonly store: Store;
  readonly camera: Camera;
  readonly selection = new Selection();
  readonly registry: ShapeUtilRegistry;
  readonly history: History;

  private readonly idSource: IdSource;
  private readonly rng: Rng;
  private readonly listeners = new Set<EditorListener>();
  /** Highest index handed out per page, so a batch of builds stays ordered. */
  private readonly pendingTop = new Map<PageId, FractionalIndex>();
  private pageId: PageId;
  private revisionCount = 0;
  /** Set while a reset is mid-flight and the editor is not yet consistent. */
  private silenceHistory = false;

  constructor(options: EditorOptions = {}) {
    this.idSource = options.idSource ?? (() => newElementId());
    this.rng = options.rng ?? Math.random;
    this.registry = options.registry ?? createDefaultRegistry();
    const document =
      options.document ?? emptyDocument(this.idSource(), this.idSource());
    this.store = new Store(document);
    this.camera = new Camera(options.camera);
    this.history = new History((commands) => {
      applyCommands(this.store, commands);
    });
    this.pageId = document.pages[0]?.id ?? "";
    this.store.subscribe((diff) => {
      this.selection.prune(diff);
      this.notify(diff);
    });
    this.history.subscribe(() => {
      if (!this.silenceHistory) {
        this.notify(HISTORY_DIFF);
      }
    });
  }

  /** Bumped on every store change; renderers use it as a signal source. */
  get revision(): number {
    return this.revisionCount;
  }

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get currentPageId(): PageId {
    return this.pageId;
  }

  /**
   * Switch the visible page. Unknown ids are ignored. The change is
   * announced like a store change, because a renderer that only listens for
   * document edits would otherwise keep drawing the previous page.
   */
  setCurrentPage(pageId: PageId): void {
    if (pageId === this.pageId || !this.store.getPage(pageId)) {
      return;
    }
    this.pageId = pageId;
    this.selection.clear();
    this.notify(PAGE_SWITCH_DIFF);
  }

  /**
   * Replace the open document.
   *
   * A load is announced exactly once, by the store, and every other piece of
   * editor state is already describing the new document by the time that
   * happens. Dropping the undo stack is the one reset that would otherwise
   * announce itself — on its own, while the page and the store still belong
   * to the outgoing document — so its notification is held back and the
   * store's diff speaks for the whole load.
   */
  loadDocument(document: Document): void {
    this.silenceHistory = true;
    try {
      this.history.clear();
    } finally {
      this.silenceHistory = false;
    }
    this.selection.clear();
    this.pendingTop.clear();
    this.pageId = document.pages[0]?.id ?? "";
    this.store.loadDocument(document);
  }

  getSnapshot(): Document {
    return this.store.getSnapshot();
  }

  apply(
    commands: readonly Command[],
    options: ApplyOptions = {},
  ): CommandResult {
    const result = applyCommands(this.store, commands);
    if (options.history !== "ignore") {
      this.history.push(result);
    }
    return result;
  }

  undo(): boolean {
    return this.history.undo();
  }

  redo(): boolean {
    return this.history.redo();
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  /** Coalesce every apply until `endBatch` into a single undo step. */
  beginBatch(): void {
    this.history.beginBatch();
  }

  endBatch(): void {
    this.history.endBatch();
  }

  /**
   * Close the batch by undoing it. A gesture the user abandoned should leave
   * the document exactly as it found it, and cost no undo step.
   */
  abortBatch(): void {
    this.history.abortBatch();
  }

  getShapeUtil(type: string): ShapeUtil {
    return this.registry.getOrFallback(type);
  }

  createShapeContext(zoom: number = this.camera.get().z): ShapeContext {
    return createShapeContext(this.store, this.registry, zoom);
  }

  getBounds(id: ElementId, context = this.createShapeContext()): Box | null {
    return context.boundsOf(id);
  }

  getSelectionBounds(context = this.createShapeContext()): Box | null {
    return getSelectionBounds(
      this.selection,
      this.store,
      this.registry,
      context,
    );
  }

  hitTest(point: Vec, context = this.createShapeContext()): ElementId | null {
    return hitTestPoint(this.store, this.registry, this.pageId, point, {
      context,
    });
  }

  /** The next z-order key above everything currently on `page`. */
  nextIndex(page: PageId = this.pageId): FractionalIndex {
    let top: FractionalIndex | null = this.pendingTop.get(page) ?? null;
    for (const element of this.store.getPageElements(page)) {
      if (top === null || compareFractional(element.index, top) > 0) {
        top = element.index;
      }
    }
    const next = keyAfter(top, this.rng);
    this.pendingTop.set(page, next);
    return next;
  }

  /**
   * Build an element without applying it, so several can be created in one
   * atomic batch. Missing semantic/visual fall back to the ShapeUtil's
   * defaults; supplied fields win.
   */
  buildElement(type: string, options: CreateElementOptions = {}): Element {
    const util = this.registry.getOrFallback(type);
    const page = options.page ?? this.pageId;
    const defaultVisual = util.defaultVisual();
    const visual: Visual = { ...defaultVisual, ...(options.visual ?? {}) };
    const semantic =
      options.semantic === undefined
        ? util.defaultSemantic()
        : options.semantic;
    return {
      id: options.id ?? this.idSource(),
      page,
      type,
      index: options.index ?? this.nextIndex(page),
      semantic,
      visual,
    };
  }

  /** Build, apply and select nothing; returns the new element's id. */
  createElement(
    type: string,
    options: CreateElementOptions = {},
    applyOptions: ApplyOptions = {},
  ): ElementId {
    const element = this.buildElement(type, options);
    this.apply([{ type: "createElement", element }], applyOptions);
    return element.id;
  }

  /**
   * Connect two elements with an `edge.generic`. Returns `null` rather than
   * throwing for the cases a drag gesture routinely produces: a self
   * connection, or an endpoint that is no longer there.
   */
  connect(
    from: ElementId,
    to: ElementId,
    page: PageId = this.pageId,
    applyOptions: ApplyOptions = {},
  ): ElementId | null {
    if (from === to || !this.store.has(from) || !this.store.has(to)) {
      return null;
    }
    return this.createElement(
      "edge.generic",
      { page, semantic: { from, to, arrowheads: { end: "arrow" } } },
      applyOptions,
    );
  }

  /** Move elements by a page-space delta, relative to given origins. */
  moveElements(
    moves: readonly {
      readonly id: ElementId;
      readonly x: number;
      readonly y: number;
    }[],
    applyOptions: ApplyOptions = {},
  ): void {
    const commands: Command[] = moves
      .filter((move) => this.store.has(move.id))
      .map((move) => ({
        type: "updateVisual" as const,
        id: move.id,
        visual: { x: move.x, y: move.y },
      }));
    if (commands.length > 0) {
      this.apply(commands, applyOptions);
    }
  }

  /** Resize through the element's ShapeUtil; a no-op for fixed shapes. */
  resizeElement(
    id: ElementId,
    box: Box,
    applyOptions: ApplyOptions = {},
  ): void {
    const element = this.store.get(id);
    if (!element) {
      return;
    }
    const util = this.registry.getOrFallback(element.type);
    if (!util.canResize || !util.resize) {
      return;
    }
    const patch = util.resize(element, box);
    this.apply(
      [{ type: "updateVisual", id, visual: patch.visual }],
      applyOptions,
    );
  }

  deleteElements(
    ids: readonly ElementId[],
    applyOptions: ApplyOptions = {},
  ): void {
    const present = ids.filter((id) => this.store.has(id));
    if (present.length === 0) {
      return;
    }
    this.apply([{ type: "deleteElements", ids: present }], applyOptions);
  }

  deleteSelection(applyOptions: ApplyOptions = {}): void {
    this.deleteElements([...this.selection.ids()], applyOptions);
  }

  private notify(diff: StoreDiff): void {
    this.revisionCount += 1;
    for (const listener of [...this.listeners]) {
      listener(diff);
    }
  }
}
