// The canvas: one CSS-transformed viewport holding four layers.
//
//   1. an SVG layer for connectors (drawn under everything, like ink)
//   2. a DOM layer for box shapes
//   3. an SVG overlay for selection outlines, handles and snap guides
//   4. a DOM slot for whatever the shell mounts in page space (the inline
//      text editor); its children take pointer events
//
// The single transform on the viewport is the camera equation
// `screen = (page + camera) * zoom` spelled as `scale(z) translate(x, y)`,
// which is why child coordinates are page coordinates everywhere below.
//
// Layers 1 and 2 do not take pointer events: picking goes through the core's
// hit test so that the transparent corner of an ellipse misses it. Only the
// handles and the slot layer opt back in.

import type {
  Box,
  Editor,
  ShapeContext,
  Vec,
  ViewportSize,
} from "@diagra/core";
import {
  backdropEffectsCss,
  booleanGeometry,
  booleanMaskCss,
  createSelectionResizeSnapshot,
  canRotateElement,
  canRotateSelection,
  rotatePoint,
  rotatedBox,
  boxCenter,
  clipCss,
  effectsCss,
  endpointReaderFor,
  groupOf,
  isGroup,
  memberIdsOf,
  resolveConnector,
  unionBoxes,
} from "@diagra/core";
import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import { resizeCursor } from "./resize-cursor.ts";
import { FreehandInput } from "./FreehandInput.tsx";
import { StrokeHandles } from "./StrokeHandles.tsx";
import { CompoundPathHandles } from "./CompoundPathHandles.tsx";
import { ImageCropHandles } from "./ImageCropHandles.tsx";
import { importRasterFiles } from "./image-import.ts";
import { GradientHandles } from "./GradientHandles.tsx";
import {
  type ConnectorEnd,
  createInteraction,
  type EditRegion,
  type ResizeHandle,
  RESIZE_HANDLES,
  resizeHandlesFor,
  SLOT_LAYER_CLASS,
  type SnapSettings,
} from "./interaction.ts";
import { ConnectorMarkers, ConnectorView } from "./shapes/ConnectorView.tsx";
import { ShapeView } from "./shapes/ShapeView.tsx";
import type { ToolKind } from "./tools.ts";

const CanvasRulers = lazy(() => import("./CanvasRulers.tsx"));

/** Handle side length in CSS pixels; divided by zoom to stay constant. */
const HANDLE_SIZE = 9;
/** Radius of a connector endpoint handle, in CSS pixels. */
const ENDPOINT_HANDLE_RADIUS = 6;
/** Radius of a quick-connect handle, in CSS pixels. */
const CONNECT_HANDLE_RADIUS = 5;
/** Quick-connect handles sit this far outside the bounds (design 3.4). */
const CONNECT_HANDLE_OFFSET = 14;
const GRID_SPACING = 24;

export interface DiagraCanvasProps {
  readonly editor: Editor;
  readonly tool: ToolKind;
  readonly onToolChange?: (tool: ToolKind) => void;
  /** Fires as the marquee rectangle changes; `null` when the drag ends. */
  readonly onMarquee?: (rect: Box | null) => void;
  /** Review tool callback; point is already transformed into page space. */
  readonly onCommentPlace?: (point: Vec) => void;
  /** Snapping switches for drags (design 6). */
  readonly snap: SnapSettings;
  /** False hides the dotted background. */
  readonly showGrid: boolean;
  /** Double-click, Enter/F2, or a freshly placed text element. */
  readonly onEditRequest?: (id: ElementId, region: EditRegion) => void;
  /** Right-click or Shift+F10; `hit` is the group-resolved element. */
  readonly onContextMenu?: (
    at: { readonly screen: Vec; readonly page: Vec },
    hit: ElementId | null,
  ) => void;
  /** Reported on mount and whenever the canvas element changes size. */
  readonly onViewportResize?: (size: ViewportSize) => void;
  /** Rendered in page space above the overlay; receives pointer events. */
  readonly children?: JSX.Element;
}

interface ConnectorHandles {
  readonly id: ElementId;
  readonly start: Vec;
  readonly end: Vec;
  readonly bend?: Vec;
  readonly waypoints?: readonly Vec[];
}

