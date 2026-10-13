import {
  erdEndpointColumnIds,
  type ErdRelationSemantic,
  type ErdTableSemantic,
} from "@nodetto/ir";
import type { Editor } from "./editor.ts";
import { newElementId } from "./ids.ts";
import { parseErdDefinition } from "./erd-definition.ts";
import type { DatabaseDialect } from "./database-ddl.ts";

/** Optimistic, atomic text apply. Stable names retain stable relation/index IDs. */
export function applyErdDefinition(
  editor: Editor,
  id: string,
  text: string,
  dialect: DatabaseDialect,
  baseline: string,
): string | undefined {
  const element = editor.store.get(id);
  if (!element || element.type !== "erd.table")
    return "Table no longer exists.";
  if (
    JSON.stringify(element.semantic) !== baseline ||
    (editor.store.getPage(element.page)?.sqlDialect ?? "postgresql") !== dialect
  )
    return "Table or input dialect changed. Reload before applying.";
  const parsed = parseErdDefinition(text, dialect);
  if (parsed.error !== undefined) return parsed.error;
  const previous = element.semantic as ErdTableSemantic;
  const existing = new Map(
    previous.columns.map((column) => [column.name.toLowerCase(), column]),
  );
  if (existing.size !== previous.columns.length)
    return "Resolve duplicate column names in Columns mode first.";
  const nextNames = new Set(
    parsed.columns.map((column) => column.name.toLowerCase()),
  );
  const removed = previous.columns.filter(
    (column) => !nextNames.has(column.name.toLowerCase()),
  );
  const added = parsed.columns.filter(
    (column) => !existing.has(column.name.toLowerCase()),
  );
  // A single changed name is unambiguous; multiple renames must be done in the
  // row editor, where the ID is explicit. Never guess from array positions.
  if (
    removed.length &&
    added.length &&
    !(removed.length === 1 && added.length === 1)
  )
    return "Rename one column at a time, or use Columns mode.";
  const renamed =
    removed.length === 1 && added.length === 1 ? removed[0] : undefined;
  if (
    (renamed ||
      removed.length ||
      parsed.columns.some((column) => {
        const old = existing.get(column.name.toLowerCase());
        return old && old.name !== column.name;
      })) &&
    (previous.checks?.length ||
      previous.columns.some((column) => column.generatedExpression))
  )
    return "Review check and generated expressions before renaming or removing columns.";
  const columns = parsed.columns.map((column) => ({
    ...column,
    id:
      existing.get(column.name.toLowerCase())?.id ??
      renamed?.id ??
      newElementId(),
  }));
  const ids = new Set(columns.map((column) => column.id));
  if (
    previous.indexes?.some((index) =>
      index.columns.some((column) => !ids.has(column)),
    )
  )
    return "Remove dependent indexes before removing columns.";
  for (const relation of editor.store.listElements()) {
    if (relation.type !== "erd.relation") continue;
    const semantic = relation.semantic as ErdRelationSemantic;
    if (
      [semantic.from, semantic.to].some(
        (end) =>
          end.table === id &&
          erdEndpointColumnIds(end).some((column) => !ids.has(column)),
      )
    )
      return "Remove dependent relations before removing columns.";
  }
  try {
    const semantic = { ...previous, columns };
    if (JSON.stringify(semantic) !== baseline)
      editor.apply([{ type: "updateSemantic", id, semantic }]);
    return undefined;
  } catch (cause) {
    return cause instanceof Error
      ? cause.message
      : "Definition could not be applied.";
  }
}
