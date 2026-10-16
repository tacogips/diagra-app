import {
  DATABASE_OBJECT_LABELS,
  type DatabaseObjectSemantic,
  type Element,
} from "@nodetto/ir";
import { boxContains, type Box } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";

export function databaseObjectRows(element: Element): readonly string[] {
  const semantic = element.semantic as DatabaseObjectSemantic;
  if (element.type === "erd.view" || element.type === "erd.materialized-view")
    return (semantic.columns ?? []).map(
      (column) => `${column.name}: ${column.dataType}`,
    );
  return [
    ...(semantic.parameters ?? []).map(
      (parameter) =>
        `${parameter.mode && parameter.mode !== "in" ? `${parameter.mode.toUpperCase()} ` : ""}${parameter.name}: ${parameter.dataType}`,
    ),
    ...(element.type === "erd.function"
      ? [`Returns: ${semantic.returnType || "(not set)"}`]
      : []),
  ];
}
export function databaseObjectBounds(element: Element): Box {
  return {
    x: element.visual.x ?? 0,
    y: element.visual.y ?? 0,
    width: element.visual.width ?? 260,
    height: 52 + Math.max(1, databaseObjectRows(element).length) * 24,
  };
}
export const databaseObjectShapeUtils: readonly ShapeUtil[] = Object.entries(
  DATABASE_OBJECT_LABELS,
).map(([type, label]) => ({
  type,
  canResize: true,
  getBounds: databaseObjectBounds,
  hitTest: (element, point) =>
    boxContains(databaseObjectBounds(element), point),
  resize: (_element, box) => ({
    visual: { x: box.x, y: box.y, width: box.width },
  }),
  defaultSemantic: () => ({
    name: label.toLowerCase().replaceAll(" ", "_"),
    definition: "",
    ...(type === "erd.view" || type === "erd.materialized-view"
      ? { columns: [] }
      : {
          parameters: [],
          language: "sql",
          ...(type === "erd.function" ? { returnType: "" } : {}),
        }),
  }),
  defaultVisual: () => ({ x: 0, y: 0, width: 260 }),
}));
