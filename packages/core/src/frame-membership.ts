import type { ElementId, FrameSemantic } from "@diagra/ir";
import type { Command } from "./commands.ts";
import { expandContainers, frameParents } from "./frame-tree.ts";
import { groupOf } from "./group.ts";
import type { ShapeContext } from "./shape-util.ts";
import type { Store } from "./store.ts";

/** Switch a page to explicit frame membership before moving one layer. */
export function planReparent(
  store: Store,
  context: ShapeContext,
  id: ElementId,
  target: ElementId | null,
): Command[] {
  const element = store.get(id);
  const frame = target === null ? undefined : store.get(target);
  if (!element || context.isLocked?.(id) || groupOf(store, id)) return [];
  if (
    target !== null &&
    (!frame ||
      frame.type !== "frame" ||
      frame.page !== element.page ||
      context.isLocked?.(target))
  )
    return [];
  if (
    target !== null &&
    expandContainers(store, [id], context).includes(target)
  )
    return [];
  const parents = frameParents(store, element.page, context);
  const moving = new Set(expandContainers(store, [id], context));
  if ((parents.get(id) ?? null) === target) return [];
  const commands: Command[] = [];
  for (const candidate of store.getPageElements(element.page)) {
    if (candidate.type !== "frame") continue;
    const semantic = candidate.semantic as FrameSemantic;
    // Freeze geometric membership on this page, including enclosing frames:
    // moving to the page must not immediately reattach by containment.
    const members =
      semantic.memberIds ??
      [...parents]
        .filter(([, parent]) => parent === candidate.id)
        .map(([child]) => child);
    const next = moving.has(candidate.id)
      ? [...members]
      : members.filter((child) => !moving.has(child));
    if (candidate.id === target) next.push(id);
    if (semantic.memberIds && JSON.stringify(members) === JSON.stringify(next))
      continue;
    if (context.isLocked?.(candidate.id)) return [];
    commands.push({
      type: "updateSemantic",
      id: candidate.id,
      semantic: { ...semantic, memberIds: next },
    });
  }
  return commands;
}

export function planReorderMember(
  store: Store,
  context: ShapeContext,
  id: ElementId,
  direction: -1 | 1,
): Command[] {
  const element = store.get(id);
  if (!element || context.isLocked?.(id)) return [];
  const parents = frameParents(store, element.page, context);
  const parentId = parents.get(id);
  const parent = parentId ? store.get(parentId) : undefined;
  if (!parent || context.isLocked?.(parent.id)) return [];
  const semantic = parent.semantic as FrameSemantic;
  const members = [
    ...(semantic.memberIds ??
      [...parents]
        .filter(([, owner]) => owner === parent.id)
        .map(([child]) => child)),
  ];
  const at = members.indexOf(id);
  const next = at + direction;
  if (at < 0 || next < 0 || next >= members.length) return [];
  members.splice(at, 1);
  members.splice(next, 0, id);
  return [
    {
      type: "updateSemantic",
      id: parent.id,
      semantic: { ...semantic, memberIds: members },
    },
  ];
}
