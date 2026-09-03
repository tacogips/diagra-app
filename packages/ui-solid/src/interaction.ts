// Pointer and keyboard gestures.
//
// One state machine, one gesture at a time. Everything it does to the
// document goes through `editor.apply` (or an editor helper that does), and
// every drag is wrapped in `beginBatch`/`endBatch` so a hundred pointer
// moves undo as one step.
//
// That pairing is the invariant this file exists to protect. `beginBatch`
// without its `endBatch` does not fail loudly: history simply keeps folding
// every later edit into a batch that is never committed, so undo goes dead
// for the rest of the session. One pointer therefore owns the canvas at a
// time — `activePointerId` — and every event from any other pointer is
// dropped before it can reach a gesture transition.
//
// Which gestures open a batch: `translating` and `resizing` (many applies
// per drag). `connecting` and `reconnecting` end in at most one apply and
// open none. Arrow-key nudges open one batch that a timer closes 500 ms
// after the last press; anything else that could edit the document
// (a pointer down, a shortcut) closes it first, so the nudge batch is never
// open underneath another gesture's batch.
//
// Camera changes deliberately do not touch history: panning and zooming are
// not edits.

import type {
  Box,
  Editor,
  ResizeEdges,
  SnapGuide,
  SnapOptions,
  Vec,
  ViewportSize,
} from "@diagra/core";
import {
  ancestorChain,
  ERD_TABLE_HEADER_HEIGHT,
  ERD_TABLE_ROW_HEIGHT,
  endpointReaderFor,
  erdColumnCount,
  groupOf,
  isGroup,
  normalizeBox,
  outermostGroupOf,
  resolveConnector,
  snapResize,
  snapTranslate,
  UML_CLASS_ROW_HEIGHT,
  umlNameHeight,
  unionBoxes,
} from "@diagra/core";
import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import { type Accessor, createSignal } from "solid-js";
import { creationFor, type ToolKind } from "./tools.ts";

export const RESIZE_HANDLES = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;

export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** Nothing may be resized below this, in page units. */
export const MIN_SHAPE_SIZE = 8;

/** Arrow keys move the selection by this many page units. */
export const NUDGE_STEP = 1;
/** With shift held, arrows move by one grid step instead. */
export const NUDGE_GRID_STEP = 24;
/** Consecutive nudges closer than this collapse into one undo step. */
export const NUDGE_COALESCE_MS = 500;

/** Object snapping pulls at most this many screen pixels (design 6). */
export const SNAP_THRESHOLD_PX = 8;
/** Grid spacing in page units, shared with the canvas background. */
export const SNAP_GRID = 24;

/** Pointer travel below this many screen pixels still counts as a click. */
const CLICK_SLOP_PX = 3;

/** Wheel delta in "lines" is converted to pixels with this factor. */
const LINE_HEIGHT = 16;

/** Types whose creation tool opens the text editor right away (design 3.3). */
const EDIT_ON_CREATE: ReadonlySet<string> = new Set([
  "text.note",
  "node.generic",
]);

/** Tool letters from the keyboard map (design section 5). */
const TOOL_KEYS: Readonly<Record<string, ToolKind>> = {
  v: "select",
  h: "hand",
  r: "geo:rect",
  o: "geo:ellipse",
  d: "geo:diamond",
  n: "node.generic",
  t: "text.note",
  l: "edge",
};

const ARROW_KEYS: Readonly<Record<string, Vec>> = {
  arrowleft: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  arrowup: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
};

const EDITABLE_TAGS: ReadonlySet<string> = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

/** Class of the page-space slot the inline text editor mounts in. */
export const SLOT_LAYER_CLASS = "diagra-slot-layer";

const NO_GUIDES: readonly SnapGuide[] = [];

export interface PendingConnection {
  readonly from: Vec;
  readonly to: Vec;
}

/**
 * Where on an element a double-click landed: the title band of a table or
 * class, one of its rows (counted across ERD columns, or UML attributes
 * then methods), or anywhere else.
 */
export type EditRegion = "body" | "title" | { readonly row: number };

export interface SnapSettings {
  readonly grid: boolean;
  readonly objects: boolean;
}

/** Which end of a connector an endpoint handle drags. */
export type ConnectorEnd = "from" | "to";

export interface ContextMenuPoint {
  readonly screen: Vec;
  readonly page: Vec;
}

export interface ResizeModifiers {
  /** Shift: keep the start box's aspect ratio. */
  readonly keepAspect?: boolean;
  /** Alt/Option: grow both sides, keeping the centre where it was. */
  readonly fromCenter?: boolean;
}

/**
 * Runs `callback` after `delayMs` and returns a function that cancels it.
 * Injected so the nudge timer can be driven by hand in tests.
 */
export type Scheduler = (callback: () => void, delayMs: number) => () => void;

const defaultScheduler: Scheduler = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

