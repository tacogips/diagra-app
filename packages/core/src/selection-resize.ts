import type { Element, ElementId, FrameSemantic, Visual } from "@diagra/ir";
import type { Command } from "./commands.ts";
import type { Editor } from "./editor.ts";
import { expandContainers, frameParents } from "./frame-tree.ts";
import { type Box, boxCenter, rotatedBox, unionBoxes } from "./geometry.ts";
import { isGroup, memberIdsOf, selectionUnits } from "./group.ts";
import { aspectSize, supportsAspectRatio } from "./aspect-ratio.ts";

export interface SelectionResizeItem {
  readonly id: ElementId;
  readonly box: Box;
  readonly rotation: number;
}

export interface SelectionResizeSnapshot {
  readonly bounds: Box;
  readonly roots: readonly ElementId[];
  readonly items: readonly SelectionResizeItem[];
  readonly implicitFrames: ReadonlyMap<ElementId, readonly ElementId[]>;
}

function selectedRoots(editor: Editor): ElementId[] | null {
  const context = editor.createShapeContext();
  const selected = selectionUnits(editor.store, editor.selection.ids()).filter(
    (id) => editor.store.has(id),
  );
  if (selected.length < 2) return null;
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
  const first = roots[0] ? editor.store.get(roots[0]) : undefined;
  if (
    roots.length < 2 ||
    !first ||
    roots.some((id) => editor.store.get(id)?.page !== first.page)
  )
    return null;
  return roots;
}

/** Capture the stable geometry a multi-resize gesture scales from. */
export function createSelectionResizeSnapshot(
  editor: Editor,
): SelectionResizeSnapshot | null {
  const roots = selectedRoots(editor);
  if (!roots) return null;
  const context = editor.createShapeContext();
  const items: SelectionResizeItem[] = [];
  const seen = new Set<ElementId>();
  const visiting = new Set<ElementId>();

  const visit = (id: ElementId, nested: boolean): boolean => {
    if (seen.has(id)) return true;
    const element = editor.store.get(id);
    if (!element || context.isLocked?.(id) || context.isHidden?.(id))
      return false;
    if (isGroup(element)) {
      if (visiting.has(id)) return false;
      visiting.add(id);
      const members = memberIdsOf(element);
      if (!members.length) return false;
      for (const member of members) {
        if (!visit(member, true)) return false;
      }
      visiting.delete(id);
      seen.add(id);
      return true;
    }
    // A frame owns how its descendants react to its resized bounds through
    // constraints and auto layout. Treat it as one atom even inside a group.
    // Standalone derived connector/sequence geometry never becomes a resize
    // atom merely because the fallback shape utility has box behaviour.
    if (
      [
        "edge.generic",
        "erd.relation",
        "uml.association",
        "sequence.message",
        "sequence.activation",
      ].includes(element.type)
    )
      return nested;
    const util = editor.getShapeUtil(element.type);
    const box = context.boundsOf(id);
    if (!util.canResize || !util.resize || !box) return false;
    items.push({
      id,
      box,
      rotation: element.visual.rotation ?? 0,
    });
    seen.add(id);
    return true;
  };
  for (const root of roots) if (!visit(root, false)) return null;
  if (!items.length) return null;

  const bounds = unionBoxes(
    items.map((item) => rotatedBox(item.box, item.rotation)),
  );
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  const first = editor.store.get(roots[0] as ElementId);
  if (!first) return null;
  const parents = frameParents(editor.store, first.page, context);
  const directChildren = new Map<ElementId, ElementId[]>();
  for (const [child, parent] of parents) {
    const children = directChildren.get(parent) ?? [];
    children.push(child);
    directChildren.set(parent, children);
  }
  const frames = new Set<ElementId>();
  for (const item of items) {
    if (editor.store.get(item.id)?.type === "frame") frames.add(item.id);
    let parent = parents.get(item.id);
    while (parent) {
      frames.add(parent);
      parent = parents.get(parent);
    }
  }
  const implicitFrames = new Map<ElementId, readonly ElementId[]>();
  for (const id of frames) {
    const frame = editor.store.get(id);
    if (
      frame?.type === "frame" &&
      (frame.semantic as FrameSemantic).memberIds === undefined
    )
      implicitFrames.set(id, directChildren.get(id) ?? []);
  }
  return { bounds, roots, items, implicitFrames };
}

