// Pure edits of semantic payloads, one user action each.
//
// The Inspector never mutates a payload in place: every row editor asks one
// of these for a new payload with exactly one thing changed, and writes it
// back whole through `updateSemantic`. Item ids are never touched by an
// edit, which is what keeps a rename a field change for the Y.Array
// reconciliation in `@diagra/collab`, and what keeps the tests here free of
// the DOM.

import type {
  ErdColumn,
  ErdCheckConstraint,
  ErdEndpoint,
  ErdIndex,
  ErdRelationSemantic,
  ErdTableSemantic,
  ForeignKeyDeferrability,
  ReferentialAction,
  UmlAttribute,
  UmlClassSemantic,
  UmlMethod,
  UmlParameter,
} from "@diagra/ir";

// ---------------------------------------------------------------- generic

/** `items` with the element at `from` moved to `to`; unchanged when out of range. */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): readonly T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  const out = [...items];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved as T);
  return out;
}

/**
 * Set an optional string field, dropping the key when the value is empty so
 * an optional field that was cleared serializes as absent rather than "".
 */
export function withOptionalString<T extends object>(
  target: T,
  key: string,
  value: string,
): T {
  const out: Record<string, unknown> = {
    ...(target as Record<string, unknown>),
  };
  if (value === "") {
    delete out[key];
  } else {
    out[key] = value;
  }
  return out as T;
}

/** Set an optional boolean field, dropping the key when it is false. */
export function withOptionalFlag<T extends object>(
  target: T,
  key: string,
  value: boolean,
): T {
  const out: Record<string, unknown> = {
    ...(target as Record<string, unknown>),
  };
  if (value) {
    out[key] = true;
  } else {
    delete out[key];
  }
  return out as T;
}

/** A finite number parsed from an input's text, or `null`. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(source: unknown, field: string): string {
  const value = asRecord(source)[field];
  return typeof value === "string" ? value : "";
}

// -------------------------------------------------------------------- ERD

/** The payload as the editor sees it, tolerating a malformed file. */
export function readErdTable(semantic: unknown): ErdTableSemantic {
  const source = asRecord(semantic);
  return {
    ...source,
    tableName: stringField(source, "tableName"),
    columns: Array.isArray(source["columns"])
      ? (source["columns"] as ErdColumn[])
      : [],
  };
}

export function readErdRelation(semantic: unknown): ErdRelationSemantic {
  const source = asRecord(semantic);
  const from = asRecord(source["from"]);
  const to = asRecord(source["to"]);
  return {
    ...source,
    from: { ...from, table: stringField(from, "table") },
    to: { ...to, table: stringField(to, "table") },
    cardinality: (stringField(source, "cardinality") ||
      "1:*") as ErdRelationSemantic["cardinality"],
  };
}

export interface ErdColumnPair {
  readonly from: string;
  readonly to: string;
}

function endpointColumns(endpoint: ErdEndpoint): readonly string[] {
  return endpoint.columns?.length
    ? endpoint.columns
    : endpoint.column
      ? [endpoint.column]
      : [];
}

function withEndpointColumns(
  endpoint: ErdEndpoint,
  columns: readonly string[],
): ErdEndpoint {
  const { column: _column, columns: _columns, ...rest } = endpoint;
  const unique = [...new Set(columns.filter(Boolean))];
  if (unique.length === 0) return rest;
  if (unique.length === 1) return { ...rest, column: unique[0] };
  return { ...rest, columns: unique };
}

/** Ordered pairs used by one simple or composite foreign key. */
export function readErdColumnPairs(
  semantic: ErdRelationSemantic,
): readonly ErdColumnPair[] {
  const from = endpointColumns(semantic.from);
  const to = endpointColumns(semantic.to);
  return Array.from(
    { length: Math.min(from.length, to.length) },
    (_, index) => ({ from: from[index] as string, to: to[index] as string }),
  );
}

export function setErdColumnPair(
  semantic: ErdRelationSemantic,
  index: number,
  end: "from" | "to",
  columnId: string,
): ErdRelationSemantic {
  const pairs = readErdColumnPairs(semantic);
  if (index < 0 || index >= pairs.length || !columnId) return semantic;
  if (pairs.some((pair, at) => at !== index && pair[end] === columnId))
    return semantic;
  const next = pairs.map((pair, at) =>
    at === index ? { ...pair, [end]: columnId } : pair,
  );
  return {
    ...semantic,
    from: withEndpointColumns(
      semantic.from,
      next.map((pair) => pair.from),
    ),
    to: withEndpointColumns(
      semantic.to,
      next.map((pair) => pair.to),
    ),
  };
}

