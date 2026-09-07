import type { ElementId } from "@diagra/ir";
import { frameParents } from "./frame-tree.ts";
import { memberIdsOf } from "./group.ts";
import type { ShapeContext } from "./shape-util.ts";
import type { Store } from "./store.ts";

/** Inherited state is derived, leaving children's own flags unchanged. */
export function layerStates(store: Store, context: ShapeContext) {
  const parents = new Map<ElementId, ElementId[]>();
  for (const page of store.listPages()) {
    for (const [child, parent] of frameParents(store, page.id, context)) {
      parents.set(child, [parent]);
    }
    for (const element of store.getPageElements(page.id)) {
      for (const child of memberIdsOf(element)) {
        parents.set(child, [...(parents.get(child) ?? []), element.id]);
      }
    }
  }
  const has = (
    id: ElementId,
    flag: "hidden" | "locked",
    seen = new Set<ElementId>(),
  ): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (store.get(id)?.visual[flag] === true) return true;
    return (parents.get(id) ?? []).some((parent) => has(parent, flag, seen));
  };
  return {
    isHidden: (id: ElementId) => has(id, "hidden"),
    isLocked: (id: ElementId) => has(id, "locked"),
  };
}
