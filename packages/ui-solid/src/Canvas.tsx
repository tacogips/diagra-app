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

import type { Box, Editor, Vec, ViewportSize } from "@diagra/core";
import { endpointReaderFor, isGroup, resolveConnector } from "@diagra/core";
import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import {
  type ConnectorEnd,
  createInteraction,
  type EditRegion,
  RESIZE_HANDLES,
  type ResizeHandle,
  SLOT_LAYER_CLASS,
  type SnapSettings,
} from "./interaction.ts";
import { ConnectorMarkers, ConnectorView } from "./shapes/ConnectorView.tsx";
import { ShapeView } from "./shapes/ShapeView.tsx";
import type { ToolKind } from "./tools.ts";

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

interface Placed {
  readonly element: Element;
  readonly box: Box;
}

interface ConnectorHandles {
  readonly id: ElementId;
  readonly start: Vec;
  readonly end: Vec;
}

type ConnectSide = "n" | "e" | "s" | "w";
const CONNECT_SIDES: readonly ConnectSide[] = ["n", "e", "s", "w"];

function isConnector(element: Element): boolean {
  return getElementTypeDefinition(element.type)?.category === "edge";
}

function handleCursor(handle: ResizeHandle): string {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    default:
      return "nesw-resize";
  }
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
  let container: HTMLDivElement | undefined;
  const [viewport, setViewport] = createSignal<ViewportSize>({
    width: 0,
    height: 0,
  });

  const interaction = createInteraction(props.editor, {
    tool: () => props.tool,
    setTool: (tool) => props.onToolChange?.(tool),
    container: () => container,
    onMarquee: (rect) => props.onMarquee?.(rect),
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
    return props.editor.store.getPageElements(props.editor.currentPageId);
  });

  const connectors = createMemo(() => elements().filter(isConnector));

  const shapes = createMemo<readonly Placed[]>(() => {
    const shapeContext = context();
    const out: Placed[] = [];
    for (const element of elements()) {
      if (isConnector(element) || isGroup(element)) {
        continue;
      }
      const box = props.editor
        .getShapeUtil(element.type)
        .getBounds(element, shapeContext);
      if (box) {
        out.push({ element, box });
      }
    }
    return out;
  });

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

  const selectionBoxes = createMemo<readonly Box[]>(() => {
    const out: Box[] = [];
    for (const id of signals.selection()) {
      const box = boundsOf(id);
      if (box) {
        out.push(box);
      }
    }
    return out;
  });

  /** The one selected element, or `null` for none or several. */
  const single = createMemo<Element | null>(() => {
    const ids = [...signals.selection()];
    const id = ids.length === 1 ? ids[0] : undefined;
    if (id === undefined) {
      return null;
    }
    signals.rev();
    return props.editor.store.get(id) ?? null;
  });

  /** Handles are offered only for a single resizable selection. */
  const resizeTarget = createMemo<{ id: ElementId; box: Box } | null>(() => {
    const element = single();
    if (!element) {
      return null;
    }
    const util = props.editor.getShapeUtil(element.type);
    if (!util.canResize) {
      return null;
    }
    const box = util.getBounds(element, context());
    return box ? { id: element.id, box } : null;
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
    return resolved
      ? { id: element.id, start: resolved.start, end: resolved.end }
      : null;
  });

  /** Quick-connect handles for a single selected solid element. */
  const connectTarget = createMemo<{ id: ElementId; box: Box } | null>(() => {
    const element = single();
    if (!element || isConnector(element) || isGroup(element)) {
      return null;
    }
    const box = props.editor
      .getShapeUtil(element.type)
      .getBounds(element, context());
    return box ? { id: element.id, box } : null;
  });

  const hoverBox = createMemo<Box | null>(() => {
    const id = interaction.hoverTarget();
    return id === null ? null : boundsOf(id);
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
    />
  );

  return (
    <div
      ref={container}
      class="diagra-canvas"
      classList={{
        [`diagra-tool-${props.tool.replace(":", "-")}`]: true,
        "diagra-grid-hidden": !props.showGrid,
        "diagra-space-pan": interaction.temporaryHand(),
        "diagra-connecting": interaction.pending() !== null,
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
              <ConnectorView
                element={element}
                context={context()}
                selected={isSelected(element.id)}
              />
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
          <For each={shapes()}>
            {(placed) => (
              <ShapeView
                element={placed.element}
                box={placed.box}
                selected={isSelected(placed.element.id)}
              />
            )}
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
          <Show when={resizeTarget()}>
            {(target) => (
              <For each={RESIZE_HANDLES}>
                {(handle) => (
                  <rect
                    class="diagra-handle"
                    x={handleCenter(target().box, handle).x - handleSize() / 2}
                    y={handleCenter(target().box, handle).y - handleSize() / 2}
                    width={handleSize()}
                    height={handleSize()}
                    style={{ cursor: handleCursor(handle) }}
                    vector-effect="non-scaling-stroke"
                    onPointerDown={(event) =>
                      interaction.startResize(target().id, handle, event)
                    }
                  />
                )}
              </For>
            )}
          </Show>
          <Show when={connectTarget()}>
            {(target) => (
              <For each={CONNECT_SIDES}>
                {(side) => {
                  const at = () =>
                    connectHandleCenter(
                      target().box,
                      side,
                      CONNECT_HANDLE_OFFSET / zoom(),
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
              </>
            )}
          </Show>
        </svg>

        <div class={`diagra-layer ${SLOT_LAYER_CLASS}`}>{props.children}</div>
      </div>
    </div>
  );
}