export function addErdColumnPair(
  semantic: ErdRelationSemantic,
  pair: ErdColumnPair,
): ErdRelationSemantic {
  const pairs = readErdColumnPairs(semantic);
  if (
    !pair.from ||
    !pair.to ||
    pairs.some(({ from }) => from === pair.from) ||
    pairs.some(({ to }) => to === pair.to)
  )
    return semantic;
  const next = [...pairs, pair];
  return {
    ...semantic,
    from: withEndpointColumns(
      semantic.from,
      next.map(({ from }) => from),
    ),
    to: withEndpointColumns(
      semantic.to,
      next.map(({ to }) => to),
    ),
  };
}

export function removeErdColumnPair(
  semantic: ErdRelationSemantic,
  index: number,
): ErdRelationSemantic {
  const pairs = readErdColumnPairs(semantic);
  if (index < 0 || index >= pairs.length) return semantic;
  const next = pairs.filter((_, at) => at !== index);
  return {
    ...semantic,
    from: withEndpointColumns(
      semantic.from,
      next.map(({ from }) => from),
    ),
    to: withEndpointColumns(
      semantic.to,
      next.map(({ to }) => to),
    ),
  };
}

export function moveErdColumnPair(
  semantic: ErdRelationSemantic,
  index: number,
  delta: number,
): ErdRelationSemantic {
  const pairs = readErdColumnPairs(semantic);
  const next = moveItem(pairs, index, index + delta);
  if (next === pairs) return semantic;
  return {
    ...semantic,
    from: withEndpointColumns(
      semantic.from,
      next.map(({ from }) => from),
    ),
    to: withEndpointColumns(
      semantic.to,
      next.map(({ to }) => to),
    ),
  };
}

/** Store the portable default implicitly so old and newly edited files agree. */
export function setErdReferentialAction(
  semantic: ErdRelationSemantic,
  field: "onDelete" | "onUpdate",
  action: ReferentialAction,
): ErdRelationSemantic {
  const next = { ...semantic } as Record<string, unknown>;
  if (action === "no-action") delete next[field];
  else next[field] = action;
  return next as unknown as ErdRelationSemantic;
}

/** Store non-default foreign-key timing while keeping the default implicit. */
export function setErdDeferrability(
  semantic: ErdRelationSemantic,
  value: ForeignKeyDeferrability,
): ErdRelationSemantic {
  if (value === "not-deferrable") {
    const { deferrability: _removed, ...next } = semantic;
    return next;
  }
  return { ...semantic, deferrability: value };
}

export function addErdColumn(
  semantic: ErdTableSemantic,
  id: string,
): ErdTableSemantic {
  const column: ErdColumn = {
    id,
    name: `column_${semantic.columns.length + 1}`,
    dataType: "text",
  };
  return { ...semantic, columns: [...semantic.columns, column] };
}

export function removeErdColumn(
  semantic: ErdTableSemantic,
  columnId: string,
): ErdTableSemantic {
  return {
    ...semantic,
    columns: semantic.columns.filter((column) => column.id !== columnId),
    ...(semantic.indexes
      ? {
          indexes: semantic.indexes.map((index) => ({
            ...index,
            columns: index.columns.filter((id) => id !== columnId),
          })),
        }
      : {}),
  };
}

export function moveErdColumn(
  semantic: ErdTableSemantic,
  columnId: string,
  delta: number,
): ErdTableSemantic {
  const from = semantic.columns.findIndex((column) => column.id === columnId);
  if (from < 0) {
    return semantic;
  }
  const columns = moveItem(semantic.columns, from, from + delta);
  return columns === semantic.columns ? semantic : { ...semantic, columns };
}

export type ErdColumnPatch = Partial<Omit<ErdColumn, "id">>;

/** Apply a field change to one column; the id and the order stay put. */
export function updateErdColumn(
  semantic: ErdTableSemantic,
  columnId: string,
  patch: ErdColumnPatch,
): ErdTableSemantic {
  return {
    ...semantic,
    columns: semantic.columns.map((column) => {
      if (column.id !== columnId) {
        return column;
      }
      let next: ErdColumn = column;
      if (patch.name !== undefined) {
        next = { ...next, name: patch.name };
      }
      if (patch.dataType !== undefined) {
        next = { ...next, dataType: patch.dataType };
      }
      if (patch.pk !== undefined) {
        next = withOptionalFlag(next, "pk", patch.pk);
        if (patch.pk) {
          const { generatedExpression: _generatedExpression, ...rest } = next;
          next = rest;
        }
      }
      if (patch.nullable !== undefined) {
        next = withOptionalFlag(next, "nullable", patch.nullable);
      }
      if (patch.defaultExpression !== undefined) {
        next = withOptionalString(
          next,
          "defaultExpression",
          patch.defaultExpression,
        );
        if (patch.defaultExpression.trim()) {
          const { generatedExpression: _generatedExpression, ...rest } = next;
          next = rest;
        }
      }
      if (patch.generatedExpression !== undefined) {
        next = withOptionalString(
          next,
          "generatedExpression",
          patch.generatedExpression,
        );
        if (patch.generatedExpression.trim()) {
          const {
            defaultExpression: _defaultExpression,
            pk: _pk,
            ...rest
          } = next;
          next = rest;
        }
      }
      return next;
    }),
  };
}