type Gesture =
  | { readonly kind: "idle" }
  | { readonly kind: "panning"; lastScreen: Vec }
  | {
      readonly kind: "translating";
      readonly startPage: Vec;
      readonly startScreen: Vec;
      readonly origins: ReadonlyMap<ElementId, Vec>;
      /** Union of the moving elements' bounds before the drag. */
      readonly startBounds: Box | null;
      /** Bounds the moving box may snap to; computed once per drag. */
      readonly candidates: readonly Box[];
      /**
       * What a click (a drag that never travelled) selects on release: the
       * one level further in when a selected group's member was hit, or
       * the one hit element out of a multi-selection.
       */
      readonly clickTarget: ElementId | null;
      moved: boolean;
    }
  | {
      readonly kind: "resizing";
      readonly id: ElementId;
      readonly handle: ResizeHandle;
      readonly startPage: Vec;
      readonly startBox: Box;
      readonly candidates: readonly Box[];
    }
  | { readonly kind: "connecting"; readonly from: ElementId }
  | {
      readonly kind: "reconnecting";
      readonly id: ElementId;
      readonly end: ConnectorEnd;
      /** The endpoint that stays put; never a valid drop target. */
      readonly other: ElementId;
      /** Where the rubber band is pinned, in page space. */
      readonly anchor: Vec;
    }
  | {
      readonly kind: "marquee";
      readonly startPage: Vec;
      /** Selection to keep underneath the brush (shift-drag adds). */
      readonly base: readonly ElementId[];
    };

export interface InteractionOptions {
  readonly tool: Accessor<ToolKind>;
  readonly setTool: (tool: ToolKind) => void;
  readonly container: () => HTMLElement | undefined;
  /** Fires as the marquee rectangle changes; `null` when the drag ends. */
  readonly onMarquee?: (rect: Box | null) => void;
  /** Snapping switches; both off when omitted. */
  readonly snap?: Accessor<SnapSettings>;
  /** Canvas size in CSS pixels, for fit-to-view and zoom anchors. */
  readonly viewport?: Accessor<ViewportSize>;
  /** A double-click, Enter or F2, or a freshly placed text element. */
  readonly onEditRequest?: (id: ElementId, region: EditRegion) => void;
  /** Right-click or Shift+F10; `hit` is the (group-resolved) element. */
  readonly onContextMenu?: (
    at: ContextMenuPoint,
    hit: ElementId | null,
  ) => void;
  /** Timer for nudge coalescing; `setTimeout` when omitted. */
  readonly schedule?: Scheduler;
}

export interface Interaction {
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(event: PointerEvent): void;
  onPointerCancel(event: PointerEvent): void;
  onWheel(event: WheelEvent): void;
  onKeyDown(event: KeyboardEvent): void;
  onKeyUp(event: KeyboardEvent): void;
  onDoubleClick(event: MouseEvent): void;
  onContextMenu(event: MouseEvent): void;
  /** The canvas lost focus: release the temporary hand, close open nudges. */
  onBlur(): void;
  startResize(id: ElementId, handle: ResizeHandle, event: PointerEvent): void;
  /** Drag one end of a connector to another element. */
  startReconnect(id: ElementId, end: ConnectorEnd, event: PointerEvent): void;
  /** Drag a new connector out of `from`, as the edge tool would. */
  startConnect(from: ElementId, event: PointerEvent): void;
  /** Close a pending nudge batch now rather than when its timer fires. */
  flushNudge(): void;
  readonly pending: Accessor<PendingConnection | null>;
  /** The marquee rectangle while brush-selecting, in page space. */
  readonly marquee: Accessor<Box | null>;
  /** Snap guides for the drag in progress; empty between gestures. */
  readonly guides: Accessor<readonly SnapGuide[]>;
  /** The element a connector end would land on if released now. */
  readonly hoverTarget: Accessor<ElementId | null>;
  /** True while space is held and the pointer pans instead of selecting. */
  readonly temporaryHand: Accessor<boolean>;
}

/** True when two boxes overlap at all (touching edges count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

function wheelPixels(delta: number, mode: number): number {
  return mode === 0 ? delta : delta * LINE_HEIGHT;
}

function clampBox(box: Box): Box {
  return {
    x: box.x,
    y: box.y,
    width: Math.max(MIN_SHAPE_SIZE, box.width),
    height: Math.max(MIN_SHAPE_SIZE, box.height),
  };
}

/** Grow the edges the handle owns, then normalize and enforce a minimum. */
export function resizeBox(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): Box {
  const left = handle.includes("w") ? start.x + dx : start.x;
  const right = handle.includes("e")
    ? start.x + start.width + dx
    : start.x + start.width;
  const top = handle.includes("n") ? start.y + dy : start.y;
  const bottom = handle.includes("s")
    ? start.y + start.height + dy
    : start.y + start.height;
  return clampBox(normalizeBox({ x: left, y: top }, { x: right, y: bottom }));
}

/**
 * `resizeBox` with the shift and alt modifiers applied: the aspect ratio is
 * held against the start box, and a centred resize mirrors every owned
 * edge onto its opposite. Both are applied before snapping.
 */
export function resizeBoxConstrained(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  modifiers: ResizeModifiers = {},
): Box {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const mirror = modifiers.fromCenter === true;

  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;
  if (west) {
    left += dx;
    if (mirror) {
      right -= dx;
    }
  }
  if (east) {
    right += dx;
    if (mirror) {
      left -= dx;
    }
  }
  if (north) {
    top += dy;
    if (mirror) {
      bottom -= dy;
    }
  }
  if (south) {
    bottom += dy;
    if (mirror) {
      top -= dy;
    }
  }

  const raw = normalizeBox({ x: left, y: top }, { x: right, y: bottom });
  let width = raw.width;
  let height = raw.height;
  if (modifiers.keepAspect === true && start.width > 0 && start.height > 0) {
    const aspect = start.width / start.height;
    const horizontal = west || east;
    const vertical = north || south;
    if (horizontal && vertical) {
      // A corner follows whichever axis the pointer pushed further.
      if (width / aspect >= height) {
        height = width / aspect;
      } else {
        width = height * aspect;
      }
    } else if (horizontal) {
      height = width / aspect;
    } else {
      width = height * aspect;
    }
  }

  const centerX = start.x + start.width / 2;
  const centerY = start.y + start.height / 2;
  // Where the box is pinned: the centre, or the edge opposite the handle.
  // An edge handle (n, s, e, w) keeps the other axis centred.
  const x = mirror
    ? centerX - width / 2
    : west
      ? start.x + start.width - width
      : east
        ? start.x
        : centerX - width / 2;
  const y = mirror
    ? centerY - height / 2
    : north
      ? start.y + start.height - height
      : south
        ? start.y
        : centerY - height / 2;

  if (modifiers.keepAspect !== true) {
    // Without the aspect constraint the raw box already sits where the
    // pointer put it, including past the opposite edge; a mirrored resize
    // is symmetric about the centre by construction.
    return clampBox(raw);
  }
  return clampBox({ x, y, width, height });
}

