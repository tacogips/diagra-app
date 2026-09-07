import type { ElementId, FrameSemantic, Visual } from "@diagra/ir";
import { applyCommands, type Command } from "./commands.ts";
import { frameParents } from "./frame-tree.ts";
import { createShapeContext } from "./hit-test.ts";
import { type Box, boxCenter, rotatePoint } from "./geometry.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";
import { textOwnsAxis } from "./text-layout.ts";
import { boundedAspectSize, supportsAspectRatio } from "./aspect-ratio.ts";

function sameRotation(left = 0, right = 0): boolean {
  return (((left - right) % 360) + 360) % 360 === 0;
}

function transformBoxCenter(box: Box, pivot: Box, degrees: number): Box {
  if (!degrees) return box;
  const center = rotatePoint(boxCenter(box), boxCenter(pivot), degrees);
  return {
    x: center.x - box.width / 2,
    y: center.y - box.height / 2,
    width: box.width,
    height: box.height,
  };
}

export function constrainAxis(
  position: number,
  size: number,
  oldSize: number,
  newSize: number,
  mode: Visual["horizontalConstraint"],
): { position: number; size: number } {
  const delta = newSize - oldSize;
  switch (mode) {
    case "end":
      return { position: position + delta, size };
    case "center":
      return { position: position + delta / 2, size };
    case "stretch":
      return { position, size: Math.max(1, size + delta) };
    case "scale": {
      const factor = oldSize > 0 ? newSize / oldSize : 1;
      return { position: position * factor, size: Math.max(1, size * factor) };
    }
    default:
      return { position, size };
  }
}

/** Resize constraints derive from the pre-edit hierarchy; nested frames follow. */
export function planConstraints(
  before: Store,
  after: Store,
  registry: ShapeUtilRegistry,
  onlyIds?: ReadonlySet<ElementId>,
): Command[] {
  const oldContext = createShapeContext(before, registry, 1);
  const parents = new Map<ElementId, ElementId>();
  for (const page of before.listPages())
    for (const [child, parent] of frameParents(before, page.id, oldContext))
      parents.set(child, parent);
  const commands: Command[] = [];
  const visited = new Set<ElementId>();
  const visit = (id: ElementId): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const parentId = parents.get(id);
    if (parentId) visit(parentId);
    if (onlyIds && !onlyIds.has(id)) return;
    const parent = parentId ? after.get(parentId) : undefined;
    const child = after.get(id);
    if (
      !parent ||
      !child ||
      ((parent.semantic as FrameSemantic).layout &&
        child.visual.layoutPosition !== "absolute") ||
      (!child.visual.horizontalConstraint && !child.visual.verticalConstraint)
    )
      return;
    const oldParentBox = parentId ? oldContext.boundsOf(parentId) : null;
    const context = createShapeContext(after, registry, 1);
    const newParentBox = parentId ? context.boundsOf(parentId) : null;
    const oldChildBox = oldContext.boundsOf(id);
    const oldParent = parentId ? before.get(parentId) : undefined;
    if (
      !oldParentBox ||
      !newParentBox ||
      !oldChildBox ||
      !sameRotation(oldParent?.visual.rotation, parent.visual.rotation) ||
      context.isLocked?.(id)
    )
      return;
    if (
      oldParentBox.width === newParentBox.width &&
      oldParentBox.height === newParentBox.height
    )
      return;
    const currentChildBox = context.boundsOf(id);
    if (!currentChildBox) return;
    const rotation = parent.visual.rotation ?? 0;
    const oldLocalChild = transformBoxCenter(
      oldChildBox,
      oldParentBox,
      -rotation,
    );
    const visual = child.visual;
    if (!visual.horizontalConstraint && !visual.verticalConstraint) return;
    const horizontal = constrainAxis(
      oldLocalChild.x - oldParentBox.x,
      oldLocalChild.width,
      oldParentBox.width,
      newParentBox.width,
      visual.horizontalConstraint,
    );
    const vertical = constrainAxis(
      oldLocalChild.y - oldParentBox.y,
      oldLocalChild.height,
      oldParentBox.height,
      newParentBox.height,
      visual.verticalConstraint,
    );
    let width = textOwnsAxis(child, "width")
      ? currentChildBox.width
      : horizontal.size;
    let height = textOwnsAxis(child, "height")
      ? currentChildBox.height
      : vertical.size;
    let x = horizontal.position;
    let y = vertical.position;
    if (visual.aspectRatio !== undefined && supportsAspectRatio(child)) {
      const horizontalChange = oldLocalChild.width
        ? Math.abs(width / oldLocalChild.width - 1)
        : 0;
      const verticalChange = oldLocalChild.height
        ? Math.abs(height / oldLocalChild.height - 1)
        : 0;
      const size = boundedAspectSize(
        visual,
        width,
        height,
        horizontalChange >= verticalChange ? "width" : "height",
      );
      const reposition = (
        position: number,
        oldDerivedSize: number,
        newDerivedSize: number,
        mode: Visual["horizontalConstraint"],
      ): number => {
        const difference = oldDerivedSize - newDerivedSize;
        return mode === "end"
          ? position + difference
          : mode === "center" || mode === "scale"
            ? position + difference / 2
            : position;
      };
      x = reposition(x, width, size.width, visual.horizontalConstraint);
      y = reposition(y, height, size.height, visual.verticalConstraint);
      width = size.width;
      height = size.height;
    }
    const pageTarget = transformBoxCenter(
      {
        x: newParentBox.x + x,
        y: newParentBox.y + y,
        width,
        height,
      },
      newParentBox,
      rotation,
    );
    const patch: Command = {
      type: "updateVisual",
      id,
      visual: {
        x: pageTarget.x,
        y: pageTarget.y,
        ...(registry.getOrFallback(child.type).canResize
          ? {
              width,
              height,
            }
          : {}),
      },
    };
    applyCommands(after, [patch]);
    commands.push(patch);
  };
  for (const element of before.getSnapshot().elements) visit(element.id);
  return commands;
}
