import type { Element, ElementId, FrameSemantic } from "@diagra/ir";
import type { Command } from "./commands.ts";
import type { Editor } from "./editor.ts";
import { expandContainers, frameParents } from "./frame-tree.ts";
import { boxCenter, rotatePoint, rotatedBox, unionBoxes } from "./geometry.ts";
import { isGroup, memberIdsOf, selectionUnits } from "./group.ts";

const ROTATABLE_LEAF_TYPES = new Set([
  "shape.geo",
  "node.generic",
  "text.note",
  "image.raster",
  "draw.freehand",
  "erd.table",
  "uml.class",
]);

function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Containers require descendant transforms; connectors require rotated ports. */
export function canRotateElement(element: Element): boolean {
  return (
    element.type === "frame" ||
    element.type === "group" ||
    ROTATABLE_LEAF_TYPES.has(element.type)
  );
}

function containerChildren(
  editor: Editor,
  root: Element,
): ReadonlyMap<ElementId, readonly ElementId[]> {
  const context = editor.createShapeContext();
  const parents = frameParents(editor.store, root.page, context);
  const frameChildren = new Map<ElementId, ElementId[]>();
  for (const [child, parent] of parents) {
    const children = frameChildren.get(parent) ?? [];
    children.push(child);
    frameChildren.set(parent, children);
  }
  const children = new Map<ElementId, readonly ElementId[]>();
  for (const element of editor.store.getPageElements(root.page)) {
    if (isGroup(element)) children.set(element.id, memberIdsOf(element));
    else if (element.type === "frame")
      children.set(
        element.id,
        (element.semantic as FrameSemantic).memberIds ??
          frameChildren.get(element.id) ??
          [],
      );
  }
  return children;
}

