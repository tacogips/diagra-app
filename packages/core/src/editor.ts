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
  type Page,
  type PageId,
  type PageKind,
  SCHEMA_VERSION,
  type Visual,
  type VisualStyle,
} from "@diagra/ir";
import {
  type AlignMode,
  type DistributeAxis,
  planAlign,
  planDistribute,
  planMatchSize,
  type SizeDimension,
} from "./align.ts";
import {
  Camera,
  type CameraState,
  type FitOptions,
  nextZoomStep,
  type ViewportSize,
} from "./camera.ts";
import {
  Clipboard,
  type ClipboardPayload,
  copyElements,
  PASTE_OFFSET,
  planPaste,
} from "./clipboard.ts";
import { applyCommands, type Command, type CommandResult } from "./commands.ts";
import { compareFractional, keyAfter, type Rng } from "./fractional.ts";
import { type Box, unionBoxes, type Vec } from "./geometry.ts";
import {
  expandGroups,
  leafElements,
  memberIdsOf,
  planGroup,
  planUngroup,
  resolveSelectionTarget,
  topLevelIds,
} from "./group.ts";
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
import {
  renderPageSvg,
  renderSelectionSvg,
  type SvgExportOptions,
} from "./svg-export.ts";
import { planZOrder, type ZOrderAction } from "./z-order.ts";

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

/** The one text field a double-click edits on an element, by type. */
export type EditableField = "label" | "text" | "tableName" | "name";

/** A style change; `null` clears a field back to the stylesheet default. */
export type StylePatch = {
  readonly [K in keyof VisualStyle]?: VisualStyle[K] | null;
};

export interface CreatePageOptions {
  readonly id?: PageId;
  readonly name?: string;
  readonly kind?: PageKind;
}

const EDITABLE_FIELDS: Readonly<Record<string, EditableField>> = {
  "shape.geo": "label",
  "node.generic": "label",
  "text.note": "text",
  "erd.table": "tableName",
  "uml.class": "name",
  "edge.generic": "label",
  "erd.relation": "label",
  "uml.association": "label",
  "sequence.message": "label",
};

/** Types whose label is optional in the registry: empty text drops the key. */
const OPTIONAL_LABEL_TYPES: ReadonlySet<string> = new Set([
  "shape.geo",
  "edge.generic",
  "erd.relation",
  "uml.association",
  "sequence.message",
]);

