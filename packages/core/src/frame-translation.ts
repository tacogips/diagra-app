import type { ElementId } from "@diagra/ir";
import { applyCommands, type Command } from "./commands.ts";
import { frameParents } from "./frame-tree.ts";
import { createShapeContext } from "./hit-test.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";

/** Carry untouched child coordinates when a frame moves through any command. */
export function planFrameTranslations(
  before: Store,
  after: Store,
  registry: ShapeUtilRegistry,
): Command[] {
  const parents = new Map<ElementId, ElementId>();
  const context = createShapeContext(before, registry, 1);
  for (const page of before.listPages())
    for (const [child, parent] of frameParents(before, page.id, context))
      parents.set(child, parent);
  const commands: Command[] = [];
  const visited = new Set<ElementId>();
  const visit = (id: ElementId): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const parentId = parents.get(id);
    if (!parentId) return;
    visit(parentId);
    const oldParent = before.get(parentId);
    const newParent = after.get(parentId);
    const old = before.get(id);
    const next = after.get(id);
    if (!oldParent || !newParent || !old || !next || context.isLocked?.(id))
      return;
    const dx = (newParent.visual.x ?? 0) - (oldParent.visual.x ?? 0);
    const dy = (newParent.visual.y ?? 0) - (oldParent.visual.y ?? 0);
    const x =
      dx && next.visual.x !== undefined && next.visual.x === old.visual.x
        ? next.visual.x + dx
        : undefined;
    const y =
      dy && next.visual.y !== undefined && next.visual.y === old.visual.y
        ? next.visual.y + dy
        : undefined;
    if (x === undefined && y === undefined) return;
    const command: Command = {
      type: "updateVisual",
      id,
      visual: {
        ...(x === undefined ? {} : { x }),
        ...(y === undefined ? {} : { y }),
      },
    };
    applyCommands(after, [command]);
    commands.push(command);
  };
  for (const id of parents.keys()) visit(id);
  return commands;
}
