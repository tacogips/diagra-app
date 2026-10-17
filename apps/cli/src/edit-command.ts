import { connectScreenTransition } from "@nodetto/core";
// `nodetto-cli edit`: apply a batch of drawing operations through the editor's
// command layer, so validation, reference cascades and derived state are the
// same as when a person edits in the app.
//
// The batch is all-or-nothing. Before the atomic write the file is read again;
// if someone (typically the person in the desktop app) saved meanwhile, the
// batch is applied again to the new contents instead of overwriting them.

import {
  type ArrangeMode,
  type Box,
  CommandError,
  Editor,
  newElementId,
  planArrangement,
} from "@nodetto/core";
import { parseDocumentResult, serializeDocument } from "@nodetto/io";
import {
  type Element,
  getElementTypeDefinition,
  isKnownElementType,
  isPageKind,
  isPlainObject,
  type KeyOrder,
  type Page,
  validateDocument,
} from "@nodetto/ir";
import {
  type CommandIo,
  type CommandResult,
  fail,
  ok,
  parseArgs,
} from "./commands.ts";
import { helpFor } from "./help.ts";
import { resolveId } from "./ids.ts";

const EDIT_OPTIONS = new Set(["--ops", "--format", "--snapshot"]);
const EDIT_FLAGS = new Set(["--arrange", "--dry-run"]);
/** The file kept changing while the batch was being written. */
export const EXIT_CONTENDED = 4;
const MAX_ATTEMPTS = 3;
/** Default space between placed elements, in canvas units. */
const PLACE_GAP = 80;

type Json = unknown;
type JsonObject = Readonly<Record<string, Json>>;

interface Created {
  readonly ref?: string;
  readonly id: string;
  readonly type: string;
  readonly page: string;
}

interface BatchResult {
  readonly text: string;
  readonly created: readonly Created[];
  readonly counts: ReadonlyMap<
    string,
    { added: number; updated: number; removed: number }
  >;
  readonly operations: number;
}

class OperationError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(message);
  }
}

