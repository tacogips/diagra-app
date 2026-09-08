// The editor facade: one object a renderer can hold.
//
// It owns the store, camera, selection and history, and it is the only
// entry point for mutation. Everything it exposes either reads state or
// funnels through `apply`, so there is no path by which a view can edit the
// document without validation and undo.

import {
  comparePageOrder,
  type AccessibilityMetadata,
  type BooleanOperation,
  type Document,
  type Element,
  type ElementId,
  type FractionalIndex,
  type FrameSemantic,
  type Page,
  type PageId,
  type PageKind,
  type ParticipantKind,
  SCHEMA_VERSION,
  type SequenceActivationSemantic,
  type SequenceMessageSemantic,
  type SequenceParticipantSemantic,
  type TextMark,
  type TextMarkKind,
  type TextNoteSemantic,
  type TextResizeMode,
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
  copyElementsInDocument,
  PASTE_OFFSET,
  planPaste,
} from "./clipboard.ts";
import { applyCommands, type Command, type CommandResult } from "./commands.ts";
import {
  compareFractional,
  keyAfter,
  keyBetween,
  type Rng,
} from "./fractional.ts";
import { type Box, type Vec, rotatedBox } from "./geometry.ts";
import { pageAfterRemoval, planPageOrder } from "./page-order.ts";
import {
  leafElements,
  memberIdsOf,
  groupOf,
  planGroup,
  planUngroup,
  resolveSelectionTarget,
  topLevelIds,
} from "./group.ts";
import { History } from "./history.ts";
import { createShapeContext, hitTestPoint } from "./hit-test.ts";
import { canFrameSelection, planFrameSelection } from "./frame-selection.ts";
import { type IdSource, newElementId } from "./ids.ts";
import { getSelectionBounds, Selection } from "./selection.ts";
import {
  normalizeTextMarks,
  rebaseTextMarks,
  textNoteMarks,
  toggleTextMarkRange,
} from "./rich-text.ts";
import { viewBounds } from "./view-bounds.ts";
import type {
  RasterMaskSampler,
  ShapeContext,
  ShapeUtil,
  ShapeUtilRegistry,
} from "./shape-util.ts";
import { createDefaultRegistry } from "./shapes/index.ts";
import { FRAME_PRESETS, type FramePresetKey } from "./shapes/frame.ts";
import {
  planBooleanGroup,
  planFlattenBooleanGroup,
} from "./boolean-operations.ts";
import { Store, type StoreDiff } from "./store.ts";
import {
  renderPageSvg,
  renderArtboardSvg,
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
  readonly accessibility?: AccessibilityMetadata;
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
  frame: "name",
  "erd.table": "tableName",
  "uml.class": "name",
  "edge.generic": "label",
  "erd.relation": "label",
  "uml.association": "label",
  "sequence.message": "label",
};

