// "Tidy layout" and "Remove overlaps", as commands.
//
// The page is treated as a tree of containers: the page itself and every
// frame without auto layout. Each container's direct children (groups count
// once) are arranged on their own, innermost containers first; a frame then
// grows or shrinks to fit its arranged contents, and moves as one box at the
// next level up, carrying its descendants with it. Connectors are never
// moved: they follow their endpoints, and in tidy mode they are the edges of
// the layered layout (an ERD relation points from the referenced table to
// the referencing one, so parents come first). Locked layers stay where
// they are and act as obstacles. Sequence diagrams keep their own ordered
// layout and are left alone.

import {
  type Element,
  type ElementId,
  type FrameSemantic,
  getElementTypeDefinition,
  type PageId,
} from "@diagra/ir";
import {
  type LayoutDirection,
  type LayoutEdge,
  type LayoutNode,
  layeredLayout,
  type OverlapBox,
  separateOverlaps,
} from "./arrange-graph.ts";
import type { Command } from "./commands.ts";
import { frameParents } from "./frame-tree.ts";
import type { Box } from "./geometry.ts";
import { leafElements, outermostGroupOf } from "./group.ts";
import type { ShapeContext } from "./shape-util.ts";
import { endpointReaderFor } from "./shapes/connector.ts";
import type { Store } from "./store.ts";

export type ArrangeMode = "tidy" | "overlaps";

export interface ArrangeOptions {
  readonly mode: ArrangeMode;
  /** Flow direction for tidy layout; left to right by default. */
  readonly direction?: LayoutDirection;
  /**
   * Limit arranging to these layers (resolved to their units). Omitted or
   * empty arranges the whole page.
   */
  readonly scope?: readonly ElementId[];
}

const NODE_GAP = 40;
const LAYER_GAP = 120;
const OVERLAP_GAP = 32;
const FRAME_PADDING = 32;
const FRAME_TITLE_PADDING = 56;
const PAGE = "";
/** Below the JSONL coordinate precision (0.01); never worth a command. */
const MIN_MOVE = 0.005;

interface Unit {
  readonly id: ElementId;
  readonly element: Element;
  /** Container id (a frame) or PAGE. */
  readonly container: string;
  box: Box;
  /** Cannot move: locked, or a frame holding a locked layer. */
  readonly fixed: boolean;
}

export interface Arrangement {
  readonly commands: Command[];
  /**
   * Every element whose final position the commands decide, moved or not.
   * Apply with `{ placed }` so refitting a frame does not carry them again.
   */
  readonly placed: ReadonlySet<ElementId>;
}

function isConnector(element: Element): boolean {
  return getElementTypeDefinition(element.type)?.category === "edge";
}

function isArrangeable(element: Element): boolean {
  return (
    !isConnector(element) &&
    !element.type.startsWith("sequence.") &&
    element.type !== "design.guide"
  );
}

/** A frame whose children this pass may rearrange. */
function isOpenContainer(element: Element): boolean {
  if (element.type !== "frame" || element.visual.locked) return false;
  return (element.semantic as FrameSemantic).layout === undefined;
}

function upstreamFirst(element: Element): readonly [string, string] | null {
  const endpoints = endpointReaderFor(element.type)(element.semantic);
  if (!endpoints) return null;
  const semantic = element.semantic as Record<string, unknown>;
  if (element.type === "erd.relation" && semantic["cardinality"] === "*:1")
    return [endpoints.to, endpoints.from];
  if (element.type === "uml.association" && semantic["kind"] === "inherit")
    return [endpoints.to, endpoints.from];
  return [endpoints.from, endpoints.to];
}