/** Ids in `ids` that no group in `ids` claims as a member. */
function topLevelAmong(store: Store, ids: readonly ElementId[]): ElementId[] {
  const set = new Set(ids);
  const claimed = new Set<ElementId>();
  for (const id of set) {
    const element = store.get(id);
    if (element) {
      for (const member of memberIdsOf(element)) {
        claimed.add(member);
      }
    }
  }
  return ids.filter((id) => !claimed.has(id));
}

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
  /** In-editor clipboard; copy/cut fill it, paste reads it. */
  readonly clipboard = new Clipboard();

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
      // A deleted (or undone) page must never stay current: a renderer
      // asked for its elements would draw nothing and the next click would
      // create an element on a page the store does not have.
      if (diff.pagesChanged && !this.store.getPage(this.pageId)) {
        this.pageId = this.store.listPages()[0]?.id ?? "";
        this.selection.clear();
      }
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

  /** Delete the selection; a selected group takes its members with it. */
  deleteSelection(applyOptions: ApplyOptions = {}): void {
    this.deleteElements(
      expandGroups(this.store, this.selection.ids()),
      applyOptions,
    );
  }

  /**
   * Snapshot the selection into the clipboard. False when there was nothing
   * to take — an empty selection, or one holding only connectors whose
   * endpoints were not selected. A failed copy leaves an earlier payload
   * alone rather than emptying the clipboard.
   */
  copySelection(): boolean {
    if (this.selection.size === 0) {
      return false;
    }
    const payload = copyElements(
      this.store,
      expandGroups(this.store, this.selection.ids()),
    );
    if (payload.elements.length === 0) {
      return false;
    }
    this.clipboard.set(payload);
    return true;
  }

  /**
   * Copy, then delete. The delete is conditional on the copy: removing
   * elements the clipboard did not take would be a cut the user cannot paste
   * back.
   */
  cutSelection(applyOptions: ApplyOptions = {}): boolean {
    if (!this.copySelection()) {
      return false;
    }
    this.deleteSelection(applyOptions);
    return true;
  }

  canPaste(): boolean {
    return !this.clipboard.isEmpty;
  }

  /**
   * Paste the clipboard onto the current page, offset one step further out
   * for each paste of the same payload, and select what landed. One undo
   * step, whatever the fragment contains.
   */
  paste(applyOptions: ApplyOptions = {}): readonly ElementId[] {
    const payload = this.clipboard.get();
    if (payload === null || payload.elements.length === 0) {
      return [];
    }
    this.clipboard.pasteGeneration += 1;
    const step = PASTE_OFFSET * this.clipboard.pasteGeneration;
    return this.insertCopies(payload, { x: step, y: step }, applyOptions);
  }

  /**
   * Copy the selection next to itself without touching the clipboard, so a
   * duplicate does not cost the user whatever they had copied earlier.
   */
  duplicateSelection(applyOptions: ApplyOptions = {}): readonly ElementId[] {
    if (this.selection.size === 0) {
      return [];
    }
    const payload = copyElements(
      this.store,
      expandGroups(this.store, this.selection.ids()),
    );
    if (payload.elements.length === 0) {
      return [];
    }
    return this.insertCopies(
      payload,
      { x: PASTE_OFFSET, y: PASTE_OFFSET },
      applyOptions,
    );
  }

  /**
   * Move the selection through the page's z-order. False when the action
   * would change nothing, so a shortcut at the top of the stack costs no
   * undo step.
   */
  reorderSelection(
    action: ZOrderAction,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const commands = planZOrder(
      this.store,
      this.pageId,
      new Set(expandGroups(this.store, this.selection.ids())),
      action,
      this.rng,
    );
    if (commands.length === 0) {
      return false;
    }
    this.apply(commands, applyOptions);
    return true;
  }

  bringToFront(applyOptions: ApplyOptions = {}): boolean {
    return this.reorderSelection("front", applyOptions);
  }

  bringForward(applyOptions: ApplyOptions = {}): boolean {
    return this.reorderSelection("forward", applyOptions);
  }

  sendBackward(applyOptions: ApplyOptions = {}): boolean {
    return this.reorderSelection("backward", applyOptions);
  }

  sendToBack(applyOptions: ApplyOptions = {}): boolean {
    return this.reorderSelection("back", applyOptions);
  }

  /** The current page as a standalone SVG, or `null` when it is empty. */
  exportPageSvg(options: SvgExportOptions = {}): string | null {
    return renderPageSvg(this.store, this.registry, this.pageId, options);
  }

  /** The selection as a standalone SVG, or `null` when nothing is drawable. */
  exportSelectionSvg(options: SvgExportOptions = {}): string | null {
    return renderSelectionSvg(
      this.store,
      this.registry,
      this.pageId,
      this.selection.ids(),
      options,
    );
  }

  // ---------------------------------------------------------------- groups

  /** Which element a click on `hit` selects (design editor-ux 3.1). */
  resolveSelectionTarget(hit: ElementId): ElementId {
    return resolveSelectionTarget(this.store, hit, this.selection.ids());
  }

  /** Select every top-level element on the current page. */
  selectAll(): void {
    this.selection.set(topLevelIds(this.store, this.pageId));
  }

  /**
   * The positioned elements a drag of the selection moves, with their
   * current origins: the selection expanded through groups, minus anything
   * that has no coordinates of its own (connectors, derived layouts).
   */
  movableSelection(): readonly {
    readonly id: ElementId;
    readonly x: number;
    readonly y: number;
  }[] {
    const out: { id: ElementId; x: number; y: number }[] = [];
    for (const leaf of leafElements(this.store, this.selection.ids())) {
      const { x, y } = leaf.visual;
      if (x !== undefined && y !== undefined) {
        out.push({ id: leaf.id, x, y });
      }
    }
    return out;
  }

  /** Move the selection by a page-space delta. False when nothing moved. */
  nudgeSelection(
    dx: number,
    dy: number,
    applyOptions: ApplyOptions = {},
  ): boolean {
    if (dx === 0 && dy === 0) {
      return false;
    }
    const moves = this.movableSelection().map((origin) => ({
      id: origin.id,
      x: origin.x + dx,
      y: origin.y + dy,
    }));
    if (moves.length === 0) {
      return false;
    }
    this.moveElements(moves, applyOptions);
    return true;
  }

  /**
   * Wrap the selection in a group and select it. `null` when there is
   * nothing to group: fewer than two units, or units on different pages.
   */
  groupSelection(applyOptions: ApplyOptions = {}): ElementId | null {
    const plan = planGroup(
      this.store,
      this.selection.ids(),
      this.idSource(),
      this.rng,
    );
    if (!plan) {
      return null;
    }
    this.apply(plan.commands, applyOptions);
    this.selection.set([plan.id]);
    return plan.id;
  }

  /** Dissolve the selected groups and select what was inside them. */
  ungroupSelection(applyOptions: ApplyOptions = {}): boolean {
    const plan = planUngroup(this.store, this.selection.ids());
    if (plan.commands.length === 0) {
      return false;
    }
    this.apply(plan.commands, applyOptions);
    this.selection.set(plan.select);
    return true;
  }

  // --------------------------------------------------------------- arrange

  alignSelection(mode: AlignMode, applyOptions: ApplyOptions = {}): boolean {
    return this.applyPlan(
      planAlign(
        this.store,
        this.selection.ids(),
        mode,
        this.createShapeContext(),
      ),
      applyOptions,
    );
  }

  distributeSelection(
    axis: DistributeAxis,
    applyOptions: ApplyOptions = {},
  ): boolean {
    return this.applyPlan(
      planDistribute(
        this.store,
        this.selection.ids(),
        axis,
        this.createShapeContext(),
      ),
      applyOptions,
    );
  }

  matchSelectionSize(
    dimension: SizeDimension,
    applyOptions: ApplyOptions = {},
  ): boolean {
    return this.applyPlan(
      planMatchSize(
        this.store,
        this.registry,
        this.selection.ids(),
        dimension,
        this.createShapeContext(),
      ),
      applyOptions,
    );
  }

  // ----------------------------------------------------------- style, text

  /**
   * Merge a style patch into every element the selection reaches (through
   * groups). One undo step. False when nothing changed.
   */
  setSelectionStyle(
    patch: StylePatch,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const commands: Command[] = [];
    for (const leaf of leafElements(this.store, this.selection.ids())) {
      const previous: Record<string, unknown> = {
        ...(leaf.visual.style ?? {}),
      };
      const next: Record<string, unknown> = { ...previous };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
          delete next[key];
        } else if (value !== undefined) {
          next[key] = value;
        }
      }
      if (JSON.stringify(previous) === JSON.stringify(next)) {
        continue;
      }
      const { style: _dropped, ...rest } = leaf.visual;
      const visual: Visual =
        Object.keys(next).length === 0
          ? rest
          : { ...rest, style: next as VisualStyle };
      commands.push({ type: "replaceVisual", id: leaf.id, visual });
    }
    return this.applyPlan(commands, applyOptions);
  }

  /** The text field a double-click on `id` edits, or `null`. */
  editableField(id: ElementId): EditableField | null {
    const element = this.store.get(id);
    return element ? (EDITABLE_FIELDS[element.type] ?? null) : null;
  }

  /** Current value of the editable text field, or `null` when none. */
  getText(id: ElementId): string | null {
    const field = this.editableField(id);
    const element = this.store.get(id);
    if (!field || !element) {
      return null;
    }
    const semantic = element.semantic;
    if (typeof semantic !== "object" || semantic === null) {
      return "";
    }
    const value = (semantic as Record<string, unknown>)[field];
    return typeof value === "string" ? value : "";
  }

  /**
   * Write the editable text field. One `updateSemantic`; the rest of the
   * payload is carried over untouched. False when the element has no such
   * field or the text did not change.
   */
  setText(
    id: ElementId,
    text: string,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const field = this.editableField(id);
    const element = this.store.get(id);
    if (!field || !element || this.getText(id) === text) {
      return false;
    }
    const base =
      typeof element.semantic === "object" && element.semantic !== null
        ? { ...(element.semantic as Record<string, unknown>) }
        : {};
    if (
      text === "" &&
      field === "label" &&
      OPTIONAL_LABEL_TYPES.has(element.type)
    ) {
      delete base[field];
    } else {
      base[field] = text;
    }
    this.apply([{ type: "updateSemantic", id, semantic: base }], applyOptions);
    return true;
  }

  // ----------------------------------------------------------------- pages

  /** Add a page after the current ones and switch to it. */
  createPage(
    options: CreatePageOptions = {},
    applyOptions: ApplyOptions = {},
  ): PageId {
    const page: Page = {
      id: options.id ?? this.idSource(),
      name: options.name ?? `Page ${this.store.listPages().length + 1}`,
      kind: options.kind ?? "freeform",
    };
    this.apply([{ type: "createPage", page }], applyOptions);
    this.setCurrentPage(page.id);
    return page.id;
  }

  renamePage(
    id: PageId,
    name: string,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const page = this.store.getPage(id);
    if (!page || page.name === name) {
      return false;
    }
    this.apply([{ type: "updatePage", id, page: { name } }], applyOptions);
    return true;
  }

  setPageKind(
    id: PageId,
    kind: PageKind,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const page = this.store.getPage(id);
    if (!page || page.kind === kind) {
      return false;
    }
    this.apply([{ type: "updatePage", id, page: { kind } }], applyOptions);
    return true;
  }

  /** Delete a page and its elements. False for the last page or unknown ids. */
  deletePage(id: PageId, applyOptions: ApplyOptions = {}): boolean {
    if (!this.store.getPage(id) || this.store.listPages().length <= 1) {
      return false;
    }
    this.apply([{ type: "deletePage", id }], applyOptions);
    return true;
  }

  /**
   * Copy a page and everything on it (ids remapped through the clipboard
   * path) and switch to the copy. One undo step.
   */
  duplicatePage(id: PageId, applyOptions: ApplyOptions = {}): PageId | null {
    const source = this.store.getPage(id);
    if (!source) {
      return null;
    }
    const page: Page = {
      id: this.idSource(),
      name: `${source.name} copy`,
      kind: source.kind,
    };
    const payload = copyElements(
      this.store,
      this.store.getPageElements(id).map((element) => element.id),
    );
    const plan = planPaste(payload, {
      page: page.id,
      idSource: this.idSource,
      nextIndex: () => this.nextIndex(page.id),
      offset: { x: 0, y: 0 },
    });
    this.apply([{ type: "createPage", page }, ...plan.commands], applyOptions);
    this.setCurrentPage(page.id);
    return page.id;
  }

  // ---------------------------------------------------------------- camera

  /** Union of every element's bounds on `page`, or `null` when empty. */
  pageBounds(page: PageId = this.pageId): Box | null {
    const context = this.createShapeContext();
    const boxes: Box[] = [];
    for (const element of this.store.getPageElements(page)) {
      const box = context.boundsOf(element.id);
      if (box) {
        boxes.push(box);
      }
    }
    return unionBoxes(boxes);
  }

  /** Fit the page's content in a viewport of `size`. False when empty. */
  zoomToFit(size: ViewportSize, options: FitOptions = {}): boolean {
    const bounds = this.pageBounds();
    if (!bounds) {
      return false;
    }
    this.camera.fitBox(bounds, size, options);
    return true;
  }

  /** Fit the selection, zooming in if needed. False when nothing is selected. */
  zoomToSelection(size: ViewportSize, options: FitOptions = {}): boolean {
    const bounds = this.getSelectionBounds();
    if (!bounds) {
      return false;
    }
    this.camera.fitBox(bounds, size, { maxZoom: 4, ...options });
    return true;
  }

  zoomIn(anchor: Vec): void {
    this.camera.zoomTo(nextZoomStep(this.camera.get().z, "in"), anchor);
  }

  zoomOut(anchor: Vec): void {
    this.camera.zoomTo(nextZoomStep(this.camera.get().z, "out"), anchor);
  }

  resetZoom(anchor: Vec): void {
    this.camera.zoomTo(1, anchor);
  }

  // --------------------------------------------------------------- connect

  /**
   * Connect two elements with the connector their types call for: two ERD
   * tables get a relation, two UML classes an association, anything else
   * a generic edge. `null` for the same cases `connect` refuses.
   */
  connectSmart(
    from: ElementId,
    to: ElementId,
    applyOptions: ApplyOptions = {},
  ): ElementId | null {
    const source = this.store.get(from);
    const target = this.store.get(to);
    if (from === to || !source || !target) {
      return null;
    }
    if (source.type === "erd.table" && target.type === "erd.table") {
      return this.createElement(
        "erd.relation",
        {
          page: source.page,
          semantic: {
            from: { table: from },
            to: { table: to },
            cardinality: "1:*",
          },
        },
        applyOptions,
      );
    }
    if (source.type === "uml.class" && target.type === "uml.class") {
      return this.createElement(
        "uml.association",
        { page: source.page, semantic: { from, to, kind: "assoc" } },
        applyOptions,
      );
    }
    return this.connect(from, to, source.page, applyOptions);
  }

  private applyPlan(
    commands: readonly Command[],
    applyOptions: ApplyOptions,
  ): boolean {
    if (commands.length === 0) {
      return false;
    }
    this.apply(commands, applyOptions);
    return true;
  }

  private insertCopies(
    payload: ClipboardPayload,
    offset: Vec,
    applyOptions: ApplyOptions,
  ): readonly ElementId[] {
    const plan = planPaste(payload, {
      page: this.pageId,
      idSource: this.idSource,
      nextIndex: () => this.nextIndex(),
      offset,
    });
    this.apply(plan.commands, applyOptions);
    this.selection.set(topLevelAmong(this.store, plan.ids));
    return plan.ids;
  }

  private notify(diff: StoreDiff): void {
    this.revisionCount += 1;
    for (const listener of [...this.listeners]) {
      listener(diff);
    }
  }
}
