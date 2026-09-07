import { type ElementId, getElementTypeDefinition } from "@diagra/ir";
import { type Box, rotatedBox, unionBoxes } from "./geometry.ts";
import { intersectClip } from "./clipping.ts";
import { expandContainers } from "./frame-tree.ts";
import type { ShapeContext } from "./shape-util.ts";
import type { Store } from "./store.ts";

/** Visible oriented-box envelopes for framing content, not layout dimensions. */
export function viewBounds(
  store: Store,
  ids: readonly ElementId[],
  context: ShapeContext,
): Box | null {
  const boxes: Box[] = [];
  for (const id of expandContainers(store, ids, context)) {
    const element = store.get(id);
    if (!element || element.type === "group" || context.isHidden?.(id))
      continue;
    const box = context.boundsOf(id);
    if (!box) continue;
    const envelope = rotatedBox(
      box,
      getElementTypeDefinition(element.type)?.category === "edge"
        ? 0
        : (element.visual.rotation ?? 0),
    );
    const clip = context.clipOf?.(id);
    if (clip) {
      const visible = intersectClip(envelope, clip);
      if (visible.width > 0 && visible.height > 0) boxes.push(visible);
    } else boxes.push(envelope);
  }
  return unionBoxes(boxes);
}
