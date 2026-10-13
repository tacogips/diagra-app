import type { Element } from "@diagra/ir";
import type { Editor } from "../editor.ts";
import type { Vec } from "../geometry.ts";
import { endpointReaderFor, resolveConnector } from "../shapes/connector.ts";

export function bpmnRouteResolver(
  editor: Editor,
): (edge: Element) => readonly Vec[] | undefined {
  return (edge) =>
    resolveConnector(
      edge,
      editor.createShapeContext(),
      endpointReaderFor(edge.type),
    )?.points;
}