/** The edges a resize handle moves, in snapping's vocabulary. */
export function handleEdges(handle: ResizeHandle): ResizeEdges {
  return {
    left: handle.includes("w"),
    right: handle.includes("e"),
    top: handle.includes("n"),
    bottom: handle.includes("s"),
  };
}

function listLength(semantic: unknown, field: string): number {
  if (typeof semantic !== "object" || semantic === null) {
    return 0;
  }
  const value = (semantic as Record<string, unknown>)[field];
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Which part of `element` a point inside `box` falls on (design 3.3). Row
 * indices are clamped to rows that exist; the blank row an empty table or
 * compartment reserves counts as body.
 */
export function editRegionAt(
  element: Element,
  box: Box,
  point: Vec,
): EditRegion {
  const dy = point.y - box.y;
  if (element.type === "erd.table") {
    if (dy < ERD_TABLE_HEADER_HEIGHT) {
      return "title";
    }
    const count = erdColumnCount(element.semantic);
    if (count === 0) {
      return "body";
    }
    const row = Math.floor(
      (dy - ERD_TABLE_HEADER_HEIGHT) / ERD_TABLE_ROW_HEIGHT,
    );
    return { row: Math.max(0, Math.min(count - 1, row)) };
  }
  if (element.type === "uml.class") {
    const nameHeight = umlNameHeight(element.semantic);
    if (dy < nameHeight) {
      return "title";
    }
    const attributes = listLength(element.semantic, "attributes");
    const methods = listLength(element.semantic, "methods");
    const row = Math.max(
      0,
      Math.floor((dy - nameHeight) / UML_CLASS_ROW_HEIGHT),
    );
    const attributeRows = Math.max(1, attributes);
    if (row < attributeRows) {
      return attributes === 0 ? "body" : { row: Math.min(row, attributes - 1) };
    }
    if (methods === 0) {
      return "body";
    }
    return { row: attributes + Math.min(row - attributeRows, methods - 1) };
  }
  return "body";
}

/**
 * True for a key event the canvas must leave alone because something that
 * takes typing owns it: an input, textarea, select or contenteditable. The
 * inline text editor lives inside the canvas, so its keys bubble up here.
 * A missing target (headless tests) is not editable.
 */
export function isEditableTarget(
  target: EventTarget | null | undefined,
): boolean {
  if (!target) {
    return false;
  }
  const node = target as { tagName?: unknown; isContentEditable?: unknown };
  if (typeof node.tagName === "string" && EDITABLE_TAGS.has(node.tagName)) {
    return true;
  }
  return node.isContentEditable === true;
}

/** True when the event started inside the page-space slot layer. */
function insideSlot(target: EventTarget | null | undefined): boolean {
  const node = target as { closest?: unknown } | null | undefined;
  if (!node || typeof node.closest !== "function") {
    return false;
  }
  return (
    (node.closest as (selector: string) => unknown)(`.${SLOT_LAYER_CLASS}`) !==
    null
  );
}

function isConnector(element: Element): boolean {
  return getElementTypeDefinition(element.type)?.category === "edge";
}

/** Something a connector may end on and a drag may snap to. */
function isSolid(element: Element): boolean {
  return !isConnector(element) && !isGroup(element);
}

function boxCentre(box: Box): Vec {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function createInteraction(
  editor: Editor,
  options: InteractionOptions,
): Interaction {
  let gesture: Gesture = { kind: "idle" };
  /** The pointer that owns the canvas, or `null` when none does. */
  let activePointerId: number | null = null;
  const schedule = options.schedule ?? defaultScheduler;
  /** Cancels the timer closing the open nudge batch; `null` when none is open. */
  let cancelNudgeTimer: (() => void) | null = null;
  let spaceHeld = false;
  let toolBeforeSpace: ToolKind = "select";
  /** Where the pointer last went down, for the keyboard context menu. */
  let lastPointer: ContextMenuPoint | null = null;

  const [pending, setPending] = createSignal<PendingConnection | null>(null);
  const [marquee, setMarqueeSignal] = createSignal<Box | null>(null);
  const [guides, setGuides] = createSignal<readonly SnapGuide[]>(NO_GUIDES);
  const [hoverTarget, setHoverTarget] = createSignal<ElementId | null>(null);
  const [temporaryHand, setTemporaryHand] = createSignal(false);

  const setMarquee = (rect: Box | null): void => {
    if (rect === null && marquee() === null) {
      // Clearing an already-clear marquee is a no-op; without this guard
      // every pointer-down would report a phantom `null` to `onMarquee`.
      return;
    }
    setMarqueeSignal(rect);
    options.onMarquee?.(rect);
  };

  const clearGuides = (): void => {
    if (guides().length > 0) {
      setGuides(NO_GUIDES);
    }
  };

  /** Elements on the current page whose bounds overlap `rect`. */
  const elementsIn = (rect: Box): ElementId[] => {
    const out: ElementId[] = [];
    // One context for the whole scan: bounds lookups share the store view.
    const context = editor.createShapeContext();
    for (const element of editor.store.getPageElements(editor.currentPageId)) {
      const bounds = editor.getBounds(element.id, context);
      if (bounds && boxesOverlap(bounds, rect)) {
        out.push(element.id);
      }
    }
    return out;
  };

  /**
   * The topmost solid element under `point`, skipping `excluded`. Unlike
   * `editor.hitTest` this looks past a connector lying over a shape, which
   * is what a connector end being dropped needs.
   */
  const targetUnder = (
    point: Vec,
    excluded: readonly ElementId[],
  ): ElementId | null => {
    const context = editor.createShapeContext();
    const elements = editor.store.getPageElements(editor.currentPageId);
    for (let at = elements.length - 1; at >= 0; at -= 1) {
      const element = elements[at] as Element;
      if (excluded.includes(element.id) || !isSolid(element)) {
        continue;
      }
      if (editor.getShapeUtil(element.type).hitTest(element, point, context)) {
        return element.id;
      }
    }
    return null;
  };

  const viewportSize = (): ViewportSize => {
    const size = options.viewport?.();
    if (size && size.width > 0 && size.height > 0) {
      return size;
    }
    const container = options.container();
    if (container) {
      const rect = container.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }
    return { width: 0, height: 0 };
  };

  const viewportCentre = (): Vec => {
    const size = viewportSize();
    return { x: size.width / 2, y: size.height / 2 };
  };

  /**
   * The viewport grown by one viewport each way, in page space, or `null`
   * when the size is unknown. Snap candidates outside it are skipped
   * (design 6) so a large page stays cheap to drag on.
   */
  const snapWindow = (): Box | null => {
    const size = options.viewport?.();
    if (!size || size.width <= 0 || size.height <= 0) {
      return null;
    }
    return normalizeBox(
      editor.camera.screenToPage({ x: -size.width, y: -size.height }),
      editor.camera.screenToPage({ x: 2 * size.width, y: 2 * size.height }),
    );
  };

  /** Bounds of every solid element on the page except `excluded`. */
  const snapCandidates = (excluded: ReadonlySet<ElementId>): Box[] => {
    const context = editor.createShapeContext();
    const window = snapWindow();
    const out: Box[] = [];
    for (const element of editor.store.getPageElements(editor.currentPageId)) {
      if (excluded.has(element.id) || !isSolid(element)) {
        continue;
      }
      const bounds = context.boundsOf(element.id);
      if (bounds && (window === null || boxesOverlap(bounds, window))) {
        out.push(bounds);
      }
    }
    return out;
  };

  /** Snap parameters for this event, or `null` when snapping is off. */
  const snapFor = (event: {
    readonly metaKey?: boolean;
    readonly ctrlKey?: boolean;
  }): { readonly objects: boolean; readonly options: SnapOptions } | null => {
    const settings = options.snap?.();
    if (!settings || (!settings.grid && !settings.objects)) {
      return null;
    }
    // Cmd/Ctrl held during the gesture disables both kinds (design 3.2).
    if (event.metaKey === true || event.ctrlKey === true) {
      return null;
    }
    const threshold = SNAP_THRESHOLD_PX / editor.camera.get().z;
    return {
      objects: settings.objects,
      options: settings.grid ? { threshold, grid: SNAP_GRID } : { threshold },
    };
  };

  const screenPoint = (event: { clientX: number; clientY: number }): Vec => {
    const container = options.container();
    if (!container) {
      return { x: event.clientX, y: event.clientY };
    }
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pagePoint = (event: { clientX: number; clientY: number }): Vec =>
    editor.camera.screenToPage(screenPoint(event));

  const capture = (event: PointerEvent): void => {
    try {
      options.container()?.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone, or the event was synthesized. Capture is
      // an optimisation - it keeps a drag alive outside the canvas - so
      // losing it must not abort the gesture that was about to start.
    }
  };

  const release = (event: PointerEvent): void => {
    const container = options.container();
    if (container?.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
  };

  const clearTransient = (): void => {
    setPending(null);
    setMarquee(null);
    clearGuides();
    setHoverTarget(null);
  };

  /** Commit whatever the gesture did and return to idle. */
  const finishGesture = (): void => {
    if (gesture.kind === "translating" || gesture.kind === "resizing") {
      editor.endBatch();
    }
    gesture = { kind: "idle" };
    clearTransient();
  };

  /**
   * Return to idle discarding whatever the gesture did, so a half-finished
   * move or resize leaves no trace — not even an undo step.
   */
  const cancelGesture = (): void => {
    if (gesture.kind === "translating" || gesture.kind === "resizing") {
      editor.abortBatch();
    }
    if (gesture.kind === "marquee") {
      // A cancelled brush never happened: the selection it was building goes
      // back to whatever the drag started from.
      editor.selection.set(gesture.base);
    }
    gesture = { kind: "idle" };
    clearTransient();
  };

  // ---------------------------------------------------------------- nudges

  const flushNudge = (): void => {
    if (cancelNudgeTimer === null) {
      return;
    }
    cancelNudgeTimer();
    cancelNudgeTimer = null;
    editor.endBatch();
  };

  /**
   * Move the selection by one step. The first press opens a batch, every
   * press within `NUDGE_COALESCE_MS` of the last restarts the timer that
   * closes it, so holding an arrow key costs one undo step.
   */
  const nudge = (dx: number, dy: number): void => {
    if (gesture.kind !== "idle" || editor.selection.size === 0) {
      // A drag owns the open batch; nudging into it would fold the key
      // presses into the drag's undo step.
      return;
    }
    if (cancelNudgeTimer !== null) {
      cancelNudgeTimer();
    } else {
      editor.beginBatch();
    }
    editor.nudgeSelection(dx, dy);
    cancelNudgeTimer = schedule(() => {
      cancelNudgeTimer = null;
      editor.endBatch();
    }, NUDGE_COALESCE_MS);
  };

  // ----------------------------------------------------------------- space

  const holdSpace = (): void => {
    if (spaceHeld) {
      return;
    }
    spaceHeld = true;
    toolBeforeSpace = options.tool();
    setTemporaryHand(true);
    options.setTool("hand");
  };

  const releaseSpace = (): void => {
    if (!spaceHeld) {
      return;
    }
    spaceHeld = false;
    setTemporaryHand(false);
    // Only undo what `holdSpace` did: a tool picked while space was down
    // (from the toolbar, say) stays.
    if (options.tool() === "hand") {
      options.setTool(toolBeforeSpace);
    }
  };

  /**
   * True when `event` may start a gesture: nothing owns the canvas, this is
   * the pointer that does, or the owner has finished what it was doing.
   *
   * That last case matters because ownership outlives the gesture — Escape
   * ends a drag while the button is still held. Handing the canvas to
   * another pointer then is safe precisely because there is no open batch
   * left to leak, and refusing would wedge a touch device whose next
   * contact always arrives with a fresh pointer id.
   */
  const owns = (event: PointerEvent): boolean =>
    activePointerId === null ||
    activePointerId === event.pointerId ||
    gesture.kind === "idle";

  /**
   * Take ownership for a gesture about to start. Closes anything still
   * open — a nudge batch, or a gesture whose release went missing — so the
   * new gesture's batch is never opened over another.
   */
  const claim = (event: PointerEvent): void => {
    flushNudge();
    finishGesture();
    activePointerId = event.pointerId;
    capture(event);
  };

  const beginTranslate = (
    event: PointerEvent,
    startPage: Vec,
    clickTarget: ElementId | null,
  ): boolean => {
    const origins = new Map<ElementId, Vec>();
    const movable = editor.movableSelection();
    for (const origin of movable) {
      origins.set(origin.id, { x: origin.x, y: origin.y });
    }
    if (origins.size === 0) {
      return false;
    }
    const context = editor.createShapeContext();
    const boxes: Box[] = [];
    for (const id of origins.keys()) {
      const bounds = context.boundsOf(id);
      if (bounds) {
        boxes.push(bounds);
      }
    }
    // Everything the selection reaches stays out of the candidates: a group
    // member must not snap to its own group's other members mid-drag.
    const excluded = new Set<ElementId>(origins.keys());
    for (const id of editor.selection.ids()) {
      excluded.add(id);
    }
    editor.beginBatch();
    gesture = {
      kind: "translating",
      startPage,
      startScreen: screenPoint(event),
      origins,
      startBounds: unionBoxes(boxes),
      candidates: snapCandidates(excluded),
      clickTarget,
      moved: false,
    };
    return true;
  };

  const beginConnect = (from: ElementId, point: Vec): void => {
    gesture = { kind: "connecting", from };
    const bounds = editor.getBounds(from);
    setPending({ from: bounds ? boxCentre(bounds) : point, to: point });
  };

  const placeShape = (point: Vec, tool: ToolKind): void => {
    const creation = creationFor(tool);
    if (!creation) {
      return;
    }
    const draft = editor.buildElement(creation.type, {
      semantic: creation.semantic,
      visual: { x: point.x, y: point.y },
    });
    const box = editor
      .getShapeUtil(creation.type)
      .getBounds(draft, editor.createShapeContext());
    const element: Element = {
      ...draft,
      visual: {
        ...draft.visual,
        x: point.x - (box?.width ?? 0) / 2,
        y: point.y - (box?.height ?? 0) / 2,
      },
    };
    editor.apply([{ type: "createElement", element }]);
    editor.selection.set([element.id]);
    options.setTool("select");
    if (EDIT_ON_CREATE.has(creation.type)) {
      // A text-bearing element is typed into the moment it lands (3.3).
      options.onEditRequest?.(element.id, "body");
    }
  };

  /**
   * Selection for a click on `hit` (design 3.1). Returns what the release
   * should select if the pointer does not travel, or `null` when the press
   * already settled it.
   */
  const selectOnPress = (hit: ElementId, shift: boolean): ElementId | null => {
    const chain = ancestorChain(editor.store, hit);
    const selectedAncestor = chain.find((id) => editor.selection.has(id));
    if (shift) {
      // Shift toggles the unit the user sees: the selected group when one
      // holds the hit, the outermost group otherwise.
      editor.selection.toggle(
        selectedAncestor ?? chain[chain.length - 1] ?? hit,
      );
      return null;
    }
    const target = editor.resolveSelectionTarget(hit);
    if (editor.selection.has(target)) {
      // Already selected: a plain click narrows a multi-selection to it,
      // but only once the release proves it was not the start of a drag.
      return editor.selection.size > 1 ? target : null;
    }
    if (selectedAncestor !== undefined) {
      // Drill in one level, but on release: dragging a selected group by
      // one of its members must move the group, not pick the member.
      return target;
    }
    editor.selection.set([target]);
    return null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    // The inline editor and anything else in the slot layer handle their
    // own pointer; a click in a textarea must not start a marquee under it.
    if (insideSlot(event.target)) {
      return;
    }
    // A second contact while a gesture is running — a middle click during a
    // drag, a second finger, a pen alongside a touch — is not a new gesture.
    // Starting one would open a second history batch and close only one.
    if (!owns(event)) {
      return;
    }
    // The owning pointer pressing again means its release went missing (it
    // happens when the window loses the pointer). Close the stale gesture so
    // the batch it opened is accounted for before this one opens another.
    claim(event);
    options.container()?.focus();
    const tool = options.tool();
    const point = pagePoint(event);
    lastPointer = { screen: screenPoint(event), page: point };

    // Middle button, the hand tool and held space always pan, whatever else
    // is active.
    if (event.button === 1 || tool === "hand" || spaceHeld) {
      gesture = { kind: "panning", lastScreen: screenPoint(event) };
      return;
    }

    if (creationFor(tool)) {
      placeShape(point, tool);
      return;
    }

    if (tool === "edge") {
      const source = targetUnder(point, []);
      if (source) {
        beginConnect(source, point);
      }
      return;
    }

    const hit = editor.hitTest(point);

    if (!hit) {
      // Empty canvas with the select tool starts a marquee; shift keeps the
      // existing selection as the base the brush adds to. Panning stays on
      // the hand tool and the middle button, handled above.
      const base = event.shiftKey ? [...editor.selection.ids()] : [];
      if (!event.shiftKey) {
        editor.selection.clear();
      }
      gesture = { kind: "marquee", startPage: point, base };
      setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }

    const clickTarget = selectOnPress(hit, event.shiftKey);
    if (!beginTranslate(event, point, clickTarget)) {
      if (clickTarget !== null) {
        editor.selection.set([clickTarget]);
      }
      gesture = { kind: "panning", lastScreen: screenPoint(event) };
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    switch (gesture.kind) {
      case "panning": {
        const now = screenPoint(event);
        editor.camera.panBy(
          now.x - gesture.lastScreen.x,
          now.y - gesture.lastScreen.y,
        );
        gesture.lastScreen = now;
        return;
      }
      case "translating": {
        const point = pagePoint(event);
        const screen = screenPoint(event);
        if (
          Math.abs(screen.x - gesture.startScreen.x) > CLICK_SLOP_PX ||
          Math.abs(screen.y - gesture.startScreen.y) > CLICK_SLOP_PX
        ) {
          gesture.moved = true;
        }
        let dx = point.x - gesture.startPage.x;
        let dy = point.y - gesture.startPage.y;
        const snap = snapFor(event);
        if (snap && gesture.startBounds) {
          // The union box of everything moving is what lines up with the
          // neighbours; the same correction then applies to every element.
          const moving: Box = {
            ...gesture.startBounds,
            x: gesture.startBounds.x + dx,
            y: gesture.startBounds.y + dy,
          };
          const result = snapTranslate(
            moving,
            snap.objects ? gesture.candidates : [],
            snap.options,
          );
          dx += result.dx;
          dy += result.dy;
          setGuides(result.guides);
        } else {
          clearGuides();
        }
        editor.moveElements(
          [...gesture.origins].map(([id, origin]) => ({
            id,
            x: origin.x + dx,
            y: origin.y + dy,
          })),
        );
        return;
      }
      case "resizing": {
        const point = pagePoint(event);
        let box = resizeBoxConstrained(
          gesture.startBox,
          gesture.handle,
          point.x - gesture.startPage.x,
          point.y - gesture.startPage.y,
          { keepAspect: event.shiftKey, fromCenter: event.altKey },
        );
        const snap = snapFor(event);
        if (snap) {
          const result = snapResize(
            box,
            handleEdges(gesture.handle),
            snap.objects ? gesture.candidates : [],
            snap.options,
          );
          box = clampBox(result.box);
          setGuides(result.guides);
        } else {
          clearGuides();
        }
        editor.resizeElement(gesture.id, box);
        return;
      }
      case "connecting": {
        const from = editor.getBounds(gesture.from);
        const point = pagePoint(event);
        setPending({ from: from ? boxCentre(from) : point, to: point });
        setHoverTarget(targetUnder(point, [gesture.from]));
        return;
      }
      case "reconnecting": {
        const point = pagePoint(event);
        setPending({ from: gesture.anchor, to: point });
        setHoverTarget(targetUnder(point, [gesture.id, gesture.other]));
        return;
      }
      case "marquee": {
        const point = pagePoint(event);
        const rect = normalizeBox(gesture.startPage, point);
        setMarquee(rect);
        // Selection updates live so both this window and every remote peer
        // watch it grow, not just see the result on release. Only when the
        // membership actually changed, though: Selection.set notifies
        // unconditionally, and in cloud mode every notification becomes an
        // awareness publish — per-pointermove would flood the socket.
        const ids = new Set(gesture.base);
        for (const id of elementsIn(rect)) {
          // A brush picks up groups, not their members (design 3.1).
          ids.add(outermostGroupOf(editor.store, id));
        }
        const current = editor.selection.ids();
        const unchanged =
          editor.selection.size === ids.size &&
          [...current].every((id) => ids.has(id));
        if (!unchanged) {
          editor.selection.set([...ids]);
        }
        return;
      }
      default:
        return;
    }
  };

  /**
   * Point the dragged end of a connector at `target`: one `updateSemantic`
   * carrying the whole payload with that end rewritten. Nothing is written
   * when the end already points there.
   */
  const reconnect = (
    id: ElementId,
    end: ConnectorEnd,
    target: ElementId,
  ): void => {
    const element = editor.store.get(id);
    if (!element) {
      return;
    }
    const current = endpointReaderFor(element.type)(element.semantic);
    if (current && current[end] === target) {
      return;
    }
    const base: Record<string, unknown> =
      typeof element.semantic === "object" && element.semantic !== null
        ? { ...(element.semantic as Record<string, unknown>) }
        : {};
    // An ERD relation names a table (and optionally a column); the column
    // belonged to the old table, so the new endpoint carries none.
    base[end] = element.type === "erd.relation" ? { table: target } : target;
    editor.apply([{ type: "updateSemantic", id, semantic: base }]);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    if (gesture.kind === "connecting") {
      const target = targetUnder(pagePoint(event), [gesture.from]);
      if (target) {
        const created = editor.connectSmart(gesture.from, target);
        if (created) {
          editor.selection.set([created]);
        }
      }
    } else if (gesture.kind === "reconnecting") {
      const target = targetUnder(pagePoint(event), [gesture.id, gesture.other]);
      if (target) {
        reconnect(gesture.id, gesture.end, target);
      }
    } else if (
      gesture.kind === "translating" &&
      !gesture.moved &&
      gesture.clickTarget !== null
    ) {
      editor.selection.set([gesture.clickTarget]);
    }
    release(event);
    activePointerId = null;
    finishGesture();
  };

  /**
   * The system took the pointer away mid-gesture (a palm rejection, a
   * system gesture). Treat it as a cancellation rather than a commit: the
   * user never chose where to drop what they were dragging.
   */
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    release(event);
    activePointerId = null;
    cancelGesture();
  };

  const onWheel = (event: WheelEvent): void => {
    if (insideSlot(event.target)) {
      // Scrolling inside the inline editor scrolls the editor.
      return;
    }
    event.preventDefault();
    const dy = wheelPixels(event.deltaY, event.deltaMode);
    if (event.ctrlKey || event.metaKey) {
      editor.camera.zoomBy(Math.exp(-dy * 0.0015), screenPoint(event));
      return;
    }
    editor.camera.panBy(-wheelPixels(event.deltaX, event.deltaMode), -dy);
  };

  // -------------------------------------------------------------- keyboard

  const requestEditOfSelection = (): boolean => {
    const ids = [...editor.selection.ids()];
    const id = ids.length === 1 ? ids[0] : undefined;
    if (id === undefined || editor.editableField(id) === null) {
      return false;
    }
    options.onEditRequest?.(id, "body");
    return true;
  };

  /** Escape, in order: cancel, drill out of a group, deselect (design 5). */
  const pressEscape = (): void => {
    if (gesture.kind !== "idle") {
      // Abandon the gesture: a half-dragged shape goes back where it
      // started rather than being committed wherever the pointer happens to
      // be. The pointer is still down, so it keeps ownership until it lifts.
      cancelGesture();
      return;
    }
    const ids = [...editor.selection.ids()];
    const only = ids.length === 1 ? ids[0] : undefined;
    if (only !== undefined) {
      const parent = groupOf(editor.store, only);
      if (parent) {
        editor.selection.set([parent.id]);
        return;
      }
    }
    editor.selection.clear();
    options.setTool("select");
  };

  const openContextMenu = (
    at: ContextMenuPoint,
    hit: ElementId | null,
  ): void => {
    options.onContextMenu?.(at, hit);
  };

  /** Right-click: the hit becomes the selection unless it already is. */
  const contextMenuAt = (screen: Vec): void => {
    const page = editor.camera.screenToPage(screen);
    const hit = editor.hitTest(page);
    let reported: ElementId | null = null;
    if (hit) {
      const chain = ancestorChain(editor.store, hit);
      const selected = chain.find((id) => editor.selection.has(id));
      reported = selected ?? chain[chain.length - 1] ?? hit;
      if (selected === undefined) {
        editor.selection.set([reported]);
      }
    }
    openContextMenu({ screen, page }, reported);
  };

  /** Shift+F10: anchored on the selection, else where the pointer last was. */
  const contextMenuFromKeyboard = (): void => {
    const ids = [...editor.selection.ids()];
    const bounds = ids.length > 0 ? editor.getSelectionBounds() : null;
    if (bounds) {
      const page = boxCentre(bounds);
      openContextMenu(
        { screen: editor.camera.pageToScreen(page), page },
        ids[0] ?? null,
      );
      return;
    }
    const screen = lastPointer?.screen ?? viewportCentre();
    contextMenuAt(screen);
  };

  /** Chords with Cmd (macOS) or Ctrl held. Returns false when not ours. */
  const onShortcut = (event: KeyboardEvent, key: string): boolean => {
    switch (key) {
      case "z":
        if (event.shiftKey) {
          editor.redo();
        } else {
          editor.undo();
        }
        return true;
      case "y":
        editor.redo();
        return true;
      case "a":
        editor.selectAll();
        return true;
      case "c":
        editor.copySelection();
        return true;
      case "x":
        editor.cutSelection();
        return true;
      case "v":
        editor.paste();
        return true;
      case "d":
        editor.duplicateSelection();
        return true;
      case "g":
        if (event.shiftKey) {
          editor.ungroupSelection();
        } else {
          editor.groupSelection();
        }
        return true;
      case "]":
        editor.bringToFront();
        return true;
      case "[":
        editor.sendToBack();
        return true;
      case "=":
      case "+":
        editor.zoomIn(viewportCentre());
        return true;
      case "-":
      case "_":
        editor.zoomOut(viewportCentre());
        return true;
      case "0":
        editor.resetZoom(viewportCentre());
        return true;
      default:
        // Anything else (Cmd+Shift+E export, Cmd+S save) belongs to the
        // shell: leave the event untouched so it keeps bubbling.
        return false;
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target) || insideSlot(event.target)) {
      // Typing in the inline editor or an inspector field: a tool letter
      // must insert the letter.
      return;
    }
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const arrow = modifier ? undefined : ARROW_KEYS[key];

    if (!arrow) {
      // Any other key may edit the document; the nudge batch must not
      // swallow that edit into the arrow keys' undo step.
      flushNudge();
    }

    if (key === " " || key === "spacebar" || event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) {
        holdSpace();
      }
      return;
    }

    if (arrow) {
      if (editor.selection.size === 0) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? NUDGE_GRID_STEP : NUDGE_STEP;
      nudge(arrow.x * step, arrow.y * step);
      return;
    }

    if (modifier) {
      if (onShortcut(event, key)) {
        event.preventDefault();
      }
      return;
    }

    switch (key) {
      case "escape":
        event.preventDefault();
        pressEscape();
        return;
      case "enter":
      case "f2":
        if (requestEditOfSelection()) {
          event.preventDefault();
        }
        return;
      case "delete":
      case "backspace":
        if (editor.selection.size > 0) {
          event.preventDefault();
          editor.deleteSelection();
        }
        return;
      case "]":
        event.preventDefault();
        editor.bringForward();
        return;
      case "[":
        event.preventDefault();
        editor.sendBackward();
        return;
      case "f10":
      case "contextmenu":
        if (key === "contextmenu" || event.shiftKey) {
          event.preventDefault();
          contextMenuFromKeyboard();
        }
        return;
      default:
        break;
    }

    if (event.shiftKey) {
      // Shift+digit arrives as the shifted character on most layouts, so
      // the physical key is checked too.
      if (key === "1" || key === "!" || event.code === "Digit1") {
        event.preventDefault();
        editor.zoomToFit(viewportSize());
        return;
      }
      if (key === "2" || key === "@" || event.code === "Digit2") {
        event.preventDefault();
        editor.zoomToSelection(viewportSize());
      }
      return;
    }

    if (!event.altKey) {
      const tool = TOOL_KEYS[key];
      if (tool !== undefined) {
        event.preventDefault();
        options.setTool(tool);
      }
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    // Releasing space is honoured wherever the key comes up: the hand was
    // set by this canvas, and a stuck hand is worse than an early release.
    if (
      event.key === " " ||
      event.key.toLowerCase() === "spacebar" ||
      event.code === "Space"
    ) {
      releaseSpace();
    }
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (insideSlot(event.target)) {
      return;
    }
    const point = pagePoint(event);
    const hit = editor.hitTest(point);
    if (!hit) {
      return;
    }
    const element = editor.store.get(hit);
    const box = editor.getBounds(hit);
    const region = element && box ? editRegionAt(element, box, point) : "body";
    options.onEditRequest?.(hit, region);
  };

  const onContextMenu = (event: MouseEvent): void => {
    if (insideSlot(event.target)) {
      // The textarea keeps its native menu.
      return;
    }
    event.preventDefault();
    if (gesture.kind !== "idle") {
      return;
    }
    flushNudge();
    contextMenuAt(screenPoint(event));
  };

  const onBlur = (): void => {
    releaseSpace();
    flushNudge();
  };

  // --------------------------------------------------------------- handles

  const startResize = (
    id: ElementId,
    handle: ResizeHandle,
    event: PointerEvent,
  ): void => {
    if (!owns(event)) {
      return;
    }
    const startBox = editor.getBounds(id);
    if (!startBox) {
      return;
    }
    event.stopPropagation();
    // Same recovery as `onPointerDown`: never open a batch over an open one.
    claim(event);
    editor.beginBatch();
    gesture = {
      kind: "resizing",
      id,
      handle,
      startPage: pagePoint(event),
      startBox,
      candidates: snapCandidates(new Set([id])),
    };
  };

  const startReconnect = (
    id: ElementId,
    end: ConnectorEnd,
    event: PointerEvent,
  ): void => {
    if (!owns(event)) {
      return;
    }
    const element = editor.store.get(id);
    if (!element) {
      return;
    }
    const reader = endpointReaderFor(element.type);
    const ids = reader(element.semantic);
    const resolved = resolveConnector(
      element,
      editor.createShapeContext(),
      reader,
    );
    if (!ids || !resolved) {
      return;
    }
    event.stopPropagation();
    claim(event);
    const point = pagePoint(event);
    // The end that stays is the rubber band's fixed point.
    const anchor = end === "from" ? resolved.end : resolved.start;
    gesture = {
      kind: "reconnecting",
      id,
      end,
      other: end === "from" ? ids.to : ids.from,
      anchor,
    };
    setPending({ from: anchor, to: point });
  };

  const startConnect = (from: ElementId, event: PointerEvent): void => {
    if (!owns(event) || !editor.store.has(from)) {
      return;
    }
    event.stopPropagation();
    claim(event);
    beginConnect(from, pagePoint(event));
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onWheel,
    onKeyDown,
    onKeyUp,
    onDoubleClick,
    onContextMenu,
    onBlur,
    startResize,
    startReconnect,
    startConnect,
    flushNudge,
    pending,
    marquee,
    guides,
    hoverTarget,
    temporaryHand,
  };
}
