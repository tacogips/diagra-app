import type { Document, Element } from "@nodetto/ir";
import { bpmnExportId } from "./ids.ts";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter(
          (key) =>
            key !== "routing" &&
            key !== "routingAxis" &&
            key !== "routingBend" &&
            key !== "routingAvoidObstacles" &&
            key !== "routingWaypoints",
        )
        .map((key) => [key, stable(record[key])]),
    );
  }
  return value;
}

export function bpmnSemanticProjection(
  document: Document,
  pageId: string,
): unknown {
  return document.elements
    .filter(
      (element) => element.page === pageId && element.type.startsWith("bpmn."),
    )
    .map((element) => {
      const semantic = stable(element.semantic) as Record<string, unknown>;
      if (Array.isArray(semantic["definitions"]))
        semantic["definitions"] = (
          semantic["definitions"] as Array<Record<string, unknown>>
        ).map(({ id: _id, ...definition }) => stable(definition));
      return {
        id: bpmnExportId(element),
        type: element.type,
        semantic,
        parent: semantic["parent"] ?? null,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function bpmnElements(
  document: Document,
  pageId: string,
): readonly Element[] {
  return document.elements.filter(
    (element) => element.page === pageId && element.type.startsWith("bpmn."),
  );
}
