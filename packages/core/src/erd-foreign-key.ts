import {
  type Element,
  type ElementId,
  type ErdRelationSemantic,
  type ErdTableSemantic,
  erdEndpointColumnIds,
} from "@nodetto/ir";

/** Authoring warning only: table-level FK drafts remain valid document elements. */
export function erdForeignKeyWarning(
  element: Element,
  resolve: (id: ElementId) => Element | undefined,
): string | null {
  if (element.type !== "erd.relation") return null;
  const semantic = element.semantic as ErdRelationSemantic;
  if (semantic.logical === true) return null;
  const from = erdEndpointColumnIds(semantic.from);
  const to = erdEndpointColumnIds(semantic.to);
  if (from.length === 0 || to.length === 0)
    return "Foreign key columns are not assigned. Assign source and target columns.";
  if (from.length !== to.length)
    return "Foreign key column mapping is incomplete. Each source column needs a target column.";
  for (const end of ["from", "to"] as const) {
    const table = resolve(semantic[end].table);
    if (table?.type !== "erd.table")
      return "Foreign key references a missing table.";
    const columns = erdEndpointColumnIds(semantic[end]);
    const available = new Set(
      (table.semantic as ErdTableSemantic).columns.map((column) => column.id),
    );
    if (columns.some((id) => !available.has(id)))
      return "Foreign key references a missing column. Reassign source and target columns.";
    if (new Set(columns).size !== columns.length)
      return "Foreign key column mapping contains duplicate columns.";
  }
  return null;
}
