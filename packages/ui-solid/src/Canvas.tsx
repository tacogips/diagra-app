// The canvas: one CSS-transformed viewport holding three layers.
//
//   1. an SVG layer for connectors (drawn under everything, like ink)
//   2. a DOM layer for box shapes
//   3. an SVG overlay for selection outlines and resize handles
//
// The single transform on the viewport is the camera equation
// `screen = (page + camera) * zoom` spelled as `scale(z) translate(x, y)`,
// which is why child coordinates are page coordinates everywhere below.
//
// Layers 1 and 2 do not take pointer events: picking goes through the core's
// hit test so that the transparent corner of an ellipse misses it. Only the
// resize handles opt back in.

import type { Box, Editor } from "@diagra/core";
import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import { createMemo, For, type JSX, onMount, Show } from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import {
  createInteraction,
  RESIZE_HANDLES,
  type ResizeHandle,
} from "./interaction.ts";
import { ConnectorMarkers, ConnectorView } from "./shapes/ConnectorView.tsx";
import { ShapeView } from "./shapes/ShapeView.tsx";
import type { ToolKind } from "./tools.ts";

/** Handle side length in CSS pixels; divided by zoom to stay constant. */
const HANDLE_SIZE = 9;
const GRID_SPACING = 24;

export interface DiagraCanvasProps {
  readonly editor: Editor;
  readonly tool: ToolKind;
  readonly onToolChange?: (tool: ToolKind) => void;
  /** Fires as the marquee rectangle changes; `null` when the drag ends. */
  readonly onMarquee?: (rect: Box | null) => void;
}

interface Placed {
  readonly element: Element;
  readonly box: Box;
}

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

export function DiagraCanvas(props: DiagraCanvasProps): JSX.Element {
  const signals = createEditorSignals(props.editor);
  let container: HTMLDivElement | undefined;

  const interaction = createInteraction(props.editor, {
    tool: () => props.tool,
    setTool: (tool) => props.onToolChange?.(tool),
    container: () => container,
    onMarquee: (rect) => props.onMarquee?.(rect),
  });

  onMount(() => container?.focus());

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
      if (isConnector(element)) {
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

  const selectionBoxes = createMemo<readonly Box[]>(() => {
    const shapeContext = context();
    const out: Box[] = [];
    for (const id of signals.selection()) {
      const element = props.editor.store.get(id);
      if (!element) {
        continue;
      }
      const box = props.editor
        .getShapeUtil(element.type)
        .getBounds(element, shapeContext);
      if (box) {
        out.push(box);
      }
    }
    return out;
  });

  /** Handles are offered only for a single resizable selection. */
  const resizeTarget = createMemo<{ id: ElementId; box: Box } | null>(() => {
    const ids = [...signals.selection()];
    const id = ids.length === 1 ? ids[0] : undefined;
    if (id === undefined) {
      return null;
    }
    const element = props.editor.store.get(id);
    if (!element) {
      return null;
    }
    const util = props.editor.getShapeUtil(element.type);
    if (!util.canResize) {
      return null;
    }
    const box = util.getBounds(element, context());
    return box ? { id, box } : null;
  });

  const handleSize = () => HANDLE_SIZE / signals.camera().z;

  return (
    <div
      ref={container}
      class="diagra-canvas"
      classList={{ [`diagra-tool-${props.tool.replace(":", "-")}`]: true }}
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
        </svg>
      </div>
    </div>
  );
}