export function addErdIndex(
  semantic: ErdTableSemantic,
  id: string,
): ErdTableSemantic {
  const index: ErdIndex = {
    id,
    columns: semantic.columns[0] ? [semantic.columns[0].id] : [],
  };
  return { ...semantic, indexes: [...(semantic.indexes ?? []), index] };
}

export function removeErdIndex(
  semantic: ErdTableSemantic,
  indexId: string,
): ErdTableSemantic {
  const indexes = (semantic.indexes ?? []).filter(
    (index) => index.id !== indexId,
  );
  if (indexes.length === (semantic.indexes?.length ?? 0)) return semantic;
  if (indexes.length) return { ...semantic, indexes };
  const { indexes: _removed, ...next } = semantic;
  return next;
}

export type ErdIndexPatch = Partial<Omit<ErdIndex, "id">>;

export function updateErdIndex(
  semantic: ErdTableSemantic,
  indexId: string,
  patch: ErdIndexPatch,
): ErdTableSemantic {
  if (!(semantic.indexes ?? []).some((index) => index.id === indexId))
    return semantic;
  const allowedColumns = new Set(semantic.columns.map((column) => column.id));
  return {
    ...semantic,
    indexes: (semantic.indexes ?? []).map((index) => {
      if (index.id !== indexId) return index;
      let next: ErdIndex = index;
      if (patch.name !== undefined)
        next = withOptionalString(next, "name", patch.name);
      if (patch.columns !== undefined)
        next = {
          ...next,
          columns: [...new Set(patch.columns)].filter((id) =>
            allowedColumns.has(id),
          ),
        };
      if (patch.unique !== undefined)
        next = withOptionalFlag(next, "unique", patch.unique);
      return next;
    }),
  };
}

export function addErdCheck(
  semantic: ErdTableSemantic,
  id: string,
): ErdTableSemantic {
  const check: ErdCheckConstraint = { id, expression: "1 = 1" };
  return { ...semantic, checks: [...(semantic.checks ?? []), check] };
}

export function removeErdCheck(
  semantic: ErdTableSemantic,
  checkId: string,
): ErdTableSemantic {
  const checks = (semantic.checks ?? []).filter(
    (check) => check.id !== checkId,
  );
  if (checks.length === (semantic.checks?.length ?? 0)) return semantic;
  if (checks.length) return { ...semantic, checks };
  const { checks: _removed, ...next } = semantic;
  return next;
}

export type ErdCheckPatch = Partial<Omit<ErdCheckConstraint, "id">>;

export function updateErdCheck(
  semantic: ErdTableSemantic,
  checkId: string,
  patch: ErdCheckPatch,
): ErdTableSemantic {
  if (!(semantic.checks ?? []).some((check) => check.id === checkId))
    return semantic;
  return {
    ...semantic,
    checks: (semantic.checks ?? []).map((check) => {
      if (check.id !== checkId) return check;
      let next: ErdCheckConstraint = check;
      if (patch.name !== undefined)
        next = withOptionalString(next, "name", patch.name);
      if (patch.expression !== undefined)
        next = { ...next, expression: patch.expression };
      return next;
    }),
  };
}

/** Point one end of a relation at a column, or at the table as a whole. */
export function setErdEndpointColumn(
  semantic: ErdRelationSemantic,
  end: "from" | "to",
  columnId: string,
): ErdRelationSemantic {
  return {
    ...semantic,
    [end]: withEndpointColumns(semantic[end], columnId ? [columnId] : []),
  };
}

// -------------------------------------------------------------------- UML

export function readUmlClass(semantic: unknown): UmlClassSemantic {
  const source = asRecord(semantic);
  return {
    ...source,
    name: stringField(source, "name"),
    attributes: Array.isArray(source["attributes"])
      ? (source["attributes"] as UmlAttribute[])
      : [],
    methods: Array.isArray(source["methods"])
      ? (source["methods"] as UmlMethod[])
      : [],
  };
}

export function addUmlAttribute(
  semantic: UmlClassSemantic,
  id: string,
): UmlClassSemantic {
  const attribute: UmlAttribute = {
    id,
    name: `attribute${semantic.attributes.length + 1}`,
  };
  return { ...semantic, attributes: [...semantic.attributes, attribute] };
}

