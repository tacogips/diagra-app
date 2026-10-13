// Surfaces as backdrops for connectors.
//
// Connectors are painted beneath shapes so lines never cover a box's
// content. A frame or BPMN container, though, is a surface: on a page with
// connectors, one painted above the connector layer could hide lines drawn
// inside or across it. Such surfaces are therefore painted first, below the
// connectors, by the canvas and by SVG export alike. Surfaces inside groups
// keep their group's paint order.

import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import { memberIdsOf } from "./group.ts";

/** Ids named as members by any group among `elements`. */
export function groupedIds(
  elements: readonly Element[],
): ReadonlySet<ElementId> {
  const grouped = new Set<ElementId>();
  for (const element of elements)
    for (const member of memberIdsOf(element))
      if (member !== element.id) grouped.add(member);
  return grouped;
}

/**
 * Whether `element` is painted as a backdrop on a page that has connectors:
 * an ungrouped frame or BPMN surface (pool, lane, expanded sub-process or
 * group). Connector routing uses the same test, so ignored surfaces are
 * always painted beneath the lines.
 */
export function isConnectorBackdrop(
  element: Element,
  isGrouped: (id: ElementId) => boolean,
): boolean {
  if (isGrouped(element.id)) return false;
  if (
    element.type === "frame" ||
    element.type === "bpmn.participant" ||
    element.type === "bpmn.lane" ||
    element.type === "bpmn.group"
  ) {
    return true;
  }
  return (
    element.type === "bpmn.subProcess" &&
    (element.semantic as Record<string, unknown>).expanded === true
  );
}

/**
 * Ids of frame and BPMN surfaces to paint beneath connectors, given every
 * visible element of a page in z-order (group members included, so a
 * connector inside a group counts). Empty when the page has no connector.
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
      .filter((element) => isConnectorBackdrop(element, isGrouped))
      .map((element) => element.id),
  );
}
