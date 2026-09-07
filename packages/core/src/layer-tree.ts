import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { frameParents } from "./frame-tree.ts";
import { groupOf } from "./group.ts";
import { layerName } from "./layer-name.ts";

/** Exact search hits on the current page, not ancestors retained for context. */
export function layerSearchMatchIds(
  editor: Editor,
  query: string,
): ElementId[] {
  if (!query.trim()) return [];
  const context = editor.createShapeContext();
  return layerRows(editor, new Set(), query)
    .filter((row) => row.matched && !context.isLocked?.(row.element.id))
    .map((row) => row.element.id);
}

export function selectLayerSearchMatches(
  editor: Editor,
  query: string,
): boolean {
  const ids = layerSearchMatchIds(editor, query);
  if (
    !ids.length ||
    (editor.selection.size === ids.length &&
      ids.every((id) => editor.selection.has(id)))
  )
    return false;
  editor.selection.set(ids);
  return true;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function fields(
  value: Record<string, unknown>,
  keys: readonly string[],
): string {
  return keys
    .map((key) => (typeof value[key] === "string" ? value[key] : ""))
    .filter(Boolean)
    .join(" ");
}

/** Search authored meaning, excluding IDs, image payloads and extension metadata. */
function searchTerms(element: Element): string[] {
  const semantic = record(element.semantic);
  const terms = [
    layerName(element),
    element.type,
    fields(semantic, [
      "name",
      "label",
      "tableName",
      "text",
      "alt",
      "stereotype",
    ]),
  ];
  if (element.type === "erd.table") {
    for (const column of records(semantic.columns))
      terms.push(
        `Column: ${fields(column, ["name", "dataType", "defaultExpression", "generatedExpression"])}`,
      );
    for (const index of records(semantic.indexes))
      terms.push(`Index: ${fields(index, ["name"])}`);
    for (const check of records(semantic.checks))
      terms.push(`Check: ${fields(check, ["name", "expression"])}`);
  } else if (element.type === "uml.class") {
    for (const attribute of records(semantic.attributes))
      terms.push(`Attribute: ${fields(attribute, ["name", "type"])}`);
    for (const method of records(semantic.methods)) {
      terms.push(
        `Method: ${fields(method, ["name", "returnType"])} ${records(
          method.parameters,
        )
          .map((parameter) => fields(parameter, ["name", "type"]))
          .join(" ")}`,
      );
    }
  }
  return terms.filter((term) => term.trim());
}

/** Search retains ancestors and temporarily opens matching paths without editing collapse state. */
export function layerRows(
  editor: Editor,
  collapsed: ReadonlySet<string> = new Set(),
  query = "",
  pageId = editor.currentPageId,
) {
  const elements = [...editor.store.getPageElements(pageId)]
    .filter(
      (element) =>
        getElementTypeDefinition(element.type)?.category !== "resource",
    )
    .reverse();
  const ids = new Set(elements.map((element) => element.id));
  const frames = frameParents(
    editor.store,
    pageId,
    editor.createShapeContext(),
  );
  const parents = new Map<string, string>();
  for (const element of elements) {
    const parent =
      groupOf(editor.store, element.id)?.id ?? frames.get(element.id);
    if (parent && ids.has(parent)) parents.set(element.id, parent);
  }
  // Imported malformed cycles must not make every involved layer disappear.
  for (const element of elements) {
    const seen = new Set<string>([element.id]);
    let parent = parents.get(element.id);
    while (parent) {
      if (seen.has(parent)) {
        parents.delete(element.id);
        break;
      }
      seen.add(parent);
      parent = parents.get(parent);
    }
  }
  const search = query.trim().toLowerCase();
  const visible = new Set<string>();
  const matches = new Set<string>();
  const matchDetails = new Map<string, string>();
  for (const element of elements) {
    const terms = searchTerms(element);
    const content = terms.join(" ").toLowerCase();
    if (search && !content.includes(search)) continue;
    const detail = search
      ? terms.find((term) => term.toLowerCase().includes(search))
      : undefined;
    if (detail && detail !== layerName(element) && detail !== element.type)
      matchDetails.set(element.id, detail);
    matches.add(element.id);
    let id: string | undefined = element.id;
    while (id && !visible.has(id)) {
      visible.add(id);
      id = parents.get(id);
    }
  }
  const children = new Map<string, Element[]>();
  for (const element of elements) {
    const parent = parents.get(element.id);
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(element);
    children.set(parent, list);
  }
  const rows: {
    element: Element;
    depth: number;
    hasChildren: boolean;
    matched: boolean;
    matchDetail?: string;
  }[] = [];
  const stack = elements
    .filter((element) => !parents.has(element.id))
    .reverse()
    .map((element) => ({ element, depth: 0 }));
  while (stack.length) {
    const row = stack.pop();
    if (!row || !visible.has(row.element.id)) continue;
    const nested = children.get(row.element.id) ?? [];
    rows.push({
      ...row,
      hasChildren: nested.length > 0,
      matched: matches.has(row.element.id),
      ...(matchDetails.has(row.element.id)
        ? { matchDetail: matchDetails.get(row.element.id) }
        : {}),
    });
    if (search || !collapsed.has(row.element.id))
      for (const element of [...nested].reverse())
        stack.push({ element, depth: row.depth + 1 });
  }
  return rows;
}

/** Select from the displayed order, never spanning pages or concealed rows.
 * Returns the anchor to retain for subsequent Shift-clicks. */
export function selectLayerRow(
  editor: Editor,
  rows: readonly { readonly element: Element }[],
  targetId: ElementId,
  anchor: ElementId | undefined,
  modifiers: { readonly range?: boolean; readonly additive?: boolean } = {},
): ElementId | undefined {
  const target = editor.store.get(targetId);
  if (!target || !editor.store.getPage(target.page)) return anchor;
  const ids = rows
    .filter(({ element }) => {
      const current = editor.store.get(element.id);
      return (
        current?.page === target.page &&
        getElementTypeDefinition(current.type)?.category !== "resource"
      );
    })
    .map(({ element }) => element.id);
  const end = ids.indexOf(targetId);
  if (end < 0) return anchor;
  const start =
    anchor &&
    editor.currentPageId === target.page &&
    editor.selection.has(anchor)
      ? ids.indexOf(anchor)
      : -1;
  editor.setCurrentPage(target.page);
  const next = new Set<ElementId>(
    modifiers.additive
      ? [...editor.selection.ids()].filter(
          (id) => editor.store.get(id)?.page === target.page,
        )
      : [],
  );
  if (modifiers.range && start >= 0) {
    for (const id of ids.slice(Math.min(start, end), Math.max(start, end) + 1))
      next.add(id);
  } else if (!modifiers.additive || !next.delete(targetId)) {
    next.add(targetId);
  }
  editor.selection.set(next);
  return modifiers.range && start >= 0 ? anchor : targetId;
}
