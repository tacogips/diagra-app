// Frames as backdrops for connectors.
//
// Connectors are painted beneath shapes so lines never cover a box's
// content. A frame, though, is a surface: on a page with connectors, a
// frame painted above the connector layer would hide every line drawn
// inside or across it (an ERD grouped into domain frames would show no
// relations at all). Such frames are therefore painted first, below the
// connectors, by the canvas and by SVG export alike. Frames inside groups
// keep their group's paint order.

import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";

/**
 * Ids of the frames to paint beneath connectors, given the visible
 * elements of a page in z-order. Empty when the page has no connector.
 */
export function connectorBackdropIds(
  elements: readonly Element[],
  isGrouped: (id: ElementId) => boolean,
): ReadonlySet<ElementId> {
  const hasConnector = elements.some(
    (element) => getElementTypeDefinition(element.type)?.category === "edge",
  );
  if (!hasConnector) return new Set();
  return new Set(
    elements
      .filter((element) => element.type === "frame" && !isGrouped(element.id))
      .map((element) => element.id),
  );
}
