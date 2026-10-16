// `nodetto-cli inspect`: what a document contains, as a compact indented
// outline (default) or as exact JSON records.
//
// The outline is meant for AI agents: one line per object, children indented
// under their container, geometry and the semantic fields that identify an
// object, and no styling. It is the same idea as the accessibility-tree
// outline agents read instead of a web page's HTML.

import { type Box, Editor } from "@nodetto/core";
import {
  type Document,
  type Element,
  getElementTypeDefinition,
  isKnownElementType,
  isPlainObject,
  type Page,
} from "@nodetto/ir";
import {
  type CommandIo,
  type CommandResult,
  fail,
  loadDocument,
  ok,
  parseArgs,
  selectPage,
} from "./commands.ts";
import { helpFor } from "./help.ts";
import { shortIds } from "./ids.ts";

const INSPECT_OPTIONS = new Set(["--page", "--format", "--type", "--ids"]);
const LABEL_FIELDS = ["name", "tableName", "label", "text"] as const;
const MAX_TEXT = 60;

type Semantic = Readonly<Record<string, unknown>>;

function semanticOf(element: Element): Semantic {
  return isPlainObject(element.semantic) ? element.semantic : {};
}

function quote(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, " / ").trim();
  const cut =
    flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 3)}...` : flat;
  return JSON.stringify(cut);
}

function labelOf(element: Element): string | undefined {
  const semantic = semanticOf(element);
  for (const field of LABEL_FIELDS) {
    const value = semantic[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function round(value: number): number {
  return Math.round(value);
}

function geometry(element: Element, bounds: Box | null): string {
  if (bounds)
    return ` @${round(bounds.x)},${round(bounds.y)} ${round(bounds.width)}x${round(bounds.height)}`;
  const { x, y } = element.visual;
  return typeof x === "number" && typeof y === "number"
    ? ` @${round(x)},${round(y)}`
    : "";
}

/** Containers an element belongs to, innermost first by declaration. */
function explicitParent(
  element: Element,
  byId: ReadonlyMap<string, Element>,
  memberOf: ReadonlyMap<string, string>,
): string | undefined {
  const parent = semanticOf(element)["parent"];
  if (typeof parent === "string" && byId.has(parent)) return parent;
  return memberOf.get(element.id);
}

function contains(outer: Box, inner: Box): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return (
    cx >= outer.x &&
    cx <= outer.x + outer.width &&
    cy >= outer.y &&
    cy <= outer.y + outer.height
  );
}

interface OutlineContext {
  readonly short: (id: string) => string;
  readonly byId: ReadonlyMap<string, Element>;
  readonly bounds: (id: string) => Box | null;
}

function endpoint(value: unknown, context: OutlineContext): string {
  if (typeof value === "string") {
    const target = context.byId.get(value);
    const name = target ? labelOf(target) : undefined;
    return name ? `${context.short(value)}(${name})` : context.short(value);
  }
  if (isPlainObject(value) && typeof value["table"] === "string") {
    const table = context.byId.get(value["table"]);
    const tableName = table ? labelOf(table) : undefined;
    const columns = table ? semanticOf(table)["columns"] : undefined;
    const column = Array.isArray(columns)
      ? columns.find(
          (item) => isPlainObject(item) && item["id"] === value["column"],
        )
      : undefined;
    const columnName =
      isPlainObject(column) && typeof column["name"] === "string"
        ? column["name"]
        : undefined;
    const base = tableName ?? context.short(value["table"]);
    return columnName ? `${base}.${columnName}` : base;
  }
  return "?";
}

function headerLine(element: Element, context: OutlineContext): string {
  const semantic = semanticOf(element);
  const parts: string[] = [element.type, context.short(element.id)];
  const category = isKnownElementType(element.type)
    ? getElementTypeDefinition(element.type)?.category
    : undefined;
  if (category === "edge" && ("from" in semantic || "to" in semantic)) {
    parts.push(
      `${endpoint(semantic["from"], context)} -> ${endpoint(semantic["to"], context)}`,
    );
    for (const field of ["cardinality", "kind", "label", "name"] as const) {
      const value = semantic[field];
      if (typeof value === "string" && value.length > 0)
        parts.push(
          field === "label" || field === "name" ? quote(value) : value,
        );
    }
    if (semantic["logical"] === true) parts.push("logical");
    return parts.join(" ");
  }
  const label = labelOf(element);
  if (label !== undefined)
    parts.push(element.type === "erd.table" ? label : quote(label));
  for (const field of [
    "kind",
    "taskType",
    "gatewayType",
    "geo",
    "stereotype",
  ]) {
    const value = semantic[field];
    if (typeof value === "string" && value.length > 0)
      parts.push(`${field}=${value}`);
  }
  return `${parts.join(" ")}${geometry(element, context.bounds(element.id))}`;
}

function detailLines(element: Element): string[] {
  const semantic = semanticOf(element);
  const lines: string[] = [];
  const list = (field: string): readonly Semantic[] => {
    const value = semantic[field];
    return Array.isArray(value) ? value.filter(isPlainObject) : [];
  };
  if (element.type === "erd.table") {
    for (const column of list("columns")) {
      const flags = [
        column["pk"] === true ? "pk" : "",
        column["nullable"] === false && column["pk"] !== true ? "not-null" : "",
        column["autoIncrement"] === true ? "auto-increment" : "",
        typeof column["defaultExpression"] === "string"
          ? `default=${column["defaultExpression"]}`
          : "",
      ].filter(Boolean);
      lines.push(
        ["column", column["name"], column["dataType"], ...flags]
          .filter((part) => part !== undefined && part !== "")
          .join(" "),
      );
    }
    for (const index of list("indexes"))
      lines.push(
        `index ${String(index["name"] ?? "")}${index["unique"] === true ? " unique" : ""}`.trim(),
      );
  } else if (element.type === "uml.class") {
    for (const attribute of list("attributes"))
      lines.push(
        `attribute ${String(attribute["name"] ?? "")}${attribute["type"] ? `: ${String(attribute["type"])}` : ""}`,
      );
    for (const method of list("methods"))
      lines.push(
        `method ${String(method["name"] ?? "")}()${method["returnType"] ? `: ${String(method["returnType"])}` : ""}`,
      );
  }
  return lines;
}

function pageOutline(
  editor: Editor,
  page: Page,
  elements: readonly Element[],
  typeFilter: string | undefined,
  short: (id: string) => string,
): string[] {
  editor.setCurrentPage(page.id);
  const context = editor.createShapeContext(1);
  const boundsCache = new Map<string, Box | null>();
  const bounds = (id: string): Box | null => {
    if (!boundsCache.has(id))
      boundsCache.set(id, editor.getBounds(id, context));
    return boundsCache.get(id) ?? null;
  };
  const byId = new Map(elements.map((element) => [element.id, element]));
  const memberOf = new Map<string, string>();
  for (const element of elements) {
    const members = semanticOf(element)["memberIds"];
    if (Array.isArray(members))
      for (const member of members)
        if (typeof member === "string" && !memberOf.has(member))
          memberOf.set(member, element.id);
  }
  const frames = elements.filter((element) => element.type === "frame");
  const parentOf = new Map<string, string>();
  for (const element of elements) {
    const explicit = explicitParent(element, byId, memberOf);
    if (explicit !== undefined) {
      parentOf.set(element.id, explicit);
      continue;
    }
    const own = bounds(element.id);
    if (!own || element.type === "frame") continue;
    let best: { id: string; area: number } | undefined;
    for (const frame of frames) {
      const box = bounds(frame.id);
      if (!box || !contains(box, own)) continue;
      const area = box.width * box.height;
      if (!best || area < best.area) best = { id: frame.id, area };
    }
    if (best) parentOf.set(element.id, best.id);
  }
  const children = new Map<string | undefined, Element[]>();
  for (const element of elements) {
    const parent = parentOf.get(element.id);
    const list = children.get(parent) ?? [];
    list.push(element);
    children.set(parent, list);
  }
  const outlineContext: OutlineContext = { short, byId, bounds };
  const matches = (element: Element): boolean =>
    typeFilter === undefined || element.type.startsWith(typeFilter);
  const hasMatch = (element: Element): boolean =>
    matches(element) ||
    (children.get(element.id) ?? []).some((child) => hasMatch(child));
  const lines: string[] = [];
  const walk = (parent: string | undefined, depth: number): void => {
    for (const element of children.get(parent) ?? []) {
      if (!hasMatch(element)) continue;
      const indent = "  ".repeat(depth);
      lines.push(`${indent}${headerLine(element, outlineContext)}`);
      if (matches(element))
        for (const detail of detailLines(element))
          lines.push(`${indent}  ${detail}`);
      walk(element.id, depth + 1);
    }
  };
  walk(undefined, 2);
  return lines;
}

export function inspectCommand(
  io: CommandIo,
  args: readonly string[],
): CommandResult {
  const parsed = parseArgs(args, INSPECT_OPTIONS, new Set());
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("inspect")}`);
  if (parsed.positional.length !== 1)
    return fail(
      `inspect expects exactly one document path.\n\n${helpFor("inspect")}`,
    );
  const format = parsed.options.get("--format") ?? "outline";
  if (format !== "outline" && format !== "json")
    return fail(`Unsupported format "${format}". Choose outline or json.`);
  const idMode = parsed.options.get("--ids") ?? "short";
  if (idMode !== "short" && idMode !== "full")
    return fail(`Unsupported --ids "${idMode}". Choose short or full.`);
  const loaded = loadDocument(io, parsed.positional[0] as string);
  if (typeof loaded === "string") return fail(loaded);
  const document: Document = loaded.document;
  let pages: readonly Page[] = document.pages;
  const query = parsed.options.get("--page");
  if (query !== undefined) {
    const page = selectPage(
      document,
      query,
      document.pages,
      "The document has no pages.",
      "pages",
    );
    if (typeof page === "string") return fail(page);
    pages = [page];
  }
  const typeFilter = parsed.options.get("--type");
  const elementsOf = (page: Page): readonly Element[] =>
    document.elements.filter((element) => element.page === page.id);

  if (format === "json") {
    const report = {
      document: { id: document.id, title: document.title },
      pages: pages.map((page) => ({
        ...page,
        elements: elementsOf(page).filter(
          (element) =>
            typeFilter === undefined || element.type.startsWith(typeFilter),
        ),
      })),
    };
    return ok(`${JSON.stringify(report, null, 2)}\n`, loaded.warnings);
  }

  const shortMap = shortIds(document.elements.map((element) => element.id));
  const short = (id: string): string =>
    idMode === "full" ? id : (shortMap.get(id) ?? id);
  const editor = new Editor({ document });
  const lines = [`document ${quote(document.title)}`];
  for (const page of pages) {
    const elements = elementsOf(page);
    lines.push(
      `  page ${page.id} ${quote(page.name)} ${page.kind} (${elements.length} elements)`,
    );
    lines.push(...pageOutline(editor, page, elements, typeFilter, short));
  }
  return ok(`${lines.join("\n")}\n`, loaded.warnings);
}