export function canResizeSelection(editor: Editor): boolean {
  return createSelectionResizeSnapshot(editor) !== null;
}

function sameRoots(editor: Editor, expected: readonly ElementId[]): boolean {
  const current = selectedRoots(editor);
  return (
    current !== null &&
    current.length === expected.length &&
    current.every((id, index) => id === expected[index])
  );
}

function scaledItemBox(
  item: SelectionResizeItem,
  source: Box,
  target: Box,
  aspectRatio?: number,
): { readonly box: Box; readonly rotation: number } {
  const sx = target.width / source.width;
  const sy = target.height / source.height;
  const center = boxCenter(item.box);
  const nextCenter = {
    x: target.x + (center.x - source.x) * sx,
    y: target.y + (center.y - source.y) * sy,
  };
  const angle = ((item.rotation % 360) * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  let width = item.box.width * Math.hypot(sx * cosine, sy * sine);
  let height = item.box.height * Math.hypot(sx * sine, sy * cosine);
  if (aspectRatio !== undefined) {
    const size = aspectSize(
      aspectRatio,
      width,
      height,
      Math.abs(sx - 1) >= Math.abs(sy - 1) ? "width" : "height",
    );
    width = size.width;
    height = size.height;
  }
  return {
    box: {
      x: nextCenter.x - width / 2,
      y: nextCenter.y - height / 2,
      width,
      height,
    },
    // Multi-resize changes geometry, not orientation. Preserving this value
    // also lets a resized frame's normal translation/constraint pipeline move
    // its descendants without mistaking the operation for a frame rotation.
    rotation: item.rotation,
  };
}

function resizedVisual(
  element: Element,
  patch: Partial<Visual>,
  rotation: number,
): Visual {
  const links = Object.fromEntries(
    Object.entries(element.visual.numberTokens ?? {}).filter(
      ([field]) =>
        !(field === "width" && patch.width !== undefined) &&
        !(field === "height" && patch.height !== undefined),
    ),
  );
  const { numberTokens: _old, ...rest } = element.visual;
  return {
    ...rest,
    ...patch,
    ...(rotation !== 0 || element.visual.rotation !== undefined
      ? { rotation }
      : {}),
    ...(element.type === "text.note" &&
    element.visual.textResize !== undefined &&
    element.visual.textResize !== "fixed"
      ? { textResize: "fixed" as const }
      : {}),
    ...(Object.keys(links).length ? { numberTokens: links } : {}),
  };
}

/** Apply an absolute target box using geometry captured at gesture start. */
export function resizeSelection(
  editor: Editor,
  snapshot: SelectionResizeSnapshot,
  target: Box,
): boolean {
  if (
    ![target.x, target.y, target.width, target.height].every(Number.isFinite) ||
    target.width <= 0 ||
    target.height <= 0 ||
    !sameRoots(editor, snapshot.roots) ||
    (target.x === snapshot.bounds.x &&
      target.y === snapshot.bounds.y &&
      target.width === snapshot.bounds.width &&
      target.height === snapshot.bounds.height)
  )
    return false;
  const context = editor.createShapeContext();
  const commands: Command[] = [];
  for (const [id, memberIds] of snapshot.implicitFrames) {
    const frame = editor.store.get(id);
    if (
      frame?.type === "frame" &&
      (frame.semantic as FrameSemantic).memberIds === undefined
    )
      commands.push({
        type: "updateSemantic",
        id,
        semantic: { ...(frame.semantic as FrameSemantic), memberIds },
      });
  }
  for (const item of snapshot.items) {
    const element = editor.store.get(item.id);
    if (!element || context.isLocked?.(item.id)) return false;
    const util = editor.getShapeUtil(element.type);
    if (!util.canResize || !util.resize) return false;
    const scaled = scaledItemBox(
      item,
      snapshot.bounds,
      target,
      supportsAspectRatio(element) ? element.visual.aspectRatio : undefined,
    );
    const derivedHeight =
      element.type === "erd.table" || element.type === "uml.class";
    const resizeBox = derivedHeight
      ? {
          ...scaled.box,
          y: boxCenter(scaled.box).y - item.box.height / 2,
          height: item.box.height,
        }
      : scaled.box;
    const patch = util.resize(element, resizeBox).visual;
    commands.push({
      type: "replaceVisual",
      id: item.id,
      visual: resizedVisual(element, patch, scaled.rotation),
    });
  }
  editor.apply(commands);
  return true;
}
