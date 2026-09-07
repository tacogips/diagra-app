import {
  type Element,
  type ElementId,
  type FrameSemantic,
  getElementTypeDefinition,
  type GroupSemantic,
} from "@diagra/ir";
import type { Command } from "./commands.ts";
import { keyAfter, type Rng } from "./fractional.ts";
import { expandContainers, frameParents } from "./frame-tree.ts";
import { rotatedBox, unionBoxes } from "./geometry.ts";
import { groupOf, isGroup, selectionUnits } from "./group.ts";
import type { ShapeContext } from "./shape-util.ts";
import { frameShapeUtil } from "./shapes/frame.ts";
import type { Store } from "./store.ts";
import { reorderCommands } from "./z-order.ts";

export interface FrameSelectionPlan {
  readonly id: ElementId;
  readonly commands: readonly Command[];
}

interface FrameSelectionTarget {
  readonly ids: readonly ElementId[];
  readonly page: Element["page"];
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly parent: Element | null;
  readonly parentMembers: readonly ElementId[];
}

function cleanFloat(value: number): number {
  const integer = Math.round(value);
  return Math.abs(value - integer) <= 1e-9 ? integer : value;
}

function replaceMembers(
  members: readonly ElementId[],
  selected: ReadonlySet<ElementId>,
  replacement: ElementId,
): ElementId[] {
  const next: ElementId[] = [];
  let inserted = false;
  for (const id of members) {
    if (selected.has(id)) {
      if (!inserted) next.push(replacement);
      inserted = true;
    } else if (!next.includes(id)) next.push(id);
  }
  if (!inserted) next.push(replacement);
  return next;
}

/** Resolve a selection that can become one sibling frame. */
function frameSelectionTarget(
  store: Store,
  ids: Iterable<ElementId>,
  context: ShapeContext,
): FrameSelectionTarget | null {
  const selected = selectionUnits(store, ids).filter((id) => store.has(id));
  if (!selected.length) return null;

  // Frames, unlike groups, were not historically considered by
  // selectionUnits. Drop an explicitly selected descendant of any selected
  // container so it is never added twice to the new hierarchy.
  const covered = new Set<ElementId>();
  for (const id of selected) {
    const element = store.get(id);
    if (!element || (element.type !== "frame" && !isGroup(element))) continue;
    for (const descendant of expandContainers(store, [id], context).slice(1))
      covered.add(descendant);
  }
  const units = selected.filter((id) => !covered.has(id));
  const first = units[0] ? store.get(units[0]) : undefined;
  if (!first) return null;
  const page = first.page;
  if (units.some((id) => store.get(id)?.page !== page)) return null;

  const frames = frameParents(store, page, context);
  const parentOf = (id: ElementId): Element | null => {
    const group = groupOf(store, id);
    if (group) return group;
    const frame = frames.get(id);
    return frame ? (store.get(frame) ?? null) : null;
  };
  const parent = parentOf(first.id);
  if (units.some((id) => parentOf(id)?.id !== parent?.id)) return null;
  if (parent && context.isLocked?.(parent.id)) return null;

  const boxes = expandContainers(store, units, context).flatMap((id) => {
    const element = store.get(id);
    if (
      !element ||
      element.type === "group" ||
      getElementTypeDefinition(element.type)?.category === "resource"
    )
      return [];
    const box = context.boundsOf(id);
    if (!box) return [];
    return [
      getElementTypeDefinition(element.type)?.category === "edge"
        ? box
        : rotatedBox(box, element.visual.rotation ?? 0),
    ];
  });
  const bounds = unionBoxes(boxes);
  if (!bounds) return null;

  let parentMembers: readonly ElementId[] = [];
  if (parent?.type === "group")
    parentMembers = (parent.semantic as GroupSemantic).memberIds;
  else if (parent?.type === "frame")
    parentMembers =
      (parent.semantic as FrameSemantic).memberIds ??
      [...frames]
        .filter(([, owner]) => owner === parent.id)
        .map(([child]) => child);
  return { ids: units, page, bounds, parent, parentMembers };
}

export function canFrameSelection(
  store: Store,
  ids: Iterable<ElementId>,
  context: ShapeContext,
): boolean {
  return frameSelectionTarget(store, ids, context) !== null;
}

/** Create a fitted frame below its selected contents and preserve ownership. */
export function planFrameSelection(
  store: Store,
  ids: Iterable<ElementId>,
  id: ElementId,
  context: ShapeContext,
  rng: Rng,
): FrameSelectionPlan | null {
  if (store.has(id)) return null;
  const target = frameSelectionTarget(store, ids, context);
  if (!target) return null;
  const elements = store.getPageElements(target.page);
  const orderedIds = elements.map((element) => element.id);
  const selected = new Set(target.ids);
  const firstAt = orderedIds.findIndex((candidate) => selected.has(candidate));
  if (firstAt < 0) return null;
  const frame: Element = {
    id,
    page: target.page,
    type: "frame",
    index: keyAfter(elements[elements.length - 1]?.index ?? null, rng),
    semantic: { name: "Frame", memberIds: target.ids },
    visual: {
      ...frameShapeUtil.defaultVisual(),
      x: cleanFloat(target.bounds.x),
      y: cleanFloat(target.bounds.y),
      width: cleanFloat(Math.max(1, target.bounds.width)),
      height: cleanFloat(Math.max(1, target.bounds.height)),
    },
  };
  const desired = [...orderedIds];
  desired.splice(firstAt, 0, id);
  const commands: Command[] = [
    { type: "createElement", element: frame },
    ...reorderCommands([...elements, frame], desired, rng),
  ];
  if (target.parent?.type === "group")
    commands.push({
      type: "updateSemantic",
      id: target.parent.id,
      semantic: {
        ...(target.parent.semantic as GroupSemantic),
        memberIds: replaceMembers(target.parentMembers, selected, id),
      },
    });
  else if (target.parent?.type === "frame")
    commands.push({
      type: "updateSemantic",
      id: target.parent.id,
      semantic: {
        ...(target.parent.semantic as FrameSemantic),
        memberIds: replaceMembers(target.parentMembers, selected, id),
      },
    });
  return { id, commands };
}