export function removeUmlAttribute(
  semantic: UmlClassSemantic,
  attributeId: string,
): UmlClassSemantic {
  return {
    ...semantic,
    attributes: semantic.attributes.filter(
      (attribute) => attribute.id !== attributeId,
    ),
  };
}

export function moveUmlAttribute(
  semantic: UmlClassSemantic,
  attributeId: string,
  delta: number,
): UmlClassSemantic {
  const from = semantic.attributes.findIndex(
    (attribute) => attribute.id === attributeId,
  );
  if (from < 0) {
    return semantic;
  }
  const attributes = moveItem(semantic.attributes, from, from + delta);
  return attributes === semantic.attributes
    ? semantic
    : { ...semantic, attributes };
}

export type UmlAttributePatch = Partial<Omit<UmlAttribute, "id">>;

export function updateUmlAttribute(
  semantic: UmlClassSemantic,
  attributeId: string,
  patch: UmlAttributePatch,
): UmlClassSemantic {
  return {
    ...semantic,
    attributes: semantic.attributes.map((attribute) => {
      if (attribute.id !== attributeId) {
        return attribute;
      }
      let next: UmlAttribute = attribute;
      if (patch.name !== undefined) {
        next = { ...next, name: patch.name };
      }
      if (patch.type !== undefined) {
        next = withOptionalString(next, "type", patch.type);
      }
      if (patch.visibility !== undefined) {
        next = { ...next, visibility: patch.visibility };
      }
      if (patch.static !== undefined) {
        next = withOptionalFlag(next, "static", patch.static);
      }
      return next;
    }),
  };
}

export function addUmlMethod(
  semantic: UmlClassSemantic,
  id: string,
): UmlClassSemantic {
  const method: UmlMethod = {
    id,
    name: `method${semantic.methods.length + 1}`,
  };
  return { ...semantic, methods: [...semantic.methods, method] };
}

export function removeUmlMethod(
  semantic: UmlClassSemantic,
  methodId: string,
): UmlClassSemantic {
  return {
    ...semantic,
    methods: semantic.methods.filter((method) => method.id !== methodId),
  };
}

export function moveUmlMethod(
  semantic: UmlClassSemantic,
  methodId: string,
  delta: number,
): UmlClassSemantic {
  const from = semantic.methods.findIndex((method) => method.id === methodId);
  if (from < 0) {
    return semantic;
  }
  const methods = moveItem(semantic.methods, from, from + delta);
  return methods === semantic.methods ? semantic : { ...semantic, methods };
}

export type UmlMethodPatch = Partial<Omit<UmlMethod, "id">>;

export function updateUmlMethod(
  semantic: UmlClassSemantic,
  methodId: string,
  patch: UmlMethodPatch,
): UmlClassSemantic {
  return {
    ...semantic,
    methods: semantic.methods.map((method) => {
      if (method.id !== methodId) {
        return method;
      }
      let next: UmlMethod = method;
      if (patch.name !== undefined) {
        next = { ...next, name: patch.name };
      }
      if (patch.parameters !== undefined) {
        const { parameters: _dropped, ...rest } = next;
        next =
          patch.parameters.length === 0
            ? rest
            : { ...rest, parameters: patch.parameters };
      }
      if (patch.returnType !== undefined) {
        next = withOptionalString(next, "returnType", patch.returnType);
      }
      if (patch.visibility !== undefined) {
        next = { ...next, visibility: patch.visibility };
      }
      if (patch.static !== undefined) {
        next = withOptionalFlag(next, "static", patch.static);
      }
      if (patch.abstract !== undefined) {
        next = withOptionalFlag(next, "abstract", patch.abstract);
      }
      return next;
    }),
  };
}

/**
 * Parse `a: T, b: U` into parameters. Commas separate parameters, the first
 * colon separates a name from its type, and a parameter without a name is
 * dropped. Generics with commas inside angle brackets stay whole.
 */
export function parseParameters(text: string): readonly UmlParameter[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "<" || character === "(" || character === "[") {
      depth += 1;
    } else if (character === ">" || character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
    }
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);

  const out: UmlParameter[] = [];
  for (const part of parts) {
    const colon = part.indexOf(":");
    const name = (colon < 0 ? part : part.slice(0, colon)).trim();
    const type = colon < 0 ? "" : part.slice(colon + 1).trim();
    if (name === "") {
      continue;
    }
    out.push(type === "" ? { name } : { name, type });
  }
  return out;
}

export function serializeParameters(
  parameters: readonly UmlParameter[] | undefined,
): string {
  return (parameters ?? [])
    .map((parameter) =>
      parameter.type ? `${parameter.name}: ${parameter.type}` : parameter.name,
    )
    .join(", ");
}