function InlineConnector(props: {
  readonly element: Element;
  readonly context: ShapeContext;
  readonly selected: boolean;
}): JSX.Element {
  const prefix = `canvas-group-${createUniqueId()}-`;
  return (
    <svg
      width="1"
      height="1"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "visible",
        "pointer-events": "none",
      }}
    >
      <title>Grouped connector</title>
      <ConnectorMarkers prefix={prefix} />
      <g
        style={{
          "clip-path": clipCss(
            props.context.clipPolygonOf?.(props.element.id) ??
              props.context.clipOf?.(props.element.id),
          ),
          opacity: props.element.visual.style?.opacity ?? 1,
          filter: effectsCss(props.element.visual.style),
          "backdrop-filter": backdropEffectsCss(props.element.visual.style),
          "mix-blend-mode": props.element.visual.style?.blendMode ?? "normal",
        }}
      >
        <ConnectorView
          element={props.element}
          context={props.context}
          selected={props.selected}
          markerPrefix={prefix}
        />
      </g>
    </svg>
  );
}

type ConnectSide = "n" | "e" | "s" | "w";
const CONNECT_SIDES: readonly ConnectSide[] = ["n", "e", "s", "w"];

function isConnector(element: Element): boolean {
  return getElementTypeDefinition(element.type)?.category === "edge";
}

function handleCenter(
  box: Box,
  handle: ResizeHandle,
): { x: number; y: number } {
  const x = handle.includes("w")
    ? box.x
    : handle.includes("e")
      ? box.x + box.width
      : box.x + box.width / 2;
  const y = handle.includes("n")
    ? box.y
    : handle.includes("s")
      ? box.y + box.height
      : box.y + box.height / 2;
  return { x, y };
}

/** The edge midpoint pushed `offset` page units outward. */
function connectHandleCenter(box: Box, side: ConnectSide, offset: number): Vec {
  switch (side) {
    case "n":
      return { x: box.x + box.width / 2, y: box.y - offset };
    case "s":
      return { x: box.x + box.width / 2, y: box.y + box.height + offset };
    case "w":
      return { x: box.x - offset, y: box.y + box.height / 2 };
    default:
      return { x: box.x + box.width + offset, y: box.y + box.height / 2 };
  }
}

