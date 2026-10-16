import type { Editor } from "@nodetto/core";
import { type ElementId, getElementTypeDefinition } from "@nodetto/ir";

function editableConnector(editor: Editor, id: ElementId) {
  const element = editor.store.get(id);
  return !editor.readOnly &&
    element &&
    getElementTypeDefinition(element.type)?.category === "edge" &&
    !editor.createShapeContext().isLocked?.(id)
    ? element
    : null;
}

export function canStraightenConnector(editor: Editor, id: ElementId): boolean {
  const element = editableConnector(editor, id);
  if (!element) return false;
  const semantic = element.semantic as Record<string, unknown>;
  return (
    semantic["routing"] === "orthogonal" ||
    (semantic["routing"] === "manual" &&
      Array.isArray(semantic["routingWaypoints"]) &&
      semantic["routingWaypoints"].length > 0)
  );
}

export function straightConnectorSemantic(
  semantic: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...semantic, routing: "straight" };
  for (const key of [
    "routingWaypoints",
    "routingBend",
    "routingAxis",
    "routingAvoidObstacles",
  ]) {
    delete (next as Record<string, unknown>)[key];
  }
  return next;
}

/** One history entry, preserving endpoints, labels and all other semantics. */
export function straightenConnectors(
  editor: Editor,
  ids: readonly ElementId[],
): void {
  editor.apply(
    ids
      .filter((id) => canStraightenConnector(editor, id))
      .map((id) => ({
        type: "updateSemantic" as const,
        id,
        semantic: straightConnectorSemantic(
          editor.store.get(id)?.semantic as Record<string, unknown>,
        ),
      })),
  );
}

/** Remove only this authored vertex; the last vertex restores straight routing. */
export function removeConnectorWaypoint(
  editor: Editor,
  id: ElementId,
  index: number,
): void {
  const element = editableConnector(editor, id);
  if (!element || !Number.isInteger(index) || index < 0) return;
  const semantic = element.semantic as Record<string, unknown>;
  const points = semantic["routingWaypoints"];
  if (
    semantic["routing"] !== "manual" ||
    !Array.isArray(points) ||
    index >= points.length
  )
    return;
  const next = points.filter((_, at) => at !== index);
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: next.length
        ? { ...semantic, routingWaypoints: next }
        : straightConnectorSemantic(semantic),
    },
  ]);
}
