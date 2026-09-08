// Picking: which element is under a page-space point.
//
// Linear top-down scan over the page's elements. At phase-0 document sizes
// this is well under a frame budget and it keeps the z-order rule exactly
// one line long; a spatial index can slot in behind the same signature.

import {
  type Element,
  type ElementId,
  type PageId,
  getElementTypeDefinition,
} from "@diagra/ir";
import type { Box, Vec } from "./geometry.ts";
import type {
  RasterMaskSampler,
  ShapeContext,
  ShapeUtilRegistry,
} from "./shape-util.ts";
import type { Store } from "./store.ts";
import { layerStates } from "./layer-state.ts";
import {
  frameClips,
  insideClip,
  insideRasterMasks,
  layerClipPolygons,
  maskSources,
} from "./clipping.ts";
import {
  booleanGeometry,
  booleanGeometryContains,
} from "./boolean-operations.ts";
import { groupOf } from "./group.ts";

function insideBooleanAncestors(
  store: Store,
  element: Element,
  point: Vec,
  context: ShapeContext,
): boolean {
  const visited = new Set<ElementId>([element.id]);
  let child = element;
  while (true) {
    const parent = groupOf(store, child.id);
    if (!parent || visited.has(parent.id)) return true;
    visited.add(parent.id);
    const geometry = booleanGeometry(parent, context);
    if (geometry && !booleanGeometryContains(geometry, point)) return false;
    child = parent;
  }
}

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
  rasterMaskSample?: RasterMaskSampler,
): ShapeContext {
  const cache = new Map<ElementId, Box | null>();
  const resolving = new Set<ElementId>();
  let states: ReturnType<typeof layerStates> | undefined;
  let clips: ReturnType<typeof frameClips> | undefined;
  let clipPolygons: ReturnType<typeof layerClipPolygons> | undefined;
  let masks: ReadonlySet<ElementId> | undefined;
  const context: ShapeContext = {
    zoom,
    clipOf: (id) => {
      clips ??= frameClips(store, context);
      return clips(id);
    },
    clipPolygonOf: (id) => {
      clipPolygons ??= layerClipPolygons(store, context);
      return clipPolygons(id);
    },
    isMaskSource: (id) => {
      masks ??= maskSources(store, context);
      return masks.has(id);
    },
    rasterMaskSample,
    isHidden: (id) => {
      states ??= layerStates(store, context);
      return states.isHidden(id);
    },
    isLocked: (id) => {
      states ??= layerStates(store, context);
      return states.isLocked(id);
    },
    resolve: (id) => store.get(id),
    elementsOnPage: (pageId) => store.getPageElements(pageId),
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
    if (
      context.isHidden?.(element.id) ||
      context.isLocked?.(element.id) ||
      context.isMaskSource?.(element.id) ||
      !insideClip(context, element.id, point) ||
      !insideRasterMasks(store, element, point, context)
    )
      continue;
    const boolean = booleanGeometry(element, context);
    if (boolean) {
      if (booleanGeometryContains(boolean, point)) return element.id;
      continue;
    }
    // Box views rotate about their own centre. Test in their unrotated page
    // coordinates, after checking clipping in the actual page coordinates.
    // Groups have no view and connector rendering does not apply rotation.
    let shapePoint = point;
    const rotation = element.visual.rotation;
    if (
      rotation &&
      Number.isFinite(rotation) &&
      element.type !== "group" &&
      getElementTypeDefinition(element.type)?.category !== "edge"
    ) {
      const box = context.boundsOf(element.id);
      if (box) {
        const angle = ((rotation % 360) * Math.PI) / 180;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const dx = point.x - cx;
        const dy = point.y - cy;
        shapePoint = {
          x: cx + dx * cosine + dy * sine,
          y: cy - dx * sine + dy * cosine,
        };
      }
    }
    if (
      registry.getOrFallback(element.type).hitTest(element, shapePoint, context)
    ) {
      if (!insideBooleanAncestors(store, element, point, context)) continue;
      return element.id;
    }
  }
  return null;
}