/** Parse a JSON array of operations, or JSON Lines with one operation each. */
export function parseOperations(text: string): readonly JsonObject[] {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("No operations were given.");
  let values: Json[];
  if (trimmed.startsWith("[")) {
    const parsed: Json = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array.");
    values = parsed;
  } else {
    values = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line, index) => {
        try {
          return JSON.parse(line) as Json;
        } catch (cause) {
          throw new Error(
            `Line ${index + 1} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      });
  }
  return values.map((value, index) => {
    if (!isPlainObject(value))
      throw new OperationError(index, "an operation must be a JSON object");
    return value;
  });
}

/** Objects merge key by key, arrays and scalars replace, null removes a key. */
export function deepMerge(base: Json, patch: Json): Json {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const result: Record<string, Json> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = deepMerge(base[key], value);
  }
  return result;
}

/** Give list items that need an id (columns, indexes, attributes) a fresh one. */
function fillIds(value: Json, order: KeyOrder | undefined): Json {
  if (!isPlainObject(value) || !order) return value;
  const result: Record<string, Json> = { ...value };
  for (const [key, child] of Object.entries(order.children ?? {})) {
    const field = result[key];
    if (Array.isArray(field))
      result[key] = field.map((item) => {
        const filled = fillIds(item, child);
        return isPlainObject(filled) &&
          child.keys.includes("id") &&
          (typeof filled["id"] !== "string" || filled["id"] === "")
          ? { id: newElementId(), ...filled }
          : filled;
      });
    else if (isPlainObject(field)) result[key] = fillIds(field, child);
  }
  return result;
}

function text(value: Json, field: string, index: number): string {
  if (typeof value !== "string" || value === "")
    throw new OperationError(index, `"${field}" must be a non-empty string`);
  return value;
}

function number(value: Json, field: string, index: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new OperationError(index, `"${field}" must be a number`);
  return value;
}

class Batch {
  readonly refs = new Map<string, string>();
  readonly created: Created[] = [];
  readonly touchedPages = new Set<string>();
  /** The element auto placement put last on each page, to line up with. */
  private readonly lastPlaced = new Map<string, string>();

  constructor(readonly editor: Editor) {}

  private elementIds(): string[] {
    return this.editor.store.listElements().map((element) => element.id);
  }

  element(query: Json, index: number): Element {
    const resolved = resolveId(
      text(query, "id", index),
      this.elementIds(),
      this.refs,
    );
    if (!resolved.ok) throw new OperationError(index, resolved.message);
    const element = this.editor.store.get(resolved.id);
    if (!element) throw new OperationError(index, `No element ${resolved.id}.`);
    return element;
  }

  page(query: Json, index: number): Page {
    const value = text(query, "page", index);
    const pages = this.editor.store.listPages();
    const byRef = value.startsWith("@")
      ? this.refs.get(value.slice(1))
      : undefined;
    const exact = pages.find((page) => page.id === (byRef ?? value));
    if (exact) return exact;
    const named = pages.filter((page) => page.name === value);
    if (named.length === 1) return named[0] as Page;
    throw new OperationError(
      index,
      named.length
        ? `Several pages are named "${value}"; use the page id.`
        : `No page has the id or name "${value}".`,
    );
  }

  /** Replace "@ref" strings and id prefixes in reference fields with ids. */
  private resolveReferences(type: string, semantic: Json, index: number): Json {
    const substitute = (value: Json): Json => {
      if (typeof value === "string" && value.startsWith("@")) {
        const id = this.refs.get(value.slice(1));
        if (id === undefined)
          throw new OperationError(index, `Unknown ref "${value}".`);
        return id;
      }
      if (Array.isArray(value)) return value.map(substitute);
      if (isPlainObject(value))
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, substitute(item)]),
        );
      return value;
    };
    let resolved = substitute(semantic);
    if (type === "erd.relation" && isPlainObject(resolved)) {
      const end = (value: Json): Json => {
        if (!isPlainObject(value) || typeof value["table"] !== "string")
          return value;
        const table = this.element(value["table"], index);
        const columns = isPlainObject(table.semantic)
          ? table.semantic["columns"]
          : undefined;
        const column = value["column"];
        if (typeof column === "string" && Array.isArray(columns)) {
          const byId = columns.some(
            (item) => isPlainObject(item) && item["id"] === column,
          );
          const byName = columns.find(
            (item) => isPlainObject(item) && item["name"] === column,
          );
          if (
            !byId &&
            isPlainObject(byName) &&
            typeof byName["id"] === "string"
          )
            return { ...value, table: table.id, column: byName["id"] };
        }
        return { ...value, table: table.id };
      };
      resolved = {
        ...resolved,
        from: end(resolved["from"]),
        to: end(resolved["to"]),
      };
    } else if (isKnownElementType(type) && isPlainObject(resolved)) {
      const definition = getElementTypeDefinition(type);
      if (definition?.category === "edge") {
        const edge: Record<string, Json> = { ...resolved };
        for (const field of ["from", "to"] as const) {
          const value = edge[field];
          if (typeof value === "string")
            edge[field] = this.element(value, index).id;
        }
        resolved = edge;
      }
    }
    return resolved;
  }

  private boundsOf(id: string): Box | null {
    const element = this.editor.store.get(id);
    if (!element) return null;
    this.editor.setCurrentPage(element.page);
    return this.editor.getBounds(id, this.editor.createShapeContext(1));
  }

  /** Create one element; place it relative to another or beside the page content. */
  add(operation: JsonObject, index: number): string {
    const type = text(operation["type"], "type", index);
    if (!isKnownElementType(type))
      throw new OperationError(
        index,
        `Unknown element type "${type}". Run "nodetto-cli types".`,
      );
    const page = this.page(operation["page"], index);
    const definition = getElementTypeDefinition(type);
    const visual = operation["visual"];
    if (visual !== undefined && !isPlainObject(visual))
      throw new OperationError(index, `"visual" must be an object`);
    const place = operation["place"];
    if (place !== undefined && !isPlainObject(place))
      throw new OperationError(index, `"place" must be an object`);
    const positioned =
      isPlainObject(visual) && ("x" in visual || "y" in visual);
    const autoPlace =
      definition?.category !== "edge" && !positioned && place === undefined;
    this.editor.setCurrentPage(page.id);
    const content = autoPlace ? this.editor.pageBounds(page.id) : null;
    // Given fields are merged over the type's defaults, so an agent states
    // only what it cares about (lists such as columns replace the default).
    const semantic =
      operation["semantic"] === undefined
        ? undefined
        : this.resolveReferences(
            type,
            fillIds(
              deepMerge(
                this.editor.registry.getOrFallback(type).defaultSemantic(),
                operation["semantic"],
              ),
              definition?.keyOrder,
            ),
            index,
          );
    const id = this.editor.createElement(type, {
      page: page.id,
      ...(typeof operation["id"] === "string" ? { id: operation["id"] } : {}),
      ...(semantic === undefined ? {} : { semantic }),
      ...(visual === undefined ? {} : { visual }),
    });
    if (isPlainObject(place)) this.placeRelative(id, place, index);
    else if (autoPlace && content) {
      // Continue the row: right of everything, centred on the previous
      // auto-placed element so connectors between them run straight.
      const previous = this.lastPlaced.get(page.id);
      const previousBox = previous ? this.boundsOf(previous) : null;
      const own = this.boundsOf(id);
      const y =
        previousBox && own
          ? previousBox.y + (previousBox.height - own.height) / 2
          : content.y;
      this.moveBoxTo(id, content.x + content.width + PLACE_GAP, y);
    }
    if (autoPlace) this.lastPlaced.set(page.id, id);
    const ref = operation["ref"];
    if (typeof ref === "string") {
      if (this.refs.has(ref))
        throw new OperationError(index, `ref "${ref}" is already used.`);
      this.refs.set(ref, id);
    }
    this.created.push({
      ...(typeof ref === "string" ? { ref } : {}),
      id,
      type,
      page: page.id,
    });
    this.touchedPages.add(page.id);
    return id;
  }

  /** Move an element so that its bounding box starts at (x, y). */
  private moveBoxTo(id: string, x: number, y: number): void {
    const element = this.editor.store.get(id);
    const box = this.boundsOf(id);
    if (!element || !box) return;
    const vx = typeof element.visual.x === "number" ? element.visual.x : box.x;
    const vy = typeof element.visual.y === "number" ? element.visual.y : box.y;
    this.editor.moveElements([
      { id, x: Math.round(vx + x - box.x), y: Math.round(vy + y - box.y) },
    ]);
  }

  private placeRelative(id: string, place: JsonObject, index: number): void {
    const sides = ["rightOf", "leftOf", "below", "above"] as const;
    const side = sides.find((name) => place[name] !== undefined);
    if (!side)
      throw new OperationError(
        index,
        `"place" needs one of ${sides.join(", ")} with an element id or @ref`,
      );
    const anchor = this.element(place[side], index);
    const gap =
      place["gap"] === undefined
        ? PLACE_GAP
        : number(place["gap"], "place.gap", index);
    const target = this.boundsOf(anchor.id);
    const own = this.boundsOf(id);
    if (!target || !own)
      throw new OperationError(
        index,
        "Cannot place an element without bounds.",
      );
    const centered = place["align"] === "center";
    const alignX = centered
      ? target.x + (target.width - own.width) / 2
      : target.x;
    const alignY = centered
      ? target.y + (target.height - own.height) / 2
      : target.y;
    const position =
      side === "rightOf"
        ? { x: target.x + target.width + gap, y: alignY }
        : side === "leftOf"
          ? { x: target.x - gap - own.width, y: alignY }
          : side === "below"
            ? { x: alignX, y: target.y + target.height + gap }
            : { x: alignX, y: target.y - gap - own.height };
    this.moveBoxTo(id, position.x, position.y);
  }

  /**
   * Connect two elements the way the app's connect tool does (connectSmart):
   * ERD tables get a relation, UML classes an association, sequence
   * participants a message on the next timeline row (lifelines grow), BPMN
   * nodes a flow that obeys BPMN rules, anything else a generic edge.
   */
  connect(operation: JsonObject, index: number): string {
    const from = this.element(operation["from"], index);
    const to = this.element(operation["to"], index);
    if (from.page !== to.page)
      throw new OperationError(
        index,
        "connect needs two elements on the same page.",
      );
    if (typeof operation["type"] === "string")
      return this.add(
        {
          op: "add",
          page: from.page,
          type: operation["type"],
          semantic: deepMerge(
            { from: from.id, to: to.id },
            isPlainObject(operation["semantic"]) ? operation["semantic"] : {},
          ),
          ...(typeof operation["ref"] === "string"
            ? { ref: operation["ref"] }
            : {}),
        },
        index,
      );
    this.editor.setCurrentPage(from.page);
    const id =
      isPlainObject(operation["semantic"]) &&
      operation["semantic"]["prototype"] === true
        ? connectScreenTransition(this.editor, from.id, to.id)
        : this.editor.connectSmart(from.id, to.id);
    if (id === null)
      throw new OperationError(
        index,
        `Cannot connect ${from.type} to ${to.type} here (a rule of this diagram kind forbids it, or an element is locked).`,
      );
    const created = this.editor.store.get(id);
    if (!created)
      throw new OperationError(index, "The connector was not created.");
    let patch: Record<string, Json> = {};
    if (created.type === "erd.relation") {
      const column = (table: Element, query: Json, field: string) => {
        if (query === undefined) return {};
        const name = text(query, field, index);
        const columns = isPlainObject(table.semantic)
          ? table.semantic["columns"]
          : undefined;
        const match = Array.isArray(columns)
          ? columns.find(
              (item) =>
                isPlainObject(item) &&
                (item["id"] === name || item["name"] === name),
            )
          : undefined;
        if (!isPlainObject(match) || typeof match["id"] !== "string")
          throw new OperationError(
            index,
            `${field} "${name}" is not a column of that table.`,
          );
        return { column: match["id"] };
      };
      patch = {
        from: {
          table: from.id,
          ...column(from, operation["fromColumn"], "fromColumn"),
        },
        to: { table: to.id, ...column(to, operation["toColumn"], "toColumn") },
        cardinality:
          typeof operation["cardinality"] === "string"
            ? operation["cardinality"]
            : "*:1",
      };
    }
    const label = operation["label"];
    if (typeof label === "string")
      patch[created.type.startsWith("bpmn.") ? "name" : "label"] = label;
    if (isPlainObject(operation["semantic"]))
      patch = deepMerge(patch, operation["semantic"]) as Record<string, Json>;
    if (Object.keys(patch).length)
      this.editor.apply([
        {
          type: "updateSemantic",
          id,
          semantic: deepMerge(created.semantic, patch),
        },
      ]);
    const ref = operation["ref"];
    if (typeof ref === "string") {
      if (this.refs.has(ref))
        throw new OperationError(index, `ref "${ref}" is already used.`);
      this.refs.set(ref, id);
    }
    this.created.push({
      ...(typeof ref === "string" ? { ref } : {}),
      id,
      type: created.type,
      page: from.page,
    });
    this.touchedPages.add(from.page);
    return id;
  }

  apply(operation: JsonObject, index: number): void {
    const op = operation["op"];
    switch (op) {
      case "add-page": {
        const kind = operation["kind"] ?? "freeform";
        if (typeof kind !== "string" || !isPageKind(kind))
          throw new OperationError(
            index,
            `Unknown page kind "${String(kind)}".`,
          );
        const id = this.editor.createPage({
          name: text(operation["name"], "name", index),
          kind,
          ...(typeof operation["id"] === "string"
            ? { id: operation["id"] }
            : {}),
        });
        if (typeof operation["ref"] === "string")
          this.refs.set(operation["ref"], id);
        this.touchedPages.add(id);
        return;
      }
      case "rename-page": {
        const page = this.page(operation["id"], index);
        this.editor.renamePage(page.id, text(operation["name"], "name", index));
        return;
      }
      case "delete-page": {
        const page = this.page(operation["id"], index);
        if (!this.editor.deletePage(page.id))
          throw new OperationError(index, "The last page cannot be deleted.");
        this.touchedPages.delete(page.id);
        return;
      }
      case "add": {
        this.add(operation, index);
        return;
      }
      case "connect": {
        this.connect(operation, index);
        return;
      }
      case "append":
      case "remove-item": {
        const element = this.element(operation["id"], index);
        const field = text(operation["field"], "field", index);
        const semantic = isPlainObject(element.semantic)
          ? element.semantic
          : {};
        const current = semantic[field];
        if (!Array.isArray(current))
          throw new OperationError(
            index,
            `${element.type} has no list field "${field}".`,
          );
        let next: Json[];
        if (op === "append") {
          const items = operation["items"];
          if (!Array.isArray(items) || !items.length)
            throw new OperationError(
              index,
              `"items" must be a non-empty array`,
            );
          next = [...current, ...items];
        } else {
          const item = text(operation["item"], "item", index);
          const position = current.findIndex(
            (entry) =>
              isPlainObject(entry) &&
              (entry["id"] === item || entry["name"] === item),
          );
          if (position < 0)
            throw new OperationError(
              index,
              `No item with id or name "${item}" in ${field}.`,
            );
          next = current.filter((_, at) => at !== position);
        }
        const definition = isKnownElementType(element.type)
          ? getElementTypeDefinition(element.type)
          : undefined;
        this.editor.apply([
          {
            type: "updateSemantic",
            id: element.id,
            semantic: fillIds(
              { ...semantic, [field]: next },
              definition?.keyOrder,
            ),
          },
        ]);
        this.touchedPages.add(element.page);
        return;
      }
      case "update": {
        const element = this.element(operation["id"], index);
        const definition = isKnownElementType(element.type)
          ? getElementTypeDefinition(element.type)
          : undefined;
        const commands = [];
        if (operation["semantic"] !== undefined) {
          const merged = this.resolveReferences(
            element.type,
            fillIds(
              deepMerge(element.semantic, operation["semantic"]),
              definition?.keyOrder,
            ),
            index,
          );
          commands.push({
            type: "updateSemantic" as const,
            id: element.id,
            semantic: merged,
          });
        }
        const visual = operation["visual"];
        if (visual !== undefined) {
          if (!isPlainObject(visual))
            throw new OperationError(index, `"visual" must be an object`);
          commands.push({
            type: "updateVisual" as const,
            id: element.id,
            visual,
          });
        }
        if (!commands.length)
          throw new OperationError(index, "update needs semantic or visual");
        this.editor.apply(commands);
        this.touchedPages.add(element.page);
        return;
      }
      case "move": {
        const element = this.element(operation["id"], index);
        this.editor.moveElements([
          {
            id: element.id,
            x: number(operation["x"], "x", index),
            y: number(operation["y"], "y", index),
          },
        ]);
        this.touchedPages.add(element.page);
        return;
      }
      case "delete": {
        const element = this.element(operation["id"], index);
        this.editor.deleteElements([element.id]);
        this.touchedPages.add(element.page);
        return;
      }
      default:
        throw new OperationError(
          index,
          `Unknown op "${String(op)}". Use add-page, rename-page, delete-page, add, connect, update, append, remove-item, move or delete.`,
        );
    }
  }
}

/** Apply the batch to one version of the document text. */
export function applyBatch(
  documentText: string,
  operations: readonly JsonObject[],
  arrange: boolean,
): BatchResult {
  const parsed = parseDocumentResult(documentText);
  if (!parsed.ok)
    throw new Error("The document is not a valid nodetto document.");
  const before = new Map(
    parsed.document.elements.map((element) => [element.id, element]),
  );
  const editor = new Editor({ document: parsed.document });
  const batch = new Batch(editor);
  operations.forEach((operation, index) => {
    try {
      batch.apply(operation, index);
    } catch (cause) {
      if (cause instanceof OperationError) throw cause;
      if (cause instanceof CommandError) {
        const details = cause.issues
          .filter((issue) => issue.severity === "error")
          .map(
            (issue) => `${issue.path ? `${issue.path}: ` : ""}${issue.message}`,
          );
        throw new OperationError(
          index,
          details.length
            ? `invalid element:\n  ${details.join("\n  ")}\nRun "nodetto-cli types <type>" for the expected fields.`
            : cause.message,
        );
      }
      throw new OperationError(
        index,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  });
  if (arrange)
    for (const pageId of batch.touchedPages) {
      if (!editor.store.getPage(pageId)) continue;
      const { commands, placed } = planArrangement(
        editor.store,
        pageId,
        editor.createShapeContext(1),
        { mode: "tidy" as ArrangeMode },
      );
      if (commands.length) editor.apply(commands, { placed });
    }
  const snapshot = editor.getSnapshot();
  const issues = validateDocument(snapshot).filter(
    (issue) => issue.severity === "error",
  );
  if (issues.length)
    throw new Error(
      `The result is not a valid document:\n${issues
        .map(
          (issue) => `  ${issue.path ? `${issue.path}: ` : ""}${issue.message}`,
        )
        .join("\n")}`,
    );
  const counts = new Map<
    string,
    { added: number; updated: number; removed: number }
  >();
  const bump = (page: string, field: "added" | "updated" | "removed") => {
    const entry = counts.get(page) ?? { added: 0, updated: 0, removed: 0 };
    entry[field] += 1;
    counts.set(page, entry);
  };
  const after = new Map(
    snapshot.elements.map((element) => [element.id, element]),
  );
  for (const [id, element] of after) {
    const previous = before.get(id);
    if (!previous) bump(element.page, "added");
    else if (JSON.stringify(previous) !== JSON.stringify(element))
      bump(element.page, "updated");
  }
  for (const [id, element] of before)
    if (!after.has(id)) bump(element.page, "removed");
  return {
    text: serializeDocument(snapshot),
    created: batch.created,
    counts,
    operations: operations.length,
  };
}

export function editCommand(
  io: CommandIo,
  args: readonly string[],
): CommandResult {
  const parsed = parseArgs(args, EDIT_OPTIONS, EDIT_FLAGS);
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("edit")}`);
  if (parsed.positional.length !== 1)
    return fail(
      `edit expects exactly one document path.\n\n${helpFor("edit")}`,
    );
  const path = parsed.positional[0] as string;
  const format = parsed.options.get("--format") ?? "text";
  if (format !== "text" && format !== "json")
    return fail(`Unsupported format "${format}". Choose text or json.`);
  const source = parsed.options.get("--ops");
  if (source === undefined)
    return fail(`edit requires --ops <file.json|->.\n\n${helpFor("edit")}`);
  let operations: readonly JsonObject[];
  try {
    const opsText =
      source === "-" ? (io.readStdin?.() ?? "") : io.readText(source);
    operations = parseOperations(opsText);
  } catch (cause) {
    if (cause instanceof OperationError)
      return fail(`Operation ${cause.index}: ${cause.message}`);
    return fail(
      `Cannot read operations: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const arrange = parsed.flags.has("--arrange");
  let result: BatchResult | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let current: string;
    try {
      current = io.readText(path);
    } catch (cause) {
      return fail(
        `Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    try {
      result = applyBatch(current, operations, arrange);
    } catch (cause) {
      if (cause instanceof OperationError)
        return fail(
          `Operation ${cause.index} (${String(operations[cause.index]?.["op"])}): ${cause.message}\nNothing was written.`,
        );
      return fail(
        `${cause instanceof Error ? cause.message : String(cause)}\nNothing was written.`,
      );
    }
    if (parsed.flags.has("--dry-run")) break;
    let latest: string;
    try {
      latest = io.readText(path);
    } catch {
      latest = current;
    }
    if (latest !== current) {
      result = undefined;
      continue;
    }
    try {
      io.writeText(path, result.text);
    } catch (cause) {
      return fail(
        `Cannot write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    const snapshot = parsed.options.get("--snapshot");
    if (snapshot !== undefined)
      try {
        io.writeText(snapshot, result.text);
      } catch (cause) {
        return fail(
          `Wrote ${path}, but cannot write the snapshot ${snapshot}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    break;
  }
  if (!result)
    return {
      exitCode: EXIT_CONTENDED,
      stdout: "",
      stderr: `${path} kept changing while the batch was applied (${MAX_ATTEMPTS} attempts); nothing was written. Retry later.\n`,
    };

  const dryRun = parsed.flags.has("--dry-run");
  if (format === "json")
    return ok(
      `${JSON.stringify(
        {
          written: !dryRun,
          operations: result.operations,
          created: result.created,
          pages: Object.fromEntries(result.counts),
        },
        null,
        2,
      )}\n`,
    );
  const lines = [
    `${dryRun ? "Would apply" : "Applied"} ${result.operations} operation(s) to ${path}.`,
    ...[...result.counts].map(
      ([page, count]) =>
        `  page ${page}: +${count.added} ~${count.updated} -${count.removed}`,
    ),
    ...result.created.map(
      (item) =>
        `  created ${item.ref ? `@${item.ref} = ` : ""}${item.id} (${item.type})`,
    ),
  ];
  return ok(`${lines.join("\n")}\n`);
}
