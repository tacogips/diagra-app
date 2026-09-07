import type { Element, ElementId, FrameSemantic, PageId } from "@diagra/ir";
import { compareFractional } from "./fractional.ts";
import { memberIdsOf } from "./group.ts";
import type { ShapeContext } from "./shape-util.ts";
import type { Store } from "./store.ts";

/** Frame membership follows the IR's geometric containment contract. */
export function frameParents(
  store: Store,
  page: PageId,
  context: ShapeContext,
): ReadonlyMap<ElementId, ElementId> {
  const elements = store.getPageElements(page);
  const frames = elements.filter((element) => element.type === "frame");
  const parents = new Map<ElementId, ElementId>();
  const explicitFrames = new Set<ElementId>();
  for (const frame of frames) {
    const members = (frame.semantic as FrameSemantic).memberIds;
    if (!members) continue;
    explicitFrames.add(frame.id);
    for (const child of members) {
      if (
        child === frame.id ||
        store.get(child)?.page !== page ||
        parents.has(child)
      )
        continue;
      let ancestor: string | undefined = frame.id;
      const visited = new Set<string>();
      while (ancestor && ancestor !== child && !visited.has(ancestor)) {
        visited.add(ancestor);
        ancestor = parents.get(ancestor);
      }
      if (ancestor !== child) parents.set(child, frame.id);
    }
  }
  // Explicit membership needs no geometric ownership scan.
  if (explicitFrames.size === frames.length) return parents;
  for (const element of elements) {
    if (parents.has(element.id)) continue;
    const box = context.boundsOf(element.id);
    if (!box) continue;
    let parent: Element | undefined;
    let area = Number.POSITIVE_INFINITY;
    for (const frame of frames) {
      if (explicitFrames.has(frame.id)) continue;
      let ancestor: string | undefined = frame.id;
      const visited = new Set<string>();
      while (ancestor && !visited.has(ancestor) && ancestor !== element.id) {
        visited.add(ancestor);
        ancestor = parents.get(ancestor);
      }
      if (ancestor === element.id) continue;
      if (frame.id === element.id) continue;
      // A frame only owns content drawn above it; overlapping copies must
      // not capture the original's content or form equal-size cycles.
      if (compareFractional(frame.index, element.index) >= 0) continue;
      const bounds = context.boundsOf(frame.id);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
      if (
        box.x < bounds.x ||
        box.y < bounds.y ||
        box.x + box.width > bounds.x + bounds.width ||
        box.y + box.height > bounds.y + bounds.height
      )
        continue;
      const candidateArea = bounds.width * bounds.height;
      if (
        candidateArea < area ||
        (candidateArea === area &&
          parent &&
          compareFractional(frame.index, parent.index) > 0)
      ) {
        parent = frame;
        area = candidateArea;
      }
    }
    if (parent) parents.set(element.id, parent.id);
  }
  return parents;
}

/** Expand frame contents and explicit groups once, even with mixed nesting. */
export function expandContainers(
  store: Store,
  ids: Iterable<ElementId>,
  context: ShapeContext,
): ElementId[] {
  const roots = [...ids];
  if (
    roots.every((id) => {
      const type = store.get(id)?.type;
      return type !== "frame" && type !== "group";
    })
  )
    return [...new Set(roots.filter((id) => store.has(id)))];
  const pages = new Set(roots.map((id) => store.get(id)?.page));
  const children = new Map<ElementId, ElementId[]>();
  for (const page of pages) {
    if (!page) continue;
    for (const [child, parent] of frameParents(store, page, context)) {
      const list = children.get(parent) ?? [];
      list.push(child);
      children.set(parent, list);
    }
  }
  const seen = new Set<ElementId>();
  const visit = (id: ElementId): void => {
    const element = store.get(id);
    if (!element || seen.has(id)) return;
    seen.add(id);
    for (const child of [...memberIdsOf(element), ...(children.get(id) ?? [])])
      visit(child);
  };
  for (const id of roots) visit(id);
  return [...seen];
}