function hasContainerCycle(
  editor: Editor,
  root: Element,
  children: ReadonlyMap<ElementId, readonly ElementId[]>,
): boolean {
  const visiting = new Set<ElementId>();
  const visited = new Set<ElementId>();
  const visit = (id: ElementId): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    const element = editor.store.get(id);
    if (!element || (element.type !== "frame" && !isGroup(element)))
      return false;
    visiting.add(id);
    for (const member of children.get(id) ?? []) {
      if (visit(member)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return visit(root.id);
}

interface SelectionRotationTarget {
  readonly elements: readonly Element[];
  readonly children: ReadonlyMap<ElementId, readonly ElementId[]>;
  readonly pivot: { readonly x: number; readonly y: number };
  readonly parents: ReadonlyMap<ElementId, ElementId>;
}

/** Resolve and validate the independently selected units of a shared rotation. */
function selectionRotationTarget(
  editor: Editor,
  fixedPivot?: { readonly x: number; readonly y: number },
): SelectionRotationTarget | null {
  const context = editor.createShapeContext();
  const selected = selectionUnits(editor.store, editor.selection.ids()).filter(
    (id) => editor.store.has(id),
  );
  if (selected.length < 2) return null;

  // A frame is also a container, but is not part of the group ancestry used
  // by selectionUnits. An explicitly selected descendant must not move twice.
  const covered = new Set<ElementId>();
  for (const id of selected) {
    const element = editor.store.get(id);
    if (!element || (element.type !== "frame" && !isGroup(element))) continue;
    for (const descendant of expandContainers(
      editor.store,
      [id],
      context,
    ).slice(1))
      covered.add(descendant);
  }
  const roots = selected.filter((id) => !covered.has(id));
  if (roots.length < 2) return null;
  const first = roots[0] ? editor.store.get(roots[0]) : undefined;
  if (!first || roots.some((id) => editor.store.get(id)?.page !== first.page))
    return null;

  const children = containerChildren(editor, first);
  for (const id of roots) {
    const element = editor.store.get(id);
    if (
      !element ||
      !canRotateElement(element) ||
      context.isLocked?.(id) ||
      hasContainerCycle(editor, element, children)
    )
      return null;
  }

  const ids = expandContainers(editor.store, roots, context);
  const elements: Element[] = [];
  for (const id of ids) {
    const element = editor.store.get(id);
    if (!element || context.isLocked?.(id)) return null;
    if (
      element.type !== "frame" &&
      !isGroup(element) &&
      element.type !== "edge.generic" &&
      element.type !== "erd.relation" &&
      element.type !== "uml.association" &&
      element.type !== "sequence.message" &&
      !ROTATABLE_LEAF_TYPES.has(element.type)
    )
      return null;
    if (
      !isGroup(element) &&
      ![
        "edge.generic",
        "erd.relation",
        "uml.association",
        "sequence.message",
      ].includes(element.type) &&
      !context.boundsOf(id)
    )
      return null;
    elements.push(element);
  }

  // A frame contributes its own object box. A group contributes its expanded
  // contents because it has no independent geometry in the document model.
  const boxes = roots.flatMap((id) => {
    const root = editor.store.get(id);
    const geometryIds =
      root && isGroup(root)
        ? expandContainers(editor.store, [id], context).slice(1)
        : [id];
    return geometryIds.flatMap((geometryId) => {
      const element = editor.store.get(geometryId);
      if (
        !element ||
        isGroup(element) ||
        [
          "edge.generic",
          "erd.relation",
          "uml.association",
          "sequence.message",
        ].includes(element.type)
      )
        return [];
      const box = context.boundsOf(geometryId);
      return box ? [rotatedBox(box, element.visual.rotation ?? 0)] : [];
    });
  });
  const bounds = unionBoxes(boxes);
  if (!bounds || (fixedPivot && !Number.isFinite(fixedPivot.x + fixedPivot.y)))
    return null;
  return {
    elements,
    children,
    pivot: fixedPivot ?? boxCenter(bounds),
    parents: frameParents(editor.store, first.page, context),
  };
}

/** True when the current multi-selection can rotate as one temporary unit. */
export function canRotateSelection(editor: Editor): boolean {
  return selectionRotationTarget(editor) !== null;
}

/** Rotate the current multi-selection by an incremental angle around its centre. */
export function rotateSelectionBy(
  editor: Editor,
  delta: number,
  fixedPivot?: { readonly x: number; readonly y: number },
): boolean {
  if (!Number.isFinite(delta) || delta === 0) return false;
  const target = selectionRotationTarget(editor, fixedPivot);
  if (!target) return false;
  const context = editor.createShapeContext();
  const commands: Command[] = [];

  // Freeze every implicit frame whose ownership could otherwise change as a
  // consequence of this transform, including unselected ancestor frames.
  const frames = new Set<ElementId>();
  for (const element of target.elements) {
    if (element.type === "frame") frames.add(element.id);
    let parent = target.parents.get(element.id);
    while (parent) {
      frames.add(parent);
      parent = target.parents.get(parent);
    }
  }
  for (const id of frames) {
    const frame = editor.store.get(id);
    if (
      frame?.type === "frame" &&
      (frame.semantic as FrameSemantic).memberIds === undefined
    )
      commands.push({
        type: "updateSemantic",
        id,
        semantic: {
          ...(frame.semantic as FrameSemantic),
          memberIds: target.children.get(id) ?? [],
        },
      });
  }

  for (const element of target.elements) {
    if (isGroup(element)) {
      commands.push({
        type: "updateVisual",
        id: element.id,
        visual: {
          rotation: normalizeRotation((element.visual.rotation ?? 0) + delta),
        },
      });
      continue;
    }
    if (element.type !== "frame" && !ROTATABLE_LEAF_TYPES.has(element.type))
      continue;
    const box = context.boundsOf(element.id);
    if (!box) return false;
    const center = boxCenter(box);
    const next = rotatePoint(center, target.pivot, delta);
    commands.push({
      type: "updateVisual",
      id: element.id,
      visual: {
        x: (element.visual.x ?? box.x) + next.x - center.x,
        y: (element.visual.y ?? box.y) + next.y - center.y,
        rotation: normalizeRotation((element.visual.rotation ?? 0) + delta),
      },
    });
  }
  editor.apply(commands);
  return true;
}

function rotateContainer(
  editor: Editor,
  container: Element,
  degrees: number,
): boolean {
  const context = editor.createShapeContext();
  const children = containerChildren(editor, container);
  if (
    context.isLocked?.(container.id) ||
    hasContainerCycle(editor, container, children)
  )
    return false;
  const box = editor.getBounds(container.id, context);
  if (!box) return false;
  const current = normalizeRotation(container.visual.rotation ?? 0);
  const rotation = normalizeRotation(degrees);
  let delta = rotation - current;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  if (delta === 0) return false;

  const descendants = expandContainers(editor.store, [container.id], context)
    .slice(1)
    .map((id) => editor.store.get(id))
    .filter((element): element is Element => element !== undefined);
  for (const element of descendants) {
    if (context.isLocked?.(element.id)) return false;
    if (
      element.type !== "frame" &&
      !isGroup(element) &&
      element.type !== "edge.generic" &&
      element.type !== "erd.relation" &&
      element.type !== "uml.association" &&
      element.type !== "sequence.message" &&
      !ROTATABLE_LEAF_TYPES.has(element.type)
    )
      return false;
    if (
      !isGroup(element) &&
      ROTATABLE_LEAF_TYPES.has(element.type) &&
      !context.boundsOf(element.id)
    )
      return false;
  }

  const pivot = boxCenter(box);
  const commands: Command[] = [];
  for (const element of [container, ...descendants]) {
    if (
      element.type === "frame" &&
      (element.semantic as FrameSemantic).memberIds === undefined
    )
      commands.push({
        type: "updateSemantic",
        id: element.id,
        semantic: {
          ...(element.semantic as FrameSemantic),
          memberIds: children.get(element.id) ?? [],
        },
      });
  }
  for (const element of descendants) {
    if (isGroup(element)) {
      commands.push({
        type: "updateVisual",
        id: element.id,
        visual: {
          rotation: normalizeRotation((element.visual.rotation ?? 0) + delta),
        },
      });
      continue;
    }
    if (element.type === "frame") {
      const memberBox = context.boundsOf(element.id);
      if (!memberBox) return false;
      const center = boxCenter(memberBox);
      const next = rotatePoint(center, pivot, delta);
      commands.push({
        type: "updateVisual",
        id: element.id,
        visual: {
          x: (element.visual.x ?? memberBox.x) + next.x - center.x,
          y: (element.visual.y ?? memberBox.y) + next.y - center.y,
          rotation: normalizeRotation((element.visual.rotation ?? 0) + delta),
        },
      });
      continue;
    }
    if (!ROTATABLE_LEAF_TYPES.has(element.type)) continue;
    const memberBox = context.boundsOf(element.id);
    if (!memberBox) return false;
    const center = boxCenter(memberBox);
    const next = rotatePoint(center, pivot, delta);
    commands.push({
      type: "updateVisual",
      id: element.id,
      visual: {
        x: (element.visual.x ?? memberBox.x) + next.x - center.x,
        y: (element.visual.y ?? memberBox.y) + next.y - center.y,
        rotation: normalizeRotation((element.visual.rotation ?? 0) + delta),
      },
    });
  }
  commands.push({
    type: "updateVisual",
    id: container.id,
    visual: { rotation },
  });
  editor.apply(commands);
  return true;
}

/** Rotate a leaf about its own center in one undoable operation. */
export function rotateElement(
  editor: Editor,
  id: string,
  degrees: number,
): boolean {
  const element = editor.store.get(id);
  if (
    !element ||
    !canRotateElement(element) ||
    !Number.isFinite(degrees) ||
    editor.createShapeContext().isLocked?.(id)
  )
    return false;
  if (element.type === "group" || element.type === "frame")
    return rotateContainer(editor, element, degrees);
  const rotation = normalizeRotation(degrees);
  if ((element.visual.rotation ?? 0) === rotation) return false;
  editor.apply([{ type: "updateVisual", id, visual: { rotation } }]);
  return true;
}