function union(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Commands that tidy or de-overlap a page (or the scoped layers on it), and
 * the elements they position. Empty when nothing would move. Apply as one
 * undoable batch with `{ placed }`, so refitting a frame does not carry
 * children that were deliberately left where they are.
 */
export function planArrangement(
  store: Store,
  pageId: PageId,
  context: ShapeContext,
  options: ArrangeOptions,
): Arrangement {
  const elements = store.getPageElements(pageId);
  const parents = frameParents(store, pageId, context);
  // A frame holding a locked layer anywhere below it cannot move: the
  // locked layer would stay behind (the editor refuses to move it).
  const pinned = new Set<ElementId>();
  for (const element of elements) {
    if (!element.visual.locked) continue;
    for (
      let frame = parents.get(element.id);
      frame !== undefined;
      frame = parents.get(frame)
    )
      pinned.add(frame);
  }
  const units = new Map<ElementId, Unit>();
  const containerOf = (id: ElementId): string => {
    const frame = parents.get(id);
    if (frame === undefined) return PAGE;
    const owner = store.get(frame);
    return owner && isOpenContainer(owner) ? frame : `locked:${frame}`;
  };
  for (const element of elements) {
    if (!isArrangeable(element)) continue;
    const id = outermostGroupOf(store, element.id);
    if (units.has(id)) continue;
    const unitElement = store.get(id);
    const box = context.boundsOf(id);
    if (!unitElement || !box) continue;
    const container = containerOf(id);
    // Content of a closed frame (auto layout or locked) moves with it.
    if (container.startsWith("locked:")) continue;
    units.set(id, {
      id,
      element: unitElement,
      container,
      box: { ...box },
      fixed: leafElements(store, [id]).some(
        (leaf) => leaf.visual.locked || pinned.has(leaf.id),
      ),
    });
  }

  // Descendant units of every container, for moving a frame with its content.
  const childrenOf = new Map<string, Unit[]>();
  for (const unit of units.values())
    childrenOf.set(unit.container, [
      ...(childrenOf.get(unit.container) ?? []),
      unit,
    ]);
  const depthOf = (container: string): number => {
    let depth = 0;
    let current = container;
    while (current !== PAGE) {
      depth += 1;
      current = units.get(current)?.container ?? PAGE;
    }
    return depth;
  };

  // Scope: arrange only the selected units and the containers they are in.
  const scoped = new Set(
    (options.scope ?? []).map((id) => outermostGroupOf(store, id)),
  );
  const inScope = (unit: Unit): boolean => {
    if (!scoped.size) return true;
    let current: string = unit.id;
    while (current !== PAGE) {
      if (scoped.has(current)) return true;
      current = units.get(current)?.container ?? PAGE;
    }
    return false;
  };

  // Connector endpoints resolved to the unit directly inside a container.
  const unitBelow = (id: ElementId, container: string): ElementId | null => {
    let current: string | undefined = outermostGroupOf(store, id);
    while (current !== undefined && current !== PAGE) {
      const unit = units.get(current);
      if (!unit) {
        current = parents.get(current);
        continue;
      }
      if (unit.container === container) return unit.id;
      current = unit.container;
    }
    return null;
  };
  const connectors = elements.filter(isConnector);

  const delta = new Map<ElementId, { dx: number; dy: number }>();
  const resized = new Set<ElementId>();
  const shift = (unit: Unit, dx: number, dy: number): void => {
    if (Math.abs(dx) < MIN_MOVE && Math.abs(dy) < MIN_MOVE) return;
    const previous = delta.get(unit.id) ?? { dx: 0, dy: 0 };
    delta.set(unit.id, { dx: previous.dx + dx, dy: previous.dy + dy });
    unit.box = { ...unit.box, x: unit.box.x + dx, y: unit.box.y + dy };
    // A frame's content travels with it.
    for (const child of childrenOf.get(unit.id) ?? []) shift(child, dx, dy);
  };

  const containers = [...new Set([...units.values()].map((u) => u.container))]
    .filter((container) => container === PAGE || units.has(container))
    .sort((a, b) => depthOf(b) - depthOf(a) || (a < b ? -1 : a > b ? 1 : 0));

  for (const container of containers) {
    const members = (childrenOf.get(container) ?? []).filter(inScope);
    const frame = container === PAGE ? null : (units.get(container) ?? null);
    if (members.length) {
      const movable = members.filter((unit) => !unit.fixed);
      if (options.mode === "tidy" && movable.length > 1) {
        const nodes: LayoutNode[] = movable.map((unit) => ({
          id: unit.id,
          ...unit.box,
        }));
        const edges: LayoutEdge[] = [];
        for (const connector of connectors) {
          const ends = upstreamFirst(connector);
          if (!ends) continue;
          const from = unitBelow(ends[0], container);
          const to = unitBelow(ends[1], container);
          if (from && to && from !== to) edges.push({ from, to });
        }
        const placed = layeredLayout(nodes, edges, {
          direction: options.direction ?? "LR",
          nodeGap: NODE_GAP,
          layerGap: LAYER_GAP,
          componentGap: LAYER_GAP,
        });
        // Keep the arrangement where it was: inside the frame's content
        // area, or at the previous top-left of what was arranged.
        const anchor = frame
          ? {
              x: frame.box.x + FRAME_PADDING,
              y: frame.box.y + FRAME_TITLE_PADDING,
            }
          : (union(movable.map((unit) => unit.box)) as Box);
        for (const unit of movable) {
          const point = placed.get(unit.id);
          if (point)
            shift(
              unit,
              Math.round(anchor.x + point.x) - unit.box.x,
              Math.round(anchor.y + point.y) - unit.box.y,
            );
        }
      }
      if (members.length > 1) {
        const boxes: OverlapBox[] = members.map((unit) => ({
          id: unit.id,
          ...unit.box,
          fixed: unit.fixed,
        }));
        const separated = separateOverlaps(boxes, OVERLAP_GAP);
        for (const unit of members) {
          const point = separated.get(unit.id);
          // Untouched boxes stay exactly where they are; moved ones snap
          // to whole units so a second pass finds nothing to do.
          if (point && (point.x !== unit.box.x || point.y !== unit.box.y))
            shift(
              unit,
              Math.round(point.x) - unit.box.x,
              Math.round(point.y) - unit.box.y,
            );
        }
      }
    }
    // Fit the frame around its arranged content. A frame pinned by a locked
    // descendant still fits (it stays put at the next level up).
    if (frame && !frame.element.visual.locked && members.length) {
      const content = union(
        (childrenOf.get(container) ?? []).map((unit) => unit.box),
      );
      if (content) {
        const fitted: Box =
          options.mode === "tidy"
            ? {
                x: content.x - FRAME_PADDING,
                y: content.y - FRAME_TITLE_PADDING,
                width: content.width + FRAME_PADDING * 2,
                height: content.height + FRAME_TITLE_PADDING + FRAME_PADDING,
              }
            : (union([
                frame.box,
                {
                  x: content.x - FRAME_PADDING,
                  y: content.y - FRAME_TITLE_PADDING,
                  width: content.width + FRAME_PADDING * 2,
                  height: content.height + FRAME_TITLE_PADDING + FRAME_PADDING,
                },
              ]) as Box);
        if (
          fitted.x !== frame.box.x ||
          fitted.y !== frame.box.y ||
          fitted.width !== frame.box.width ||
          fitted.height !== frame.box.height
        ) {
          // The frame's own geometry is written from its final box below;
          // later moves at the parent level still apply to `frame.box`.
          resized.add(frame.id);
          frame.box = fitted;
        }
      }
    }
  }

  // Translate leaves by their unit's accumulated delta (an omitted
  // coordinate renders at 0); frames whose geometry was refitted get their
  // final box instead. Connectors follow their endpoints.
  const commands: Command[] = [];
  // Only units inside a container this pass arranged are positioned here.
  // Content of a frame nested in a group (not a unit itself) is never
  // arranged and must keep following its frame through the editor.
  const arranged = (unit: Unit): boolean => {
    for (let current = unit; current.container !== PAGE; ) {
      const parent = units.get(current.container);
      if (!parent) return false;
      current = parent;
    }
    return true;
  };
  const placed = new Set<ElementId>();
  for (const unit of units.values())
    if (arranged(unit))
      for (const leaf of leafElements(store, [unit.id]))
        if (!isConnector(leaf)) placed.add(leaf.id);
  for (const [id, { dx, dy }] of delta) {
    const unit = units.get(id) as Unit;
    if (dx === 0 && dy === 0) continue;
    for (const leaf of leafElements(store, [unit.id])) {
      if (resized.has(leaf.id) || isConnector(leaf)) continue;
      commands.push({
        type: "updateVisual",
        id: leaf.id,
        visual: {
          x: (leaf.visual.x ?? 0) + dx,
          y: (leaf.visual.y ?? 0) + dy,
        },
      });
    }
  }
  for (const id of resized) {
    const element = store.get(id) as Element;
    const original = context.boundsOf(id) as Box;
    const final = (units.get(id) as Unit).box;
    commands.push({
      type: "updateVisual",
      id,
      visual: {
        x: (element.visual.x ?? original.x) + (final.x - original.x),
        y: (element.visual.y ?? original.y) + (final.y - original.y),
        width: final.width,
        height: final.height,
      },
    });
  }
  return { commands, placed };
}
