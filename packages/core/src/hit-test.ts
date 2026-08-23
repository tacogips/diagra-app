// Picking: which element is under a page-space point.
//
// Linear top-down scan over the page's elements. At phase-0 document sizes
// this is well under a frame budget and it keeps the z-order rule exactly
// one line long; a spatial index can slot in behind the same signature.

import type { Element, ElementId, PageId } from "@diagra/ir";
import type { Box, Vec } from "./geometry.ts";
import type { ShapeContext, ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";

/**
 * A {@link ShapeContext} over the current store contents.
 *
 * Bounds are memoized per context because connectors ask for their
 * endpoints' bounds, and a re-entrancy guard returns `null` for reference
 * cycles rather than recursing forever — a document off disk is untrusted
 * and may well contain one.
 */
export function createShapeContext(
  store: Store,
  registry: ShapeUtilRegistry,
  zoom: number,
): ShapeContext {
  const cache = new Map<ElementId, Box | null>();
  const resolving = new Set<ElementId>();
  const context: ShapeContext = {
    zoom,
    resolve: (id) => store.get(id),
    boundsOf: (id) => {
      const cached = cache.get(id);
      if (cached !== undefined) {
        return cached;
      }
      if (resolving.has(id)) {
        return null;
      }
      const element = store.get(id);
      if (!element) {
        cache.set(id, null);
        return null;
      }
      resolving.add(id);
      const box = registry
        .getOrFallback(element.type)
        .getBounds(element, context);
      resolving.delete(id);
      cache.set(id, box);
      return box;
    },
  };
  return context;
}

export interface HitTestOptions {
  readonly zoom?: number;
  /** Reuse a context when several queries share one frame. */
  readonly context?: ShapeContext;
}

/**
 * The topmost element on `pageId` whose shape contains `point`, or `null`.
 * Ties on fractional index break by id descending, matching the store's
 * ordering read back to front.
 */
export function hitTestPoint(
  store: Store,
  registry: ShapeUtilRegistry,
  pageId: PageId,
  point: Vec,
  options: HitTestOptions = {},
): ElementId | null {
  const zoom = options.zoom ?? options.context?.zoom ?? 1;
  const context = options.context ?? createShapeContext(store, registry, zoom);
  const elements: readonly Element[] = store.getPageElements(pageId);
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i] as Element;
    if (registry.getOrFallback(element.type).hitTest(element, point, context)) {
      return element.id;
    }
  }
  return null;
}