/** Keep breakpoint-owned geometry/state while adopting refreshed source paint. */
function responsiveVisual(existing: Element, inherited: Element): Visual {
  const {
    style,
    colorTokens,
    numberTokens,
    textStyle,
    componentKey,
    ...sourceRest
  } = inherited.visual;
  const {
    style: _style,
    colorTokens: _colors,
    numberTokens: _numbers,
    textStyle: _textStyle,
    componentKey: _componentKey,
    ...targetRest
  } = existing.visual;
  return {
    ...sourceRest,
    ...targetRest,
    ...(style ? { style } : {}),
    ...(colorTokens ? { colorTokens } : {}),
    ...(numberTokens ? { numberTokens } : {}),
    ...(textStyle ? { textStyle } : {}),
    ...(componentKey ? { componentKey } : {}),
  };
}

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
  private readonlyMode = false;
  /** Local authoring policy; remote store updates remain allowed. */
  get readOnly(): boolean {
    return this.readonlyMode;
  }

  setReadOnly(value: boolean): void {
    if (value === this.readonlyMode) return;
    this.readonlyMode = value;
    this.notify(HISTORY_DIFF);
  }

  private openRevision = 0;
  /** Changes on explicit opens, not same-document collaboration refreshes. */
  get documentOpenRevision(): number {
    return this.openRevision;
  }

  readonly store: Store;
  readonly camera: Camera;
  readonly selection = new Selection();
  readonly registry: ShapeUtilRegistry;
  readonly history: History;
  /** In-editor clipboard; copy/cut fill it, paste reads it. */
  readonly clipboard = new Clipboard();

  private readonly idSource: IdSource;
  private readonly rng: Rng;
  private rasterMaskSampler: RasterMaskSampler | undefined;
  private readonly listeners = new Set<EditorListener>();
  /** Highest index handed out per page, so a batch of builds stays ordered. */
  private readonly pendingTop = new Map<PageId, FractionalIndex>();
  private pageId: PageId;
  /** Per-client navigation state; never serialized or synchronized. */
  private readonly pageViews = new Map<PageId, CameraState>();
  private selectionAfterLoad: readonly ElementId[] | null = null;
  private knownPageOrder: readonly PageId[] = [];
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
      if (!this.readOnly) applyCommands(this.store, commands);
    });
    this.knownPageOrder = this.store.listPages().map((page) => page.id);
    this.pageId = this.knownPageOrder[0] ?? "";
    this.store.subscribe((diff) => {
      if (this.selectionAfterLoad !== null) {
        const ids = this.selectionAfterLoad;
        this.selectionAfterLoad = null;
        this.selection.set(
          ids.filter((id) => this.store.get(id)?.page === this.pageId),
        );
      } else {
        this.selection.prune(diff);
      }
      // A deleted (or undone) page must never stay current: a renderer
      // asked for its elements would draw nothing and the next click would
      // create an element on a page the store does not have.
      if (diff.pagesChanged && !this.store.getPage(this.pageId)) {
        this.pageViews.set(this.pageId, this.camera.get());
        this.pageId = pageAfterRemoval(
          this.knownPageOrder,
          this.store.listPages(),
          this.pageId,
        );
        this.selection.clear();
        this.camera.set(
          this.pageViews.get(this.pageId) ?? { x: 0, y: 0, z: 1 },
        );
      }
      if (diff.pagesChanged)
        this.knownPageOrder = this.store.listPages().map((page) => page.id);
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
    this.pageViews.set(this.pageId, this.camera.get());
    this.pageId = pageId;
    this.selection.clear();
    this.camera.set(this.pageViews.get(pageId) ?? { x: 0, y: 0, z: 1 });
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
   * Same-document collaboration refreshes can preserve local page, camera and
   * surviving selection with preserveView; explicit opens reset those states.
   */
  loadDocument(
    document: Document,
    options: { preserveView?: boolean } = {},
  ): void {
    const preserveView =
      options.preserveView === true && document.id === this.store.getMeta().id;
    if (!preserveView) this.openRevision += 1;
    const selected = preserveView ? [...this.selection.ids()] : [];
    if (preserveView) this.pageViews.set(this.pageId, this.camera.get());
    else this.pageViews.clear();
    this.silenceHistory = true;
    try {
      this.history.clear();
    } finally {
      this.silenceHistory = false;
    }
    if (!preserveView) this.selection.clear();
    this.pendingTop.clear();
    const pages = [...document.pages].sort(comparePageOrder);
    this.pageId =
      preserveView && document.pages.some((page) => page.id === this.pageId)
        ? this.pageId
        : preserveView
          ? pageAfterRemoval(this.knownPageOrder, pages, this.pageId)
          : (pages[0]?.id ?? "");
    this.camera.set(this.pageViews.get(this.pageId) ?? { x: 0, y: 0, z: 1 });
    this.selectionAfterLoad = preserveView ? selected : null;
    this.store.loadDocument(document);
  }

  getSnapshot(): Document {
    return this.store.getSnapshot();
  }

  reparentElement(id: ElementId, parent: ElementId | null): boolean {
    const commands = planReparent(
      this.store,
      this.createShapeContext(),
      id,
      parent,
    );
    if (!commands.length) return false;
    this.apply(commands);
    return true;
  }

  makeComponent(id: ElementId): boolean {
    const element = this.store.get(id);
    if (
      !element ||
      element.type !== "frame" ||
      this.createShapeContext().isLocked?.(id)
    )
      return false;
    const {
      instanceOf: _instanceOf,
      autoRefresh: _autoRefresh,
      instanceBindings: _bindings,
      ...semantic
    } = element.semantic as FrameSemantic;
    this.apply([
      {
        type: "updateSemantic",
        id,
        semantic: { ...semantic, component: true },
      },
    ]);
    return true;
  }

  createComponentInstance(id: ElementId, at?: Vec): ElementId | null {
    const source = this.store.get(id);
    if (
      !source ||
      source.type !== "frame" ||
      !(source.semantic as FrameSemantic).component
    )
      return null;
    const payload = copyElements(
      this.store,
      expandContainers(this.store, [id], this.createShapeContext()),
      {
        preserveColorTokens: true,
        preserveNumberTokens: true,
        preserveTextStyles: true,
      },
    );
    const plan = planPaste(payload, {
      page: this.pageId,
      idSource: this.idSource,
      nextIndex: () => this.nextIndex(),
      offset: at
        ? { x: at.x - (source.visual.x ?? 0), y: at.y - (source.visual.y ?? 0) }
        : { x: (this.getBounds(id)?.width ?? 200) + 40, y: 0 },
    });
    const instanceId = plan.mapping.get(id);
    if (!instanceId) return null;
    const commands = plan.commands.map((command): Command => {
      if (command.type !== "createElement" || command.element.id !== instanceId)
        return command;
      const {
        component: _component,
        instanceOf: _instance,
        instanceBindings: _bindings,
        ...semantic
      } = command.element.semantic as FrameSemantic;
      return {
        ...command,
        element: {
          ...command.element,
          semantic: {
            ...semantic,
            instanceOf: id,
            instanceBindings: componentBindings(this, plan.mapping),
          },
        },
      };
    });
    this.apply(commands);
    this.selection.set([instanceId]);
    return instanceId;
  }

  detachComponentInstance(id: ElementId): boolean {
    const element = this.store.get(id);
    if (
      !element ||
      element.type !== "frame" ||
      this.createShapeContext().isLocked?.(id)
    )
      return false;
    const {
      instanceOf,
      autoRefresh: _autoRefresh,
      instanceBindings: _bindings,
      ...semantic
    } = element.semantic as FrameSemantic;
    if (!instanceOf) return false;
    this.apply([{ type: "updateSemantic", id, semantic }]);
    return true;
  }

  resetComponentInstance(id: ElementId): boolean {
    const instance = this.store.get(id);
    const sourceId =
      instance?.type === "frame"
        ? (instance.semantic as FrameSemantic).instanceOf
        : undefined;
    return sourceId ? this.rebuildComponentInstance(id, sourceId) : false;
  }

  switchComponentVariant(id: ElementId, sourceId: ElementId): boolean {
    const instance = this.store.get(id);
    if (!instance || instance.type !== "frame") return false;
    const current = (instance.semantic as FrameSemantic).instanceOf;
    if (
      !current ||
      !componentVariants(this, current).some(
        (variant) => variant.id === sourceId,
      )
    )
      return false;
    if (current === sourceId) return true;
    return this.rebuildComponentInstance(id, sourceId, true);
  }

  updateComponentStructure(id: ElementId): boolean {
    const instance = this.store.get(id);
    if (!instance || instance.type !== "frame") return false;
    const semantic = instance.semantic as FrameSemantic;
    if (!semantic.instanceOf || !semantic.instanceBindings?.length)
      return false;
    return this.rebuildComponentInstance(id, semantic.instanceOf, true, true);
  }

  /** Pure command plan used by dependency-ordered automatic refresh. */
  planComponentStructureUpdate(id: ElementId): Command[] | null {
    const instance = this.store.get(id);
    const semantic =
      instance?.type === "frame"
        ? (instance.semantic as FrameSemantic)
        : undefined;
    return semantic?.instanceOf
      ? this.planRebuildComponentInstance(id, semantic.instanceOf, true, true)
      : null;
  }

  /** Reconcile source membership without replacing breakpoint-owned geometry. */
  updateResponsiveStructure(id: ElementId): boolean {
    const instance = this.store.get(id);
    if (!instance || instance.type !== "frame") return false;
    const semantic = instance.semantic as FrameSemantic;
    if (
      !semantic.responsiveSource ||
      semantic.instanceOf ||
      !semantic.instanceBindings?.length
    )
      return false;
    return this.rebuildResponsiveVariant(id, semantic.responsiveSource);
  }

  private rebuildComponentInstance(
    id: ElementId,
    sourceId: ElementId,
    preserveOverrides = false,
    preserveLocal = false,
  ): boolean {
    const commands = this.planRebuildComponentInstance(
      id,
      sourceId,
      preserveOverrides,
      preserveLocal,
    );
    if (!commands) return false;
    this.apply(commands);
    this.selection.set([id]);
    return true;
  }

  private planRebuildComponentInstance(
    id: ElementId,
    sourceId: ElementId,
    preserveOverrides = false,
    preserveLocal = false,
  ): Command[] | null {
    const instance = this.store.get(id);
    if (!instance || instance.type !== "frame") return null;
    const source = sourceId ? this.store.get(sourceId) : undefined;
    if (
      !source ||
      source.type !== "frame" ||
      !(source.semantic as FrameSemantic).component
    )
      return null;
    const context = this.createShapeContext();
    const oldIds = expandContainers(this.store, [id], context);
    if (
      oldIds.some((child) => context.isLocked?.(child)) ||
      oldIds.includes(source.id) ||
      expandContainers(this.store, [source.id], context).includes(id)
    )
      return null;
    const payload = copyElements(
      this.store,
      expandContainers(this.store, [source.id], context),
      {
        preserveColorTokens: true,
        preserveNumberTokens: true,
        preserveTextStyles: true,
      },
    );
    const reuse = preserveOverrides
      ? variantReuse(this, instance, source, payload.elements)
      : new Map([[source.id, id]]);
    if (!reuse) return null;
    let at = 0;
    const plan = planPaste(payload, {
      page: instance.page,
      idSource: () =>
        reuse.get(payload.elements[at++]?.id ?? "") ?? this.idSource(),
      nextIndex: () => this.nextIndex(instance.page),
      offset: {
        x: (instance.visual.x ?? 0) - (source.visual.x ?? 0),
        y: (instance.visual.y ?? 0) - (source.visual.y ?? 0),
      },
    });
    const kept = new Set(reuse.values());
    const additions = preserveLocal
      ? localComponentLayers(this, instance, oldIds, kept)
      : null;
    for (const local of additions?.local ?? []) kept.add(local);
    const commands: Command[] = [];
    for (const planned of plan.commands) {
      if (planned.type !== "createElement") {
        commands.push(planned);
        continue;
      }
      const inherited =
        preserveOverrides && kept.has(planned.element.id)
          ? carryVariantOverrides(this, id, planned.element)
          : planned.element;
      const element = additions?.attach(inherited) ?? inherited;
      if (!kept.has(element.id)) {
        commands.push({ type: "createElement", element });
        continue;
      }
      if (element.id !== id) {
        commands.push(
          {
            type: "updateSemantic",
            id: element.id,
            semantic: element.semantic,
          },
          { type: "replaceVisual", id: element.id, visual: element.visual },
          { type: "reorder", id: element.id, index: element.index },
        );
        continue;
      }
      const {
        component: _component,
        instanceOf: _old,
        instanceBindings: _bindings,
        ...semantic
      } = element.semantic as FrameSemantic;
      commands.push(
        {
          type: "updateSemantic",
          id,
          semantic: {
            ...semantic,
            instanceOf: source.id,
            ...((instance.semantic as FrameSemantic).autoRefresh === undefined
              ? {}
              : {
                  autoRefresh: (instance.semantic as FrameSemantic).autoRefresh,
                }),
            instanceBindings: componentBindings(this, plan.mapping),
          },
        },
        { type: "replaceVisual", id, visual: element.visual },
      );
    }
    commands.push({
      type: "deleteElements",
      ids: oldIds.filter((child) => !kept.has(child)),
    });
    return commands;
  }

  private rebuildResponsiveVariant(
    id: ElementId,
    sourceId: ElementId,
  ): boolean {
    const instance = this.store.get(id);
    const source = this.store.get(sourceId);
    if (
      !instance ||
      instance.type !== "frame" ||
      !source ||
      source.type !== "frame"
    )
      return false;
    const context = this.createShapeContext();
    const oldIds = expandContainers(this.store, [id], context);
    if (
      oldIds.some((child) => context.isLocked?.(child)) ||
      oldIds.includes(source.id) ||
      expandContainers(this.store, [source.id], context).includes(id)
    )
      return false;

    const refresh = planComponentRefresh(this, id);
    if (!refresh) return false;
    const staged = new Editor({
      document: this.getSnapshot(),
      registry: this.registry,
      idSource: () => "responsive-stage-unused",
    });
    applyCommands(staged.store, refresh);
    const stagedInstance = staged.store.get(id);
    const stagedSource = staged.store.get(sourceId);
    if (!stagedInstance || !stagedSource) return false;

    const payload = copyElements(
      staged.store,
      expandContainers(staged.store, [sourceId], staged.createShapeContext()),
      {
        preserveColorTokens: true,
        preserveNumberTokens: true,
        preserveTextStyles: true,
      },
    );
    const reuse = variantReuse(
      staged,
      stagedInstance,
      stagedSource,
      payload.elements,
    );
    if (!reuse) return false;
    let at = 0;
    const plan = planPaste(payload, {
      page: instance.page,
      idSource: () =>
        reuse.get(payload.elements[at++]?.id ?? "") ?? this.idSource(),
      nextIndex: () => this.nextIndex(instance.page),
      offset: {
        x: (instance.visual.x ?? 0) - (source.visual.x ?? 0),
        y: (instance.visual.y ?? 0) - (source.visual.y ?? 0),
      },
    });
    const kept = new Set(reuse.values());
    const additions = localComponentLayers(
      staged,
      stagedInstance,
      oldIds,
      kept,
    );
    for (const local of additions.local) kept.add(local);
    const bindings = componentBindings(staged, plan.mapping);
    const commands: Command[] = [];
    const sourceSized: Command[] = [];
    const added = new Set<ElementId>();

    for (const planned of plan.commands) {
      if (planned.type !== "createElement") continue;
      const raw = additions.attach(planned.element);
      const inherited = kept.has(raw.id)
        ? carryVariantOverrides(staged, id, raw)
        : raw;
      const element = additions.attach(inherited);
      const existing = staged.store.get(element.id);
      if (!existing || !kept.has(element.id)) {
        commands.push({ type: "createElement", element });
        sourceSized.push({ type: "createElement", element: raw });
        added.add(element.id);
        continue;
      }

      let semantic = element.semantic;
      if (element.id === id) {
        const fresh = element.semantic as FrameSemantic;
        const current = existing.semantic as FrameSemantic;
        const {
          memberIds: _members,
          component: _component,
          instanceOf: _instanceOf,
          responsiveSource: _responsiveSource,
          instanceBindings: _instanceBindings,
          ...breakpoint
        } = current;
        semantic = {
          ...fresh,
          ...breakpoint,
          memberIds: fresh.memberIds,
          responsiveSource: sourceId,
          instanceBindings: bindings,
        };
      }
      commands.push(
        { type: "updateSemantic", id: element.id, semantic },
        {
          type: "replaceVisual",
          id: element.id,
          visual: responsiveVisual(existing, element),
        },
        { type: "reorder", id: element.id, index: element.index },
      );
      sourceSized.push(
        { type: "updateSemantic", id: raw.id, semantic: raw.semantic },
        { type: "replaceVisual", id: raw.id, visual: raw.visual },
        { type: "reorder", id: raw.id, index: raw.index },
      );
    }

    const removed = oldIds.filter((child) => !kept.has(child));
    commands.push({ type: "deleteElements", ids: removed });
    sourceSized.push({ type: "deleteElements", ids: removed });
    const beforeResize = new Store(this.getSnapshot());
    applyCommands(beforeResize, sourceSized);
    const afterResize = new Store(this.getSnapshot());
    applyCommands(afterResize, commands);
    const constraints = planConstraints(
      beforeResize,
      afterResize,
      this.registry,
      added,
    );
    this.apply([...commands, ...constraints]);
    this.selection.set([id]);
    return true;
  }

  reorderFrameMember(id: ElementId, direction: -1 | 1): boolean {
    const commands = planReorderMember(
      this.store,
      this.createShapeContext(),
      id,
      direction,
    );
    if (!commands.length) return false;
    this.apply(commands);
    return true;
  }

  refreshComponentInstance(id: ElementId): boolean {
    const commands = planComponentRefresh(this, id);
    if (!commands) return false;
    if (commands.length) this.apply(commands);
    return true;
  }

  /** Pull inherited content/style changes into a responsive copy. */
  refreshResponsiveVariant(id: ElementId): boolean {
    const element = this.store.get(id);
    const semantic =
      element?.type === "frame"
        ? (element.semantic as FrameSemantic)
        : undefined;
    if (!semantic?.responsiveSource || semantic.instanceOf) return false;
    const commands = planComponentRefresh(this, id);
    if (!commands) return false;
    if (commands.length) this.apply(commands);
    return true;
  }

  /** Keep current responsive content but stop future source refreshes. */
  detachResponsiveVariant(id: ElementId): boolean {
    const element = this.store.get(id);
    if (
      !element ||
      element.type !== "frame" ||
      this.createShapeContext().isLocked?.(id)
    )
      return false;
    const {
      responsiveSource,
      instanceBindings: _bindings,
      ...semantic
    } = element.semantic as FrameSemantic;
    if (!responsiveSource) return false;
    this.apply([{ type: "updateSemantic", id, semantic }]);
    return true;
  }

  resetComponentOverride(
    instanceId: ElementId,
    targetId: ElementId,
    field: string,
  ): boolean {
    const commands = planResetComponentOverride(
      this,
      instanceId,
      targetId,
      field,
    );
    if (!commands) return false;
    this.apply(commands);
    return true;
  }

  apply(
    commands: readonly Command[],
    options: ApplyOptions = {},
  ): CommandResult {
    if (this.readOnly) return { undo: [], redo: [] };
    const context = this.createShapeContext();
    const permitted = commands.flatMap((command): Command[] => {
      // Explicit layer state controls remain available to unlock a layer.
      if (
        command.type === "updateVisual" &&
        Object.keys(command.visual).every(
          (key) => key === "locked" || key === "hidden",
        )
      )
        return [command];
      if (command.type === "deleteElements")
        return [
          {
            ...command,
            ids: command.ids.filter((id) => !context.isLocked?.(id)),
          },
        ];
      if (
        "id" in command &&
        this.store.has(command.id) &&
        context.isLocked?.(command.id)
      )
        return [];
      return [command];
    });
    let derived: Command[] = [];
    if (
      permitted.length &&
      (this.store
        .getSnapshot()
        .elements.some(
          (element) =>
            element.visual.colorTokens ||
            element.visual.numberTokens ||
            element.visual.textStyle ||
            element.visual.aspectRatio !== undefined ||
            element.visual.textResize === "auto-width" ||
            element.visual.textResize === "auto-height" ||
            (element.type === "frame" &&
              (element.semantic as { layout?: unknown }).layout),
        ) ||
        permitted.some(
          (command) =>
            command.type === "updateSemantic" ||
            command.type === "updateVisual" ||
            command.type === "replaceVisual" ||
            command.type === "deleteElements" ||
            command.type === "deletePage" ||
            command.type === "createElement",
        ))
    ) {
      const draft = new Store(this.store.getSnapshot());
      applyCommands(draft, permitted);
      derived = [
        ...planTextStyles(draft, this.registry),
        ...planColorTokens(draft, this.registry),
        ...planNumberTokens(draft, this.registry),
        ...planAutoComponentRefresh(draft, this.registry),
        ...planTextStyles(draft, this.registry),
        ...planColorTokens(draft, this.registry),
        ...planNumberTokens(draft, this.registry),
        ...planTextResize(draft, this.registry),
        ...planAspectRatios(draft, this.registry),
        ...planFrameTranslations(this.store, draft, this.registry),
        ...planConstraints(this.store, draft, this.registry),
      ];
      const beforeLayout = new Store(draft.getSnapshot());
      derived.push(...planAutoLayout(draft, this.registry));
      const resizedText = planTextResize(draft, this.registry);
      derived.push(...resizedText);
      if (resizedText.length)
        derived.push(...planAutoLayout(draft, this.registry));
      const constrainedAspect = planAspectRatios(draft, this.registry);
      derived.push(...constrainedAspect);
      if (constrainedAspect.length)
        derived.push(...planAutoLayout(draft, this.registry));
      derived.push(
        ...planFrameTranslations(beforeLayout, draft, this.registry),
      );
      derived.push(...planConstraints(beforeLayout, draft, this.registry));
    }
    const result = applyCommands(this.store, [...permitted, ...derived]);
    if (options.history !== "ignore") {
      this.history.push(result);
    }
    return result;
  }

  /** Recompute derived colors/layout from merged state without local undo entries. */
  reconcileDerivedState(): void {
    if (
      !this.store
        .getSnapshot()
        .elements.some(
          (element) =>
            element.visual.colorTokens ||
            element.visual.numberTokens ||
            element.visual.textStyle ||
            element.visual.aspectRatio !== undefined ||
            element.visual.textResize === "auto-width" ||
            element.visual.textResize === "auto-height" ||
            (element.type === "frame" &&
              (element.semantic as FrameSemantic).layout),
        )
    )
      return;
    const before = new Store(this.store.getSnapshot());
    const draft = new Store(before.getSnapshot());
    const commands = planTextStyles(draft, this.registry);
    commands.push(...planColorTokens(draft, this.registry));
    commands.push(...planNumberTokens(draft, this.registry));
    commands.push(...planTextResize(draft, this.registry));
    commands.push(...planAspectRatios(draft, this.registry));
    commands.push(...planAutoLayout(draft, this.registry));
    const resizedText = planTextResize(draft, this.registry);
    commands.push(...resizedText);
    if (resizedText.length)
      commands.push(...planAutoLayout(draft, this.registry));
    const constrainedAspect = planAspectRatios(draft, this.registry);
    commands.push(...constrainedAspect);
    if (constrainedAspect.length)
      commands.push(...planAutoLayout(draft, this.registry));
    commands.push(...planFrameTranslations(before, draft, this.registry));
    commands.push(...planConstraints(before, draft, this.registry));
    if (commands.length) applyCommands(this.store, commands);
  }

  undo(): boolean {
    if (this.readOnly) return false;
    return this.history.undo();
  }

  redo(): boolean {
    if (this.readOnly) return false;
    return this.history.redo();
  }

  canUndo(): boolean {
    if (this.readOnly) return false;
    return this.history.canUndo();
  }

  canRedo(): boolean {
    if (this.readOnly) return false;
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

  /**
   * Installs a platform-local decoded-pixel reader for raster mask picking.
   * It is deliberately ephemeral: document data and headless behavior retain
   * the deterministic source-box fallback when no sampler is present.
   */
  setRasterMaskSampler(sampler: RasterMaskSampler | undefined): void {
    this.rasterMaskSampler = sampler;
  }

  createShapeContext(zoom: number = this.camera.get().z): ShapeContext {
    return createShapeContext(
      this.store,
      this.registry,
      zoom,
      this.rasterMaskSampler,
    );
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
      ...(options.accessibility
        ? { accessibility: options.accessibility }
        : {}),
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
    const current = this.getBounds(id);
    const ratio = element.visual.aspectRatio;
    const horizontalChange = current?.width
      ? Math.abs(box.width / current.width - 1)
      : 0;
    const verticalChange = current?.height
      ? Math.abs(box.height / current.height - 1)
      : 0;
    const constrained =
      ratio !== undefined && current && supportsAspectRatio(element)
        ? {
            ...box,
            ...aspectSize(
              ratio,
              box.width,
              box.height,
              horizontalChange >= verticalChange ? "width" : "height",
            ),
          }
        : box;
    const patch = util.resize(element, constrained);
    const links = Object.fromEntries(
      Object.entries(element.visual.numberTokens ?? {}).filter(
        ([field]) =>
          !(field === "width" && patch.visual.width !== undefined) &&
          !(field === "height" && patch.visual.height !== undefined),
      ),
    );
    const { numberTokens: _old, ...rest } = element.visual;
    const visual = {
      ...rest,
      ...patch.visual,
      ...(element.type === "text.note" &&
      element.visual.textResize !== undefined &&
      element.visual.textResize !== "fixed"
        ? { textResize: "fixed" as const }
        : {}),
      ...(Object.keys(links).length ? { numberTokens: links } : {}),
    };
    this.apply([{ type: "replaceVisual", id, visual }], applyOptions);
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
    this.deleteElements(this.expandedSelection(), applyOptions);
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
    const payload = copyElements(this.store, this.expandedSelection());
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
    if (this.readOnly || this.selection.size === 0) {
      return [];
    }
    const payload = copyElementsInDocument(
      this.store,
      this.expandedSelection(),
    );
    if (payload.elements.length === 0) {
      return [];
    }
    return this.insertCopies(
      payload,
      { x: PASTE_OFFSET, y: PASTE_OFFSET },
      applyOptions,
      true,
    );
  }

  /**
   * Clone one complete artboard beside its source and resize the clone through
   * the normal constraint/layout pipeline. Shared design resources remain
   * linked because this is an in-document responsive variant, not a portable
   * clipboard fragment. The create and derived reflow form one undo step.
   */
  createResponsiveVariant(
    id: ElementId,
    presetKey: FramePresetKey,
    applyOptions: ApplyOptions = {},
  ): ElementId | null {
    const source = this.store.get(id);
    const sourceBounds = this.getBounds(id);
    const context = this.createShapeContext();
    const sourceSemantic =
      source?.type === "frame" ? (source.semantic as FrameSemantic) : undefined;
    if (
      !source ||
      source.type !== "frame" ||
      !sourceSemantic ||
      !sourceBounds ||
      context.isLocked?.(id) ||
      sourceSemantic?.component ||
      sourceSemantic?.instanceOf
    )
      return null;
    const preset = FRAME_PRESETS[presetKey];
    const payload = copyElementsInDocument(
      this.store,
      expandContainers(this.store, [id], context),
    );
    const copiedIds = new Set(payload.elements.map((element) => element.id));
    const sourceEnvelope = rotatedBox(
      sourceBounds,
      source.visual.rotation ?? 0,
    );
    const targetEnvelope = rotatedBox(
      { x: 0, y: sourceBounds.y, width: preset.width, height: preset.height },
      source.visual.rotation ?? 0,
    );
    let targetX =
      sourceEnvelope.x + sourceEnvelope.width + 80 - targetEnvelope.x;
    // Reserve existing screens, including hidden/locked ones. Sweep right in
    // geometric order so repeat variants do not stack at the same position.
    const obstacles = this.store
      .getPageElements(source.page)
      .flatMap((element) => {
        if (element.type !== "frame" || copiedIds.has(element.id)) return [];
        const box = this.getBounds(element.id, context);
        return box ? [rotatedBox(box, element.visual.rotation ?? 0)] : [];
      })
      .filter(
        (box) =>
          box.y < targetEnvelope.y + targetEnvelope.height &&
          box.y + box.height > targetEnvelope.y,
      )
      .sort((a, b) => a.x - b.x);
    for (const box of obstacles) {
      const left = targetX + targetEnvelope.x;
      if (
        left < box.x + box.width + 80 &&
        left + targetEnvelope.width + 80 > box.x
      )
        targetX = box.x + box.width + 80 - targetEnvelope.x;
    }
    if (!Number.isFinite(targetX)) return null;
    const plan = planPaste(payload, {
      page: source.page,
      idSource: this.idSource,
      nextIndex: () => this.nextIndex(source.page),
      offset: { x: targetX - sourceBounds.x, y: 0 },
    });
    const createdId = plan.mapping.get(id);
    if (!createdId) return null;
    const created = plan.commands.flatMap((command) =>
      command.type === "createElement" && command.element.id === createdId
        ? [command.element]
        : [],
    )[0];
    if (!created) return null;
    const current = created.semantic as FrameSemantic;
    const {
      platform: _platform,
      safeArea: _safeArea,
      responsiveSource: _responsiveSource,
      instanceBindings: _instanceBindings,
      ...rest
    } = current;
    const semantic: FrameSemantic = {
      ...rest,
      name: `${sourceSemantic.name} — ${preset.name}`,
      platform: preset.platform,
      responsiveSource: id,
      instanceBindings: componentBindings(this, plan.mapping),
      ...("safeArea" in preset ? { safeArea: preset.safeArea } : {}),
    };

    const retainedNumberTokens = Object.fromEntries(
      Object.entries(created.visual.numberTokens ?? {}).filter(
        ([field]) => field !== "width" && field !== "height",
      ),
    );
    const { numberTokens: _numberTokens, ...createdVisual } = created.visual;
    const resizeCommand: Command = {
      type: "replaceVisual",
      id: createdId,
      visual: {
        ...createdVisual,
        x: targetX,
        y: sourceBounds.y,
        width: preset.width,
        height: preset.height,
        ...(Object.keys(retainedNumberTokens).length
          ? { numberTokens: retainedNumberTokens }
          : {}),
      },
    };
    const semanticCommand: Command = {
      type: "updateSemantic",
      id: createdId,
      semantic,
    };
    // The normal apply pipeline cannot derive constraints for elements that
    // did not exist in its before-snapshot. Stage just this new hierarchy at
    // source size, resize it in a second temporary store, and append those
    // constraint commands to the one real transaction.
    const beforeResize = new Store(this.store.getSnapshot());
    applyCommands(beforeResize, [...plan.commands, semanticCommand]);
    const afterResize = new Store(beforeResize.getSnapshot());
    applyCommands(afterResize, [resizeCommand]);
    const responsiveConstraints = planConstraints(
      beforeResize,
      afterResize,
      this.registry,
    );
    this.apply(
      [
        ...plan.commands,
        semanticCommand,
        resizeCommand,
        ...responsiveConstraints,
      ],
      applyOptions,
    );
    this.selection.set([createdId]);
    return createdId;
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
      new Set(this.expandedSelection()),
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

  /** Exact artboard envelope, with no editor-title annotation. */
  exportArtboardSvg(
    id: ElementId,
    options: SvgExportOptions = {},
  ): string | null {
    return renderArtboardSvg(this.store, this.registry, id, options);
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
    for (const leaf of leafElements(this.store, this.expandedSelection())) {
      const { x, y } = leaf.visual;
      if (x !== undefined && y !== undefined) {
        out.push({ id: leaf.id, x, y });
      }
    }
    return out;
  }

  /** Current selection plus contained artboard contents and group members. */
  expandedSelection(): readonly ElementId[] {
    return expandContainers(
      this.store,
      this.selection.ids(),
      this.createShapeContext(),
    );
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

  /** Wrap eligible selected outlines in one editable Boolean group. */
  booleanSelection(
    operation: BooleanOperation,
    applyOptions: ApplyOptions = {},
  ): ElementId | null {
    const plan = planBooleanGroup(
      this.store,
      this.selection.ids(),
      this.idSource(),
      this.rng,
      this.createShapeContext(),
      operation,
    );
    if (!plan) return null;
    this.apply(plan.commands, applyOptions);
    this.selection.set([plan.id]);
    return plan.id;
  }

  /** Destructively resolve one selected Boolean group to an editable path. */
  flattenBooleanSelection(applyOptions: ApplyOptions = {}): ElementId | null {
    if (this.selection.size !== 1) return null;
    const [groupId] = this.selection.ids();
    if (!groupId) return null;
    const plan = planFlattenBooleanGroup(
      this.store,
      groupId,
      this.idSource(),
      this.createShapeContext(),
    );
    if (!plan) return null;
    this.apply(plan.commands, applyOptions);
    this.selection.set([plan.id]);
    return plan.id;
  }

  /** Wrap one or more sibling layers in a tightly fitted frame. */
  frameSelection(applyOptions: ApplyOptions = {}): ElementId | null {
    const context = this.createShapeContext();
    if (!canFrameSelection(this.store, this.selection.ids(), context))
      return null;
    const plan = planFrameSelection(
      this.store,
      this.selection.ids(),
      this.idSource(),
      context,
      this.rng,
    );
    if (!plan) return null;
    this.apply(plan.commands, applyOptions);
    this.selection.set([plan.id]);
    return plan.id;
  }

  canFrameSelection(): boolean {
    return canFrameSelection(
      this.store,
      this.selection.ids(),
      this.createShapeContext(),
    );
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
      let next: Record<string, unknown> = { ...previous };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
          delete next[key];
        } else if (value !== undefined) {
          next[key] = value;
        }
      }
      if (patch.fill !== undefined && patch.fillGradient === undefined) {
        const { fillGradient: _gradient, ...solid } = next;
        next = solid;
      }
      if (patch.stroke !== undefined && patch.strokeGradient === undefined) {
        const { strokeGradient: _gradient, ...solid } = next;
        next = solid;
      }
      if (
        patch.fillGradient !== undefined &&
        patch.fillGradient !== null &&
        patch.fill === undefined
      ) {
        const fallback = patch.fillGradient.stops[0]?.color;
        if (fallback) next.fill = fallback;
      }
      if (
        patch.strokeGradient !== undefined &&
        patch.strokeGradient !== null &&
        patch.stroke === undefined
      ) {
        const fallback = patch.strokeGradient.stops[0]?.color;
        if (fallback) next.stroke = fallback;
      }
      let links = { ...leaf.visual.colorTokens };
      for (const field of COLOR_FIELDS) {
        if (patch[field] !== undefined) delete links[field];
      }
      if (patch.fillGradient !== undefined && patch.fillGradient !== null) {
        const { fill: _fill, ...withoutFill } = links;
        links = withoutFill;
      }
      if (patch.strokeGradient !== undefined && patch.strokeGradient !== null) {
        const { stroke: _stroke, ...withoutStroke } = links;
        links = withoutStroke;
      }
      const numberLinks = { ...leaf.visual.numberTokens };
      for (const field of STYLE_NUMBER_FIELDS) {
        if (patch[field] !== undefined) delete numberLinks[field];
      }
      if (patch.cornerRadii !== undefined) {
        for (const field of CORNER_NUMBER_FIELDS) {
          const corner = CORNER_STYLE_FIELDS[field];
          if (
            patch.cornerRadii === null ||
            leaf.visual.style?.cornerRadii?.[corner] !==
              patch.cornerRadii[corner]
          )
            delete numberLinks[field];
        }
      }
      const textStyleEdited = TYPOGRAPHY_FIELDS.some(
        (field) => patch[field] !== undefined,
      );
      if (
        JSON.stringify(previous) === JSON.stringify(next) &&
        JSON.stringify(links) ===
          JSON.stringify(leaf.visual.colorTokens ?? {}) &&
        JSON.stringify(numberLinks) ===
          JSON.stringify(leaf.visual.numberTokens ?? {}) &&
        (!textStyleEdited || leaf.visual.textStyle === undefined)
      ) {
        continue;
      }
      const {
        style: _dropped,
        colorTokens: _links,
        numberTokens: _numberLinks,
        textStyle: linkedTextStyle,
        ...unlinked
      } = leaf.visual;
      const rest = {
        ...unlinked,
        ...(Object.keys(links).length ? { colorTokens: links } : {}),
        ...(Object.keys(numberLinks).length
          ? { numberTokens: numberLinks }
          : {}),
        ...(!textStyleEdited && linkedTextStyle
          ? { textStyle: linkedTextStyle }
          : {}),
      };
      const visual: Visual =
        Object.keys(next).length === 0
          ? rest
          : { ...rest, style: next as VisualStyle };
      commands.push({ type: "replaceVisual", id: leaf.id, visual });
    }
    return this.applyPlan(commands, applyOptions);
  }

  /** Set Figma-style sizing for selected text notes as one undoable edit. */
  setSelectionTextResize(
    mode: TextResizeMode,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const commands: Command[] = [];
    for (const leaf of leafElements(this.store, this.selection.ids())) {
      if (leaf.type !== "text.note" || leaf.visual.textResize === mode)
        continue;
      const { numberTokens: oldLinks, ...rest } = leaf.visual;
      const links = Object.fromEntries(
        Object.entries(oldLinks ?? {}).filter(
          ([field]) =>
            !(mode !== "fixed" && field === "height") &&
            !(mode === "auto-width" && field === "width"),
        ),
      );
      const visual: Visual = {
        ...rest,
        textResize: mode,
        ...(Object.keys(links).length ? { numberTokens: links } : {}),
      };
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
    if (this.readOnly) return false;
    const field = this.editableField(id);
    const element = this.store.get(id);
    if (!field || !element || this.getText(id) === text) {
      return false;
    }
    const base =
      typeof element.semantic === "object" && element.semantic !== null
        ? { ...(element.semantic as Record<string, unknown>) }
        : {};
    if (element.type === "text.note") {
      const previous = this.getText(id) ?? "";
      const marks = rebaseTextMarks(previous, text, textNoteMarks(base));
      return this.setRichText(id, text, marks, applyOptions);
    }
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

  /** Replace one text note's content and portable inline marks atomically. */
  setRichText(
    id: ElementId,
    text: string,
    marks: readonly TextMark[],
    applyOptions: ApplyOptions = {},
  ): boolean {
    const element = this.store.get(id);
    if (element?.type !== "text.note") return false;
    const semantic = element.semantic as TextNoteSemantic;
    const normalized = normalizeTextMarks(text, marks);
    const { marks: _marks, ...rest } = semantic;
    const next = {
      ...rest,
      text,
      ...(normalized.length ? { marks: normalized } : {}),
    };
    if (JSON.stringify(next) === JSON.stringify(semantic)) return false;
    this.apply([{ type: "updateSemantic", id, semantic: next }], applyOptions);
    return true;
  }

  /** Toggle formatting over a text note's half-open UTF-16 range. */
  toggleTextMark(
    id: ElementId,
    start: number,
    end: number,
    kind: TextMarkKind,
    href?: string,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const element = this.store.get(id);
    if (element?.type !== "text.note") return false;
    const semantic = element.semantic as TextNoteSemantic;
    return this.setRichText(
      id,
      semantic.text,
      toggleTextMarkRange(
        semantic.text,
        textNoteMarks(semantic),
        start,
        end,
        kind,
        href,
      ),
      applyOptions,
    );
  }

  // ----------------------------------------------------------------- pages

  /** Add a page after the current ones and switch to it. */
  createPage(
    options: CreatePageOptions = {},
    applyOptions: ApplyOptions = {},
  ): PageId {
    const ordering = planPageOrder(
      this.store.listPages(),
      this.store.listPages().length,
      this.rng,
    );
    const page: Page = {
      id: options.id ?? this.idSource(),
      name: options.name ?? `Page ${this.store.listPages().length + 1}`,
      kind: options.kind ?? "freeform",
      order: ordering.order,
    };
    this.apply(
      [...ordering.commands, { type: "createPage", page }],
      applyOptions,
    );
    this.setCurrentPage(page.id);
    return page.id;
  }

  /** Move a page one position without changing active page, camera or selection. */
  reorderPage(
    id: PageId,
    delta: -1 | 1,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const pages = this.store.listPages();
    const index = pages.findIndex((page) => page.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= pages.length) return false;
    const ordering = planPageOrder(pages, target, this.rng, id);
    this.apply(
      [
        ...ordering.commands,
        { type: "updatePage", id, page: { order: ordering.order } },
      ],
      applyOptions,
    );
    return true;
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

  /** Select a design-token mode for one page; null restores Default. */
  setPageTokenMode(
    id: PageId,
    mode: string | null,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const page = this.store.getPage(id);
    const value = mode?.trim() || null;
    if (
      !page ||
      value?.toLowerCase() === "default" ||
      (page.tokenMode ?? null) === value
    )
      return false;
    this.apply(
      [{ type: "updatePage", id, page: { tokenMode: value } }],
      applyOptions,
    );
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
    const pages = this.store.listPages();
    const ordering = planPageOrder(
      pages,
      pages.findIndex((page) => page.id === id) + 1,
      this.rng,
    );
    const page: Page = {
      id: this.idSource(),
      name: `${source.name} copy`,
      kind: source.kind,
      order: ordering.order,
      ...(source.tokenMode ? { tokenMode: source.tokenMode } : {}),
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
    this.apply(
      [...ordering.commands, { type: "createPage", page }, ...plan.commands],
      applyOptions,
    );
    this.setCurrentPage(page.id);
    return page.id;
  }

  // ---------------------------------------------------------------- camera

  /** Union of every element's bounds on `page`, or `null` when empty. */
  pageBounds(page: PageId = this.pageId): Box | null {
    const context = this.createShapeContext();
    return viewBounds(
      this.store,
      this.store.getPageElements(page).map((element) => element.id),
      context,
    );
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
    const bounds = viewBounds(
      this.store,
      [...this.selection.ids()],
      this.createShapeContext(),
    );
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

  private nextSequenceOrder(page: PageId): FractionalIndex {
    let latest: string | null = null;
    for (const element of this.store.getPageElements(page)) {
      if (element.type === "sequence.message") {
        const order = (element.semantic as SequenceMessageSemantic).order;
        if (latest === null || compareFractional(order, latest) > 0)
          latest = order;
      } else if (element.type === "sequence.activation") {
        const semantic = element.semantic as SequenceActivationSemantic;
        for (const order of [semantic.fromOrder, semantic.toOrder]) {
          if (latest === null || compareFractional(order, latest) > 0)
            latest = order;
        }
      }
    }
    return keyAfter(latest, this.rng);
  }

  private nextParticipantOrder(page: PageId): FractionalIndex {
    let latest: string | null = null;
    for (const element of this.store.getPageElements(page)) {
      if (element.type !== "sequence.participant") continue;
      const order = (element.semantic as SequenceParticipantSemantic).order;
      if (latest === null || compareFractional(order, latest) > 0)
        latest = order;
    }
    return keyAfter(latest, this.rng);
  }

  /** Move one sequence participant/message by one semantic timeline slot. */
  moveSequenceElement(
    id: ElementId,
    delta: -1 | 1,
    applyOptions: ApplyOptions = {},
  ): boolean {
    const element = this.store.get(id);
    if (
      !element ||
      (element.type !== "sequence.participant" &&
        element.type !== "sequence.message")
    )
      return false;
    const context = this.createShapeContext();
    if (context.isLocked?.(id)) return false;
    const peers = this.store
      .getPageElements(element.page)
      .filter((peer) => peer.type === element.type)
      .sort((left, right) => {
        const a = (left.semantic as { order: FractionalIndex }).order;
        const b = (right.semantic as { order: FractionalIndex }).order;
        return compareFractional(a, b) || compareFractional(left.id, right.id);
      });
    const index = peers.findIndex((peer) => peer.id === id);
    const targetIndex = index + delta;
    const target = peers[targetIndex];
    if (index < 0 || !target || context.isLocked?.(target.id)) return false;

    const remaining = peers.filter((peer) => peer.id !== id);
    const insertionIndex = targetIndex;
    const before = remaining[insertionIndex - 1];
    const after = remaining[insertionIndex];
    const beforeOrder = before
      ? (before.semantic as { order: FractionalIndex }).order
      : null;
    const afterOrder = after
      ? (after.semantic as { order: FractionalIndex }).order
      : null;
    // Duplicate imported keys still have a stable id tie-break, but there is
    // no fractional value strictly between equal bounds. Refuse cleanly.
    if (
      beforeOrder !== null &&
      afterOrder !== null &&
      compareFractional(beforeOrder, afterOrder) >= 0
    )
      return false;
    const order = keyBetween(beforeOrder, afterOrder, this.rng);
    const semantic = {
      ...(element.semantic as Record<string, unknown>),
      order,
    };
    const axis = element.type === "sequence.participant" ? "x" : "y";
    const currentPosition = element.visual[axis];
    const targetPosition = target.visual[axis];
    const commands: Command[] = [
      { type: "updateSemantic", id, semantic },
      ...(currentPosition !== undefined && targetPosition !== undefined
        ? [
            {
              type: "updateVisual" as const,
              id,
              visual: { [axis]: targetPosition },
            },
            {
              type: "updateVisual" as const,
              id: target.id,
              visual: { [axis]: currentPosition },
            },
          ]
        : []),
    ];
    this.apply(commands, applyOptions);
    return true;
  }

  /** Place one ordered sequence participant with its header at a page point. */
  createSequenceParticipant(
    kind: ParticipantKind,
    centre: Vec,
    applyOptions: ApplyOptions = {},
  ): ElementId {
    const page = this.pageId;
    const count = this.store
      .getPageElements(page)
      .filter(
        (element) =>
          element.type === "sequence.participant" &&
          (element.semantic as SequenceParticipantSemantic).kind === kind,
      ).length;
    const label: Readonly<Record<ParticipantKind, string>> = {
      actor: "Actor",
      service: "Service",
      db: "Database",
    };
    let bottom = centre.y + 110;
    for (const element of this.store.getPageElements(page)) {
      if (element.type === "sequence.message" && element.visual.y !== undefined)
        bottom = Math.max(bottom, element.visual.y + 60);
    }
    const element = this.buildElement("sequence.participant", {
      page,
      semantic: {
        name: `${label[kind]} ${count + 1}`,
        kind,
        order: this.nextParticipantOrder(page),
      },
      visual: {
        x: centre.x - 80,
        y: centre.y - 28,
        width: 160,
        height: Math.max(220, bottom - (centre.y - 28)),
      },
    });
    this.apply([{ type: "createElement", element }], applyOptions);
    return element.id;
  }

  /** Create an activation bar spanning this participant's current messages. */
  createSequenceActivation(
    participantId: ElementId,
    applyOptions: ApplyOptions = {},
  ): ElementId | null {
    const participant = this.store.get(participantId);
    if (
      !participant ||
      participant.type !== "sequence.participant" ||
      this.createShapeContext().isLocked?.(participantId)
    )
      return null;
    const messages = this.store
      .getPageElements(participant.page)
      .filter((element) => {
        if (element.type !== "sequence.message") return false;
        const semantic = element.semantic as SequenceMessageSemantic;
        return semantic.from === participantId || semantic.to === participantId;
      })
      .sort((left, right) => {
        const a = (left.semantic as SequenceMessageSemantic).order;
        const b = (right.semantic as SequenceMessageSemantic).order;
        return compareFractional(a, b) || compareFractional(left.id, right.id);
      });
    const first = messages[0];
    const last = messages.at(-1);
    const fromOrder = first
      ? (first.semantic as SequenceMessageSemantic).order
      : this.nextSequenceOrder(participant.page);
    const toOrder =
      last && last !== first
        ? (last.semantic as SequenceMessageSemantic).order
        : keyAfter(fromOrder, this.rng);
    const startY = first?.visual.y ?? (participant.visual.y ?? 0) + 104;
    const endY = last?.visual.y ?? startY + 52;
    const activation = this.buildElement("sequence.activation", {
      page: participant.page,
      semantic: { participant: participantId, fromOrder, toOrder },
      visual: {
        y: startY,
        width: 10,
        height: Math.max(24, endY - startY + 24),
      },
    });
    const requiredHeight = endY - (participant.visual.y ?? 0) + 60;
    const commands: Command[] = [];
    if ((participant.visual.height ?? 220) < requiredHeight)
      commands.push({
        type: "replaceVisual",
        id: participant.id,
        visual: { ...participant.visual, height: requiredHeight },
      });
    commands.push({ type: "createElement", element: activation });
    this.apply(commands, applyOptions);
    return activation.id;
  }

  /**
   * Connect two elements with the connector their types call for: two ERD
   * tables get a relation, two UML classes an association, two sequence
   * participants a timeline message, and anything else a generic edge.
   * `null` for the same cases `connect` refuses.
   */
  connectSmart(
    from: ElementId,
    to: ElementId,
    applyOptions: ApplyOptions = {},
  ): ElementId | null {
    const source = this.store.get(from);
    const target = this.store.get(to);
    if (from === to || !source || !target || source.page !== target.page) {
      return null;
    }
    if (
      source.type === "sequence.participant" &&
      target.type === "sequence.participant"
    ) {
      const context = this.createShapeContext();
      if (context.isLocked?.(from) || context.isLocked?.(to)) return null;
      const existingY = this.store
        .getPageElements(source.page)
        .filter((element) => element.type === "sequence.message")
        .reduce(
          (bottom, element) => Math.max(bottom, element.visual.y ?? bottom),
          Math.max((source.visual.y ?? 0) + 112, (target.visual.y ?? 0) + 112),
        );
      const y = existingY + 52;
      const message = this.buildElement("sequence.message", {
        page: source.page,
        semantic: {
          from,
          to,
          order: this.nextSequenceOrder(source.page),
          kind: "sync",
          label: "Message",
        },
        visual: { y },
      });
      const commands: Command[] = [];
      for (const participant of this.store
        .getPageElements(source.page)
        .filter((element) => element.type === "sequence.participant")) {
        if (context.isLocked?.(participant.id)) continue;
        const requiredHeight = y - (participant.visual.y ?? 0) + 60;
        if ((participant.visual.height ?? 220) < requiredHeight)
          commands.push({
            type: "replaceVisual",
            id: participant.id,
            visual: { ...participant.visual, height: requiredHeight },
          });
      }
      commands.push({ type: "createElement", element: message });
      this.apply(commands, applyOptions);
      return message.id;
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
    if (this.readOnly || commands.length === 0) {
      return false;
    }
    this.apply(commands, applyOptions);
    return true;
  }

  private insertCopies(
    payload: ClipboardPayload,
    offset: Vec,
    applyOptions: ApplyOptions,
    preserveParents = false,
  ): readonly ElementId[] {
    const plan = planPaste(payload, {
      page: this.pageId,
      idSource: this.idSource,
      nextIndex: () => this.nextIndex(),
      offset,
    });
    const membership: Command[] = [];
    if (preserveParents) {
      const context = this.createShapeContext();
      const parents = frameParents(this.store, this.pageId, context);
      const roots = new Set(
        topLevelAmong(this.store, [...plan.mapping.keys()]),
      );
      const groupParents = new Map(
        [...roots].map((id) => [id, groupOf(this.store, id)?.id]),
      );
      for (const frame of this.store.getPageElements(this.pageId)) {
        if (
          (frame.type !== "frame" && frame.type !== "group") ||
          plan.mapping.has(frame.id)
        )
          continue;
        const semantic = frame.semantic as FrameSemantic;
        const members =
          semantic.memberIds ??
          [...parents]
            .filter(([, parent]) => parent === frame.id)
            .map(([child]) => child);
        const next = members.flatMap((child) => {
          const groupParent = groupParents.get(child);
          const ownsCopy =
            frame.type === "group"
              ? groupParent === frame.id
              : groupParent === undefined;
          const copy =
            roots.has(child) && ownsCopy ? plan.mapping.get(child) : undefined;
          return copy ? [child, copy] : [child];
        });
        if (next.length === members.length) continue;
        if (context.isLocked?.(frame.id)) return [];
        membership.push({
          type: "updateSemantic",
          id: frame.id,
          semantic: { ...semantic, memberIds: next },
        });
      }
    }
    this.apply([...plan.commands, ...membership], applyOptions);
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
import { expandContainers, frameParents } from "./frame-tree.ts";
import { planAutoLayout } from "./auto-layout.ts";
import { planReparent, planReorderMember } from "./frame-membership.ts";
import { planConstraints } from "./constraints.ts";
import { planFrameTranslations } from "./frame-translation.ts";
import {
  componentBindings,
  planComponentRefresh,
} from "./component-refresh.ts";
import { planResetComponentOverride } from "./component-overrides.ts";
import { componentVariants } from "./component-variants.ts";
import { carryVariantOverrides, variantReuse } from "./variant-reuse.ts";
import { localComponentLayers } from "./component-local.ts";
import { planAutoComponentRefresh } from "./auto-component-refresh.ts";
import { COLOR_FIELDS, planColorTokens } from "./color-tokens.ts";
import {
  CORNER_NUMBER_FIELDS,
  CORNER_STYLE_FIELDS,
  planNumberTokens,
  STYLE_NUMBER_FIELDS,
} from "./number-tokens.ts";
import { planTextResize } from "./text-layout.ts";
import { planTextStyles, TYPOGRAPHY_FIELDS } from "./text-styles.ts";
import {
  aspectSize,
  planAspectRatios,
  supportsAspectRatio,
} from "./aspect-ratio.ts";