export function DiagraCanvas(props: DiagraCanvasProps): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  let container: HTMLDivElement | undefined;
  const [viewport, setViewport] = createSignal<ViewportSize>({
    width: 0,
    height: 0,
  });
  const [imageDropActive, setImageDropActive] = createSignal(false);
  const [imageImportBusy, setImageImportBusy] = createSignal(false);
  const [imageImportError, setImageImportError] = createSignal("");

  const carriesFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const importDrop = async (event: DragEvent): Promise<void> => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setImageDropActive(false);
    if (imageImportBusy() || props.editor.readOnly) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    const bounds = container?.getBoundingClientRect();
    const point = props.editor.camera.screenToPage({
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    });
    setImageImportBusy(true);
    setImageImportError("");
    try {
      await importRasterFiles(props.editor, files, point);
    } catch (cause) {
      setImageImportError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setImageImportBusy(false);
    }
  };

  const interaction = createInteraction(props.editor, {
    tool: () => props.tool,
    setTool: (tool) => props.onToolChange?.(tool),
    container: () => container,
    onMarquee: (rect) => props.onMarquee?.(rect),
    onCommentPlace: (point) => props.onCommentPlace?.(point),
    snap: () => props.snap,
    viewport,
    onEditRequest: (id, region) => props.onEditRequest?.(id, region),
    onContextMenu: (at, hit) => props.onContextMenu?.(at, hit),
  });

  onMount(() => {
    const element = container;
    if (!element) {
      return;
    }
    element.focus();
    const report = (): void => {
      const rect = element.getBoundingClientRect();
      const size = { width: rect.width, height: rect.height };
      setViewport(size);
      props.onViewportResize?.(size);
    };
    report();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(report);
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    }
  });
  // A nudge batch still waiting on its timer must not outlive the canvas.
  onCleanup(() => interaction.flushNudge());

  const context = createMemo(() => {
    signals.rev();
    return props.editor.createShapeContext(signals.camera().z);
  });

  const elements = createMemo<readonly Element[]>(() => {
    signals.rev();
    return props.editor.store
      .getPageElements(props.editor.currentPageId)
      .filter(
        (element) =>
          !context().isHidden?.(element.id) &&
          !context().isMaskSource?.(element.id),
      );
  });

  const connectors = createMemo(() =>
    elements().filter(
      (element) =>
        isConnector(element) && !groupOf(props.editor.store, element.id),
    ),
  );

  const visualRoots = createMemo(() =>
    elements().filter(
      (element) =>
        !isConnector(element) && !groupOf(props.editor.store, element.id),
    ),
  );

  const isSelected = (id: ElementId): boolean => signals.selection().has(id);

  const boundsOf = (id: ElementId): Box | null => {
    const element = props.editor.store.get(id);
    if (!element) {
      return null;
    }
    return props.editor
      .getShapeUtil(element.type)
      .getBounds(element, context());
  };

  const selectionBoxes = createMemo<readonly (Box & { rotation: number })[]>(
    () => {
      const out: (Box & { rotation: number })[] = [];
      for (const id of signals.selection()) {
        const box = boundsOf(id);
        if (box) {
          const element = props.editor.store.get(id);
          out.push({
            ...box,
            rotation:
              element && !isConnector(element) && !isGroup(element)
                ? (element.visual.rotation ?? 0)
                : 0,
          });
        }
      }
      return out;
    },
  );

  /** The one selected element, or `null` for none or several. */
  const single = createMemo<Element | null>(() => {
    if (readOnly()) return null;
    const ids = [...signals.selection()];
    const id = ids.length === 1 ? ids[0] : undefined;
    if (id === undefined) {
      return null;
    }
    signals.rev();
    if (context().isHidden?.(id) || context().isLocked?.(id)) return null;
    return props.editor.store.get(id) ?? null;
  });

  /** Handles are offered only for a single resizable selection. */
  const resizeTarget = createMemo<{
    id: ElementId;
    box: Box;
    rotation: number;
    handles: readonly ResizeHandle[];
  } | null>(() => {
    if (
      props.tool === "edit.points" ||
      props.tool === "edit.paint" ||
      props.tool === "edit.stroke-paint" ||
      props.tool === "crop"
    )
      return null;
    const element = single();
    if (!element) {
      return null;
    }
    const util = props.editor.getShapeUtil(element.type);
    if (!util.canResize) {
      return null;
    }
    const box = util.getBounds(element, context());
    return box
      ? {
          id: element.id,
          box,
          rotation: element.visual.rotation ?? 0,
          handles: resizeHandlesFor(element.type),
        }
      : null;
  });

  /** A temporary multi-selection scales from one page-axis envelope. */
  const selectionResizeTarget = createMemo<{
    box: Box;
    handles: readonly ResizeHandle[];
  } | null>(() => {
    if (readOnly()) return null;
    if (props.tool !== "select" || signals.selection().size < 2) return null;
    signals.rev();
    const snapshot = createSelectionResizeSnapshot(props.editor);
    return snapshot ? { box: snapshot.bounds, handles: RESIZE_HANDLES } : null;
  });

  /** Endpoint handles for a single selected connector that resolves. */
  const connectorHandles = createMemo<ConnectorHandles | null>(() => {
    const element = single();
    if (!element || !isConnector(element)) {
      return null;
    }
    const resolved = resolveConnector(
      element,
      context(),
      endpointReaderFor(element.type),
    );
    if (!resolved) return null;
    return {
      id: element.id,
      start: resolved.start,
      end: resolved.end,
      ...(resolved.bendPoint ? { bend: resolved.bendPoint } : {}),
      ...(resolved.waypointPoints
        ? { waypoints: resolved.waypointPoints }
        : {}),
    };
  });

  /** Quick-connect handles for a single selected solid element. */
  const connectTarget = createMemo<{
    id: ElementId;
    box: Box;
    rotation: number;
  } | null>(() => {
    if (
      props.tool === "edit.points" ||
      props.tool === "edit.paint" ||
      props.tool === "edit.stroke-paint" ||
      props.tool === "crop"
    )
      return null;
    const element = single();
    if (!element || isConnector(element) || isGroup(element)) {
      return null;
    }
    const box = props.editor
      .getShapeUtil(element.type)
      .getBounds(element, context());
    return box
      ? { id: element.id, box, rotation: element.visual.rotation ?? 0 }
      : null;
  });

  const hoverBox = createMemo<(Box & { rotation: number }) | null>(() => {
    const id = interaction.hoverTarget();
    const box = id === null ? null : boundsOf(id);
    return box && id
      ? { ...box, rotation: props.editor.store.get(id)?.visual.rotation ?? 0 }
      : null;
  });

  const rotateTarget = createMemo<
    | { readonly kind: "element"; readonly id: ElementId; x: number; y: number }
    | {
        readonly kind: "selection";
        readonly center: Vec;
        x: number;
        y: number;
      }
    | null
  >(() => {
    if (readOnly()) return null;
    const selected = [...signals.selection()];
    if (props.tool !== "select") return null;
    if (selected.length > 1) {
      signals.rev();
      if (!canRotateSelection(props.editor)) return null;
      const bounds = unionBoxes(
        selectionBoxes().map(({ rotation, ...box }) =>
          rotatedBox(box, rotation),
        ),
      );
      if (!bounds) return null;
      const center = boxCenter(bounds);
      return {
        kind: "selection",
        center,
        x: center.x,
        y: bounds.y - 32 / signals.camera().z,
      };
    }
    const element = single();
    if (!element || !canRotateElement(element)) return null;
    const box = boundsOf(element.id);
    if (!box) return null;
    const angle = ((element.visual.rotation ?? 0) * Math.PI) / 180;
    const radius = box.height / 2 + 32 / signals.camera().z;
    return {
      kind: "element",
      id: element.id,
      x: box.x + box.width / 2 + Math.sin(angle) * radius,
      y: box.y + box.height / 2 - Math.cos(angle) * radius,
    };
  });

  const cropTarget = createMemo(() => {
    const element = single();
    if (props.tool !== "crop" || element?.type !== "image.raster") return null;
    const box = boundsOf(element.id);
    return box ? { element, box } : null;
  });

  const gradientTarget = createMemo<{
    element: Element;
    box: Box;
    paint: "fill" | "stroke";
  } | null>(() => {
    const element = single();
    const paint =
      props.tool === "edit.paint"
        ? "fill"
        : props.tool === "edit.stroke-paint"
          ? "stroke"
          : null;
    const gradient =
      paint === "fill"
        ? element?.visual.style?.fillGradient
        : paint === "stroke"
          ? element?.visual.style?.strokeGradient
          : undefined;
    if (!element || !paint || !gradient) return null;
    const box = boundsOf(element.id);
    return box ? { element, box, paint } : null;
  });

  const zoom = () => signals.camera().z;
  const handleSize = () => HANDLE_SIZE / zoom();

  const endpointHandle = (
    id: ElementId,
    end: ConnectorEnd,
    at: Vec,
  ): JSX.Element => (
    <circle
      class="diagra-endpoint-handle"
      cx={at.x}
      cy={at.y}
      r={ENDPOINT_HANDLE_RADIUS / zoom()}
      vector-effect="non-scaling-stroke"
      onPointerDown={(event) => interaction.startReconnect(id, end, event)}
      onDblClick={(event) => event.stopPropagation()}
    />
  );

  const renderVisualUnit = (
    element: Element,
    ancestors: ReadonlySet<ElementId> = new Set(),
  ): JSX.Element => {
    if (isGroup(element)) {
      if (ancestors.has(element.id)) return null;
      const nextAncestors = new Set(ancestors).add(element.id);
      const semantic = element.semantic as { isolate?: boolean };
      const boolean = booleanGeometry(element, context());
      const children = memberIdsOf(element).flatMap((id) => {
        const child = props.editor.store.get(id);
        return child &&
          !context().isHidden?.(id) &&
          !context().isMaskSource?.(id)
          ? [child]
          : [];
      });
      const contents = (
        <For each={children}>
          {(child) => renderVisualUnit(child, nextAncestors)}
        </For>
      );
      return boolean ? (
        <div
          data-group-id={element.id}
          data-boolean-operation={boolean.operation}
          style={{
            position: "absolute",
            left: `${boolean.bounds.x}px`,
            top: `${boolean.bounds.y}px`,
            width: `${boolean.bounds.width}px`,
            height: `${boolean.bounds.height}px`,
            overflow: "visible",
            "pointer-events": "none",
            opacity: element.visual.style?.opacity ?? 1,
            filter: effectsCss(element.visual.style),
            "backdrop-filter": backdropEffectsCss(element.visual.style),
            "mix-blend-mode": element.visual.style?.blendMode ?? "normal",
            isolation: semantic.isolate ? "isolate" : undefined,
            "mask-image": booleanMaskCss(boolean),
            "mask-repeat": "no-repeat",
            "mask-size": "100% 100%",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: `${-boolean.bounds.x}px`,
              top: `${-boolean.bounds.y}px`,
              width: "1px",
              height: "1px",
              overflow: "visible",
            }}
          >
            {contents}
          </div>
        </div>
      ) : (
        <div
          data-group-id={element.id}
          style={{
            position: "absolute",
            inset: 0,
            "pointer-events": "none",
            opacity: element.visual.style?.opacity ?? 1,
            filter: effectsCss(element.visual.style),
            "backdrop-filter": backdropEffectsCss(element.visual.style),
            "mix-blend-mode": element.visual.style?.blendMode ?? "normal",
            isolation: semantic.isolate ? "isolate" : undefined,
          }}
        >
          {contents}
        </div>
      );
    }
    if (isConnector(element))
      return (
        <InlineConnector
          element={element}
          context={context()}
          selected={isSelected(element.id)}
        />
      );
    const box = props.editor
      .getShapeUtil(element.type)
      .getBounds(element, context());
    return box ? (
      <div
        style={{
          position: "absolute",
          inset: 0,
          "clip-path": clipCss(
            context().clipPolygonOf?.(element.id) ??
              context().clipOf?.(element.id),
          ),
        }}
      >
        <ShapeView
          element={element}
          box={box}
          selected={isSelected(element.id)}
          showLayoutGrids
        />
      </div>
    ) : null;
  };

  return (
    <div
      ref={container}
      class="diagra-canvas"
      classList={{
        [`diagra-tool-${props.tool.replace(":", "-")}`]: true,
        "diagra-grid-hidden": !props.showGrid,
        "diagra-space-pan": interaction.temporaryHand(),
        "diagra-connecting": interaction.pending() !== null,
        "diagra-image-drop-active": imageDropActive(),
      }}
      tabindex="0"
      style={{
        "background-size": `${GRID_SPACING * signals.camera().z}px ${
          GRID_SPACING * signals.camera().z
        }px`,
        "background-position": `${signals.camera().x * signals.camera().z}px ${
          signals.camera().y * signals.camera().z
        }px`,
      }}
      onPointerDown={interaction.onPointerDown}
      onPointerMove={interaction.onPointerMove}
      onPointerUp={interaction.onPointerUp}
      onPointerCancel={interaction.onPointerCancel}
      onWheel={interaction.onWheel}
      onKeyDown={interaction.onKeyDown}
      onKeyUp={interaction.onKeyUp}
      onDblClick={interaction.onDoubleClick}
      onContextMenu={interaction.onContextMenu}
      onBlur={() => interaction.onBlur()}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setImageDropActive(!props.editor.readOnly);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer)
          event.dataTransfer.dropEffect = props.editor.readOnly
            ? "none"
            : "copy";
        setImageDropActive(!props.editor.readOnly);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (next && event.currentTarget.contains(next as Node)) return;
        setImageDropActive(false);
      }}
      onDrop={(event) => void importDrop(event)}
    >
      <div
        class="diagra-viewport"
        style={{
          transform: `scale(${signals.camera().z}) translate(${
            signals.camera().x
          }px, ${signals.camera().y}px)`,
        }}
      >
        <svg class="diagra-layer diagra-connector-layer">
          <title>Connectors</title>
          <ConnectorMarkers />
          <For each={connectors()}>
            {(element) => (
              <g
                style={{
                  "clip-path": clipCss(
                    context().clipPolygonOf?.(element.id) ??
                      context().clipOf?.(element.id),
                  ),
                  opacity: element.visual.style?.opacity ?? 1,
                  filter: effectsCss(element.visual.style),
                  "backdrop-filter": backdropEffectsCss(element.visual.style),
                  "mix-blend-mode": element.visual.style?.blendMode ?? "normal",
                }}
              >
                <ConnectorView
                  element={element}
                  context={context()}
                  selected={isSelected(element.id)}
                />
              </g>
            )}
          </For>
          <Show when={interaction.pending()}>
            {(pending) => (
              <line
                class="diagra-pending-connection"
                x1={pending().from.x}
                y1={pending().from.y}
                x2={pending().to.x}
                y2={pending().to.y}
              />
            )}
          </Show>
        </svg>

        <div class="diagra-layer diagra-shape-layer">
          <For each={visualRoots()}>
            {(element) => renderVisualUnit(element)}
          </For>
        </div>

        <svg class="diagra-layer diagra-overlay-layer">
          <title>Selection</title>
          <Show when={interaction.marquee()}>
            {(rect) => (
              <rect
                class="diagra-marquee"
                x={rect().x}
                y={rect().y}
                width={rect().width}
                height={rect().height}
                vector-effect="non-scaling-stroke"
              />
            )}
          </Show>
          <For each={selectionBoxes()}>
            {(box) => (
              <rect
                class="diagra-selection-outline"
                transform={
                  box.rotation
                    ? `rotate(${box.rotation} ${box.x + box.width / 2} ${box.y + box.height / 2})`
                    : undefined
                }
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
          <Show when={hoverBox()}>
            {(box) => (
              <rect
                class="diagra-hover-target"
                transform={
                  box().rotation
                    ? `rotate(${box().rotation} ${box().x + box().width / 2} ${box().y + box().height / 2})`
                    : undefined
                }
                x={box().x}
                y={box().y}
                width={box().width}
                height={box().height}
                vector-effect="non-scaling-stroke"
              />
            )}
          </Show>
          <For each={interaction.guides()}>
            {(guide) => (
              <line
                class="diagra-snap-guide"
                x1={guide.axis === "x" ? guide.at : guide.from}
                y1={guide.axis === "x" ? guide.from : guide.at}
                x2={guide.axis === "x" ? guide.at : guide.to}
                y2={guide.axis === "x" ? guide.to : guide.at}
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
          <Show when={selectionResizeTarget()}>
            {(target) => (
              <rect
                class="diagra-selection-outline"
                x={target().box.x}
                y={target().box.y}
                width={target().box.width}
                height={target().box.height}
                vector-effect="non-scaling-stroke"
              />
            )}
          </Show>
          <Show when={resizeTarget()}>
            {(target) => (
              <For each={target().handles}>
                {(handle) => (
                  <rect
                    class="diagra-handle"
                    transform={
                      target().rotation
                        ? `rotate(${target().rotation} ${target().box.x + target().box.width / 2} ${target().box.y + target().box.height / 2})`
                        : undefined
                    }
                    x={handleCenter(target().box, handle).x - handleSize() / 2}
                    y={handleCenter(target().box, handle).y - handleSize() / 2}
                    width={handleSize()}
                    height={handleSize()}
                    style={{ cursor: resizeCursor(handle, target().rotation) }}
                    vector-effect="non-scaling-stroke"
                    onPointerDown={(event) =>
                      interaction.startResize(target().id, handle, event)
                    }
                  />
                )}
              </For>
            )}
          </Show>
          <Show when={selectionResizeTarget()}>
            {(target) => (
              <For each={target().handles}>
                {(handle) => (
                  <rect
                    class="diagra-handle"
                    x={handleCenter(target().box, handle).x - handleSize() / 2}
                    y={handleCenter(target().box, handle).y - handleSize() / 2}
                    width={handleSize()}
                    height={handleSize()}
                    style={{ cursor: resizeCursor(handle, 0) }}
                    vector-effect="non-scaling-stroke"
                    onPointerDown={(event) =>
                      interaction.startResizeSelection(handle, event)
                    }
                  />
                )}
              </For>
            )}
          </Show>
          <Show when={rotateTarget()}>
            {(target) => (
              <circle
                class="diagra-handle"
                cx={target().x}
                cy={target().y}
                r={6 / zoom()}
                style={{ cursor: "grab" }}
                vector-effect="non-scaling-stroke"
                onPointerDown={(event) => {
                  const value = target();
                  if (value.kind === "element")
                    interaction.startRotate(value.id, event);
                  else interaction.startRotateSelection(value.center, event);
                }}
              >
                <title>Rotate selection (Shift: 15° increments)</title>
              </circle>
            )}
          </Show>
          <Show when={connectTarget()}>
            {(target) => (
              <For each={CONNECT_SIDES}>
                {(side) => {
                  const at = () =>
                    rotatePoint(
                      connectHandleCenter(
                        target().box,
                        side,
                        CONNECT_HANDLE_OFFSET / zoom(),
                      ),
                      boxCenter(target().box),
                      target().rotation,
                    );
                  return (
                    <circle
                      class="diagra-connect-handle"
                      cx={at().x}
                      cy={at().y}
                      r={CONNECT_HANDLE_RADIUS / zoom()}
                      vector-effect="non-scaling-stroke"
                      onPointerDown={(event) =>
                        interaction.startConnect(target().id, event)
                      }
                    />
                  );
                }}
              </For>
            )}
          </Show>
          <Show when={connectorHandles()}>
            {(handles) => (
              <>
                {endpointHandle(handles().id, "from", handles().start)}
                {endpointHandle(handles().id, "to", handles().end)}
                <Show when={handles().bend}>
                  {(bend) => (
                    <circle
                      class="diagra-handle"
                      cx={bend().x}
                      cy={bend().y}
                      r={5 / zoom()}
                      style={{ cursor: "move" }}
                      vector-effect="non-scaling-stroke"
                      onPointerDown={(event) =>
                        interaction.startRouteBend(handles().id, event)
                      }
                      onDblClick={(event) => event.stopPropagation()}
                    >
                      <title>Move orthogonal connector channel</title>
                    </circle>
                  )}
                </Show>
                <For each={handles().waypoints ?? []}>
                  {(waypoint, index) => (
                    <circle
                      class="diagra-handle"
                      cx={waypoint.x}
                      cy={waypoint.y}
                      r={5 / zoom()}
                      style={{ cursor: "move" }}
                      vector-effect="non-scaling-stroke"
                      onPointerDown={(event) =>
                        interaction.startRouteWaypoint(
                          handles().id,
                          index(),
                          event,
                        )
                      }
                      onDblClick={(event) => event.stopPropagation()}
                    >
                      <title>Move connector waypoint {index() + 1}</title>
                    </circle>
                  )}
                </For>
              </>
            )}
          </Show>
          <Show
            when={
              props.tool === "edit.points" && single()?.type === "draw.freehand"
                ? single()
                : null
            }
          >
            {(element) => (
              <StrokeHandles
                editor={props.editor}
                element={element()}
                zoom={zoom()}
                toPage={(event) => {
                  const bounds = container?.getBoundingClientRect();
                  return props.editor.camera.screenToPage({
                    x: event.clientX - (bounds?.left ?? 0),
                    y: event.clientY - (bounds?.top ?? 0),
                  });
                }}
              />
            )}
          </Show>
          <Show
            when={
              props.tool === "edit.points" && single()?.type === "draw.path"
                ? single()
                : null
            }
          >
            {(element) => (
              <CompoundPathHandles
                editor={props.editor}
                element={element()}
                zoom={zoom()}
                toPage={(event) => {
                  const bounds = container?.getBoundingClientRect();
                  return props.editor.camera.screenToPage({
                    x: event.clientX - (bounds?.left ?? 0),
                    y: event.clientY - (bounds?.top ?? 0),
                  });
                }}
              />
            )}
          </Show>
          <Show when={cropTarget()}>
            {(target) => (
              <ImageCropHandles
                editor={props.editor}
                element={target().element}
                box={target().box}
                zoom={zoom()}
                toPage={(event) => {
                  const bounds = container?.getBoundingClientRect();
                  return props.editor.camera.screenToPage({
                    x: event.clientX - (bounds?.left ?? 0),
                    y: event.clientY - (bounds?.top ?? 0),
                  });
                }}
              />
            )}
          </Show>
          <Show when={gradientTarget()}>
            {(target) => (
              <GradientHandles
                editor={props.editor}
                element={target().element}
                box={target().box}
                zoom={zoom()}
                paint={target().paint}
                toPage={(event) => {
                  const bounds = container?.getBoundingClientRect();
                  return props.editor.camera.screenToPage({
                    x: event.clientX - (bounds?.left ?? 0),
                    y: event.clientY - (bounds?.top ?? 0),
                  });
                }}
              />
            )}
          </Show>
        </svg>

        <div class={`diagra-layer ${SLOT_LAYER_CLASS}`}>{props.children}</div>
      </div>
      <Show when={!readOnly() && props.tool === "draw.freehand"}>
        <FreehandInput editor={props.editor} />
      </Show>
      <Suspense>
        <CanvasRulers
          editor={props.editor}
          viewport={viewport()}
          container={() => container}
        />
      </Suspense>
      <Show when={imageDropActive() || imageImportBusy()}>
        <div class="diagra-image-drop-overlay" role="status">
          {imageImportBusy()
            ? "Importing images…"
            : "Drop PNG, JPEG, WebP or GIF images"}
        </div>
      </Show>
      <Show when={imageImportError()}>
        <div class="diagra-image-drop-error" role="alert">
          <span>{imageImportError()}</span>
          <button type="button" onClick={() => setImageImportError("")}>
            Dismiss
          </button>
        </div>
      </Show>
    </div>
  );
}
