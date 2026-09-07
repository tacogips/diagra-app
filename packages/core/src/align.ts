// Align, distribute and match size, as commands.
//
// The selection is first reduced to units — a group counts once, with its
// members' union as its box — and each unit is then moved as a whole by
// writing new coordinates to the leaves inside it that have a position.
// Connectors have no position and are skipped; they follow their
// endpoints anyway.

import type { Element, ElementId } from "@diagra/ir";
import type { Command } from "./commands.ts";
import type { Box } from "./geometry.ts";
import { leafElements, selectionUnits } from "./group.ts";
import type { ShapeContext, ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";

export type AlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom";

export type DistributeAxis = "horizontal" | "vertical";

export type SizeDimension = "width" | "height" | "both";

interface Unit {
  readonly id: ElementId;
  readonly box: Box;
  /** Leaves with an explicit position; what a move actually rewrites. */
  readonly leaves: readonly Element[];
}

function positioned(element: Element): boolean {
  return element.visual.x !== undefined && element.visual.y !== undefined;
}

/**
 * Units of the selection that have both bounds and something movable.
 * Order follows the selection's iteration order.
 */
export function selectionUnitsWithBounds(
  store: Store,
  ids: Iterable<ElementId>,
  context: ShapeContext,
): Unit[] {
  const out: Unit[] = [];
  for (const id of selectionUnits(store, ids)) {
    const box = context.boundsOf(id);
    if (!box) {
      continue;
    }
    const leaves = leafElements(store, [id]).filter(positioned);
    if (leaves.length === 0) {
      continue;
    }
    out.push({ id, box, leaves });
  }
  return out;
}

function moveUnit(unit: Unit, dx: number, dy: number): Command[] {
  if (dx === 0 && dy === 0) {
    return [];
  }
  return unit.leaves.map((leaf) => ({
    type: "updateVisual" as const,
    id: leaf.id,
    visual: {
      x: (leaf.visual.x ?? 0) + dx,
      y: (leaf.visual.y ?? 0) + dy,
    },
  }));
}

function extent(units: readonly Unit[]): Box {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const unit of units) {
    left = Math.min(left, unit.box.x);
    top = Math.min(top, unit.box.y);
    right = Math.max(right, unit.box.x + unit.box.width);
    bottom = Math.max(bottom, unit.box.y + unit.box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Commands that align the units of `ids` to `mode`; empty below two. */
export function planAlign(
  store: Store,
  ids: Iterable<ElementId>,
  mode: AlignMode,
  context: ShapeContext,
): Command[] {
  const units = selectionUnitsWithBounds(store, ids, context);
  if (units.length < 2) {
    return [];
  }
  const all = extent(units);
  const commands: Command[] = [];
  for (const unit of units) {
    const { box } = unit;
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case "left":
        dx = all.x - box.x;
        break;
      case "hcenter":
        dx = all.x + all.width / 2 - (box.x + box.width / 2);
        break;
      case "right":
        dx = all.x + all.width - (box.x + box.width);
        break;
      case "top":
        dy = all.y - box.y;
        break;
      case "vcenter":
        dy = all.y + all.height / 2 - (box.y + box.height / 2);
        break;
      case "bottom":
        dy = all.y + all.height - (box.y + box.height);
        break;
    }
    commands.push(...moveUnit(unit, dx, dy));
  }
  return commands;
}

/**
 * Commands that space the units of `ids` evenly along `axis`, keeping the
 * two outermost where they are; empty below three.
 */
export function planDistribute(
  store: Store,
  ids: Iterable<ElementId>,
  axis: DistributeAxis,
  context: ShapeContext,
): Command[] {
  const units = selectionUnitsWithBounds(store, ids, context);
  if (units.length < 3) {
    return [];
  }
  const horizontal = axis === "horizontal";
  const start = (unit: Unit): number => (horizontal ? unit.box.x : unit.box.y);
  const size = (unit: Unit): number =>
    horizontal ? unit.box.width : unit.box.height;
  const sorted = [...units].sort(
    (left, right) =>
      start(left) + size(left) / 2 - (start(right) + size(right) / 2),
  );
  const first = sorted[0] as Unit;
  const last = sorted[sorted.length - 1] as Unit;
  const span = start(last) + size(last) - start(first);
  const occupied = sorted.reduce((sum, unit) => sum + size(unit), 0);
  const gap = (span - occupied) / (sorted.length - 1);

  const commands: Command[] = [];
  let cursor = start(first) + size(first) + gap;
  for (const unit of sorted.slice(1, -1)) {
    const delta = cursor - start(unit);
    commands.push(
      ...(horizontal ? moveUnit(unit, delta, 0) : moveUnit(unit, 0, delta)),
    );
    cursor += size(unit) + gap;
  }
  return commands;
}

/**
 * Commands that give every resizable element in `ids` the first one's
 * width and/or height. Groups are skipped: scaling a group is Wave 2.
 */
export function planMatchSize(
  store: Store,
  registry: ShapeUtilRegistry,
  ids: Iterable<ElementId>,
  dimension: SizeDimension,
  context: ShapeContext,
): Command[] {
  const targets: { element: Element; box: Box }[] = [];
  for (const id of ids) {
    const element = store.get(id);
    if (!element) {
      continue;
    }
    const util = registry.getOrFallback(element.type);
    if (!util.canResize || !util.resize) {
      continue;
    }
    const box = context.boundsOf(id);
    if (box) {
      targets.push({ element, box });
    }
  }
  const reference = targets[0];
  if (!reference || targets.length < 2) {
    return [];
  }
  const commands: Command[] = [];
  for (const target of targets.slice(1)) {
    const width =
      dimension === "height" ? target.box.width : reference.box.width;
    const height =
      dimension === "width" ? target.box.height : reference.box.height;
    if (width === target.box.width && height === target.box.height) {
      continue;
    }
    const util = registry.getOrFallback(target.element.type);
    const patch = util.resize?.(target.element, {
      x: target.box.x,
      y: target.box.y,
      width,
      height,
    });
    if (patch) {
      const links = Object.fromEntries(
        Object.entries(target.element.visual.numberTokens ?? {}).filter(
          ([field]) =>
            !(field === "width" && patch.visual.width !== undefined) &&
            !(field === "height" && patch.visual.height !== undefined),
        ),
      );
      const { numberTokens: _old, ...rest } = target.element.visual;
      commands.push({
        type: "replaceVisual",
        id: target.element.id,
        visual: {
          ...rest,
          ...patch.visual,
          ...(Object.keys(links).length ? { numberTokens: links } : {}),
        },
      });
    }
  }
  return commands;
}
