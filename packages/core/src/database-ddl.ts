import type {
  Element,
  ErdColumn,
  ErdRelationSemantic,
  ErdTableSemantic,
  ForeignKeyDeferrability,
  PageId,
  ReferentialAction,
} from "@diagra/ir";
import { erdEndpointColumnIds } from "@diagra/ir";
import type { Editor } from "./editor.ts";

export const DATABASE_DIALECTS = ["postgresql", "mysql", "sqlite"] as const;
export type DatabaseDialect = (typeof DATABASE_DIALECTS)[number];

export interface DatabaseDdl {
  readonly dialect: DatabaseDialect;
  readonly sql: string;
  readonly warnings: readonly string[];
  readonly tableCount: number;
  readonly relationCount: number;
  readonly indexCount: number;
  readonly checkCount: number;
}

interface TableModel {
  readonly element: Element;
  readonly semantic: ErdTableSemantic;
  readonly constraints: string[];
  readonly foreignConstraints: string[];
}

function quoteIdentifier(value: string, dialect: DatabaseDialect): string {
  return dialect === "mysql"
    ? `\`${value.replaceAll("`", "``")}\``
    : `"${value.replaceAll('"', '""')}"`;
}

function constraintStem(value: string): string {
  const stem = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return (stem || "constraint").slice(0, 55);
}

function typeFor(
  column: ErdColumn,
  dialect: DatabaseDialect,
  warnings: string[],
  tableName: string,
): string {
  const raw = column.dataType.trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  const portable: Record<string, readonly [string, string, string]> = {
    uuid: ["UUID", "CHAR(36)", "TEXT"],
    int: ["INTEGER", "INTEGER", "INTEGER"],
    integer: ["INTEGER", "INTEGER", "INTEGER"],
    bigint: ["BIGINT", "BIGINT", "INTEGER"],
    smallint: ["SMALLINT", "SMALLINT", "INTEGER"],
    text: ["TEXT", "TEXT", "TEXT"],
    string: ["TEXT", "VARCHAR(255)", "TEXT"],
    boolean: ["BOOLEAN", "BOOLEAN", "INTEGER"],
    bool: ["BOOLEAN", "BOOLEAN", "INTEGER"],
    timestamp: ["TIMESTAMP", "TIMESTAMP", "TEXT"],
    datetime: ["TIMESTAMP", "DATETIME", "TEXT"],
    date: ["DATE", "DATE", "TEXT"],
    json: ["JSONB", "JSON", "TEXT"],
    jsonb: ["JSONB", "JSON", "TEXT"],
    real: ["REAL", "DOUBLE", "REAL"],
    float: ["DOUBLE PRECISION", "DOUBLE", "REAL"],
    double: ["DOUBLE PRECISION", "DOUBLE", "REAL"],
    "double precision": ["DOUBLE PRECISION", "DOUBLE", "REAL"],
    "character varying": ["VARCHAR", "VARCHAR(255)", "TEXT"],
    "timestamp with time zone": ["TIMESTAMPTZ", "TIMESTAMP", "TEXT"],
    "timestamp without time zone": ["TIMESTAMP", "TIMESTAMP", "TEXT"],
    decimal: ["DECIMAL", "DECIMAL", "NUMERIC"],
    numeric: ["NUMERIC", "DECIMAL", "NUMERIC"],
    blob: ["BYTEA", "BLOB", "BLOB"],
    bytes: ["BYTEA", "BLOB", "BLOB"],
  };
  const mapped = portable[normalized];
  if (mapped)
    return mapped[dialect === "postgresql" ? 0 : dialect === "mysql" ? 1 : 2];
  if (
    /^[a-z][a-z0-9_]*(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\[\])?$/i.test(raw)
  ) {
    if (dialect !== "sqlite")
      warnings.push(
        `${tableName}.${column.name}: custom type "${raw}" was preserved; verify dialect support.`,
      );
    return raw;
  }
  warnings.push(
    `${tableName}.${column.name}: unsafe or empty type was replaced with TEXT.`,
  );
  return "TEXT";
}

function comment(value: string): string {
  return value.replace(/[\n\r]+/g, " ");
}

const ACTION_SQL: Readonly<Record<ReferentialAction, string>> = {
  "no-action": "NO ACTION",
  restrict: "RESTRICT",
  cascade: "CASCADE",
  "set-null": "SET NULL",
  "set-default": "SET DEFAULT",
};

function referentialActionClause(
  action: ReferentialAction | undefined,
  kind: "DELETE" | "UPDATE",
  dialect: DatabaseDialect,
  relationId: string,
  warnings: string[],
): string {
  if (!action || action === "no-action") return "";
  if (dialect === "mysql" && action === "set-default") {
    warnings.push(
      `${relationId}: MySQL does not support ON ${kind} SET DEFAULT; the action was omitted.`,
    );
    return "";
  }
  return ` ON ${kind} ${ACTION_SQL[action]}`;
}

function deferrabilityClause(
  value: ForeignKeyDeferrability | undefined,
  dialect: DatabaseDialect,
  relationId: string,
  warnings: string[],
): string {
  if (!value || value === "not-deferrable") return "";
  if (dialect === "mysql") {
    warnings.push(
      `${relationId}: MySQL does not support deferrable foreign keys; the constraint timing was omitted.`,
    );
    return "";
  }
  return value === "initially-deferred"
    ? " DEFERRABLE INITIALLY DEFERRED"
    : " DEFERRABLE INITIALLY IMMEDIATE";
}

function sameColumnIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((columnId, index) => columnId === right[index])
  );
}

function isUniqueKey(
  table: ErdTableSemantic,
  columnIds: readonly string[],
): boolean {
  const primary = table.columns
    .filter((column) => column.pk)
    .map((column) => column.id);
  return (
    sameColumnIds(primary, columnIds) ||
    (table.indexes ?? []).some(
      (index) => index.unique && sameColumnIds(index.columns, columnIds),
    )
  );
}

function defaultFor(
  column: ErdColumn,
  dialect: DatabaseDialect,
  warnings: string[],
  tableName: string,
): string | undefined {
  const raw = column.defaultExpression?.trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  if (
    /^(?:null|true|false|current_date|current_time|current_timestamp)$/i.test(
      raw,
    ) ||
    /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw) ||
    /^'(?:''|[^'\r\n])*'$/.test(raw)
  )
    return raw;
  if (normalized === "now()") return "CURRENT_TIMESTAMP";
  if (
    dialect === "postgresql" &&
    /^(?:gen_random_uuid|uuid_generate_v4)\(\)$/i.test(raw)
  )
    return raw;
  warnings.push(
    `${tableName}.${column.name}: unsupported default expression "${raw}" was omitted. Use a literal, CURRENT_DATE/TIME/TIMESTAMP or a supported UUID function.`,
  );
  return undefined;
}

function generatedFor(
  column: ErdColumn,
  warnings: string[],
  tableName: string,
): string | undefined {
  const raw = column.generatedExpression?.trim();
  if (!raw) return undefined;
  if (safeCheckExpression(raw)) return raw;
  warnings.push(
    `${tableName}.${column.name}: unsafe or unsupported generated expression "${raw}" was omitted. Use one portable row-local SQL expression.`,
  );
  return undefined;
}

function safeCheckExpression(raw: string): boolean {
  if (!raw || raw.length > 512) return false;
  for (const character of raw) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  if (
    raw.includes(";") ||
    raw.includes("--") ||
    raw.includes("/*") ||
    raw.includes("*/")
  )
    return false;
  if (!/^[A-Za-z0-9_\s'(),.+\-*/%<>=!|&]+$/.test(raw)) return false;
  let depth = 0;
  let outside = "";
  for (let i = 0; i < raw.length; i += 1) {
    const character = raw[i] as string;
    if (character === "'") {
      i += 1;
      while (i < raw.length) {
        if (raw[i] === "'" && raw[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (raw[i] === "'") break;
        i += 1;
      }
      if (i >= raw.length) return false;
      outside += " ";
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")" && --depth < 0) return false;
    outside += character;
  }
  if (depth !== 0) return false;
  return !/\b(?:select|insert|update|delete|drop|alter|create|attach|detach|pragma|union|with)\b/i.test(
    outside,
  );
}

/** Deterministic, read-only SQL schema export for one ERD page. */
export function generateDatabaseDdl(
  editor: Editor,
  pageId: PageId,
  dialect: DatabaseDialect,
): DatabaseDdl {
  const warnings: string[] = [];
  const elements = editor.store.getPageElements(pageId);
  const tables: TableModel[] = elements
    .filter((element) => element.type === "erd.table")
    .map((element) => ({
      element,
      semantic: element.semantic as ErdTableSemantic,
      constraints: [],
      foreignConstraints: [],
    }));
  const relations = elements.filter(
    (element) => element.type === "erd.relation",
  );
  const tablesById = new Map(tables.map((table) => [table.element.id, table]));
  const tableNames = new Set<string>();
  for (const table of tables) {
    const key = table.semantic.tableName.toLocaleLowerCase("en-US");
    if (tableNames.has(key))
      warnings.push(`Duplicate table name: ${table.semantic.tableName}.`);
    tableNames.add(key);
    const columnNames = new Set<string>();
    for (const column of table.semantic.columns) {
      const columnKey = column.name.toLocaleLowerCase("en-US");
      if (columnNames.has(columnKey))
        warnings.push(
          `${table.semantic.tableName}: duplicate column name ${column.name}.`,
        );
      columnNames.add(columnKey);
    }
  }

  const usedConstraintNames = new Set<string>();
  const constraintName = (preferred: string, explicit = false): string => {
    if (explicit) {
      const key = preferred.toLocaleLowerCase("en-US");
      if (usedConstraintNames.has(key))
        warnings.push(`Duplicate constraint name: ${preferred}.`);
      if (
        dialect === "postgresql" &&
        new TextEncoder().encode(preferred).length > 63
      )
        warnings.push(
          `Constraint name ${preferred} exceeds PostgreSQL's 63-byte identifier limit and may be truncated by the database.`,
        );
      usedConstraintNames.add(key);
      return quoteIdentifier(preferred, dialect);
    }
    const base = constraintStem(preferred);
    let candidate = base;
    let suffix = 2;
    while (usedConstraintNames.has(candidate)) {
      candidate = `${base.slice(0, 55 - String(suffix).length - 1)}_${suffix}`;
      suffix += 1;
    }
    usedConstraintNames.add(candidate);
    return quoteIdentifier(candidate, dialect);
  };

  for (const table of tables) {
    for (const check of table.semantic.checks ?? []) {
      const expression = check.expression.trim();
      if (!safeCheckExpression(expression)) {
        warnings.push(
          `${table.semantic.tableName}: check ${check.name?.trim() || check.id} has an empty, unsafe or unsupported expression and was omitted.`,
        );
        continue;
      }
      table.constraints.push(
        `CONSTRAINT ${constraintName(check.name?.trim() || `ck_${table.semantic.tableName}_${check.id}`, Boolean(check.name?.trim()))} CHECK (${expression})`,
      );
    }
  }

  for (const relation of relations) {
    const semantic = relation.semantic as ErdRelationSemantic;
    if (semantic.cardinality === "*:*") {
      warnings.push(
        `${relation.id}: many-to-many relation requires an explicit junction table.`,
      );
      continue;
    }
    const localEnd =
      semantic.cardinality === "*:1" ? semantic.from : semantic.to;
    const remoteEnd =
      semantic.cardinality === "*:1" ? semantic.to : semantic.from;
    const local = tablesById.get(localEnd.table);
    const remote = tablesById.get(remoteEnd.table);
    if (!local || !remote) {
      warnings.push(
        `${relation.id}: relation references a table outside this page.`,
      );
      continue;
    }
    const localColumnIds = erdEndpointColumnIds(localEnd);
    const remoteColumnIds = erdEndpointColumnIds(remoteEnd);
    if (!localColumnIds.length || !remoteColumnIds.length) {
      warnings.push(
        `${relation.id}: relation needs a column at both endpoints.`,
      );
      continue;
    }
    if (
      new Set(localColumnIds).size !== localColumnIds.length ||
      new Set(remoteColumnIds).size !== remoteColumnIds.length
    ) {
      warnings.push(
        `${relation.id}: foreign-key endpoints repeat a column; the constraint was omitted.`,
      );
      continue;
    }
    if (localColumnIds.length !== remoteColumnIds.length) {
      warnings.push(
        `${relation.id}: foreign-key endpoints contain different numbers of columns.`,
      );
      continue;
    }
    const localColumns = localColumnIds
      .map((id) => local.semantic.columns.find((column) => column.id === id))
      .filter((column): column is ErdColumn => column !== undefined);
    const remoteColumns = remoteColumnIds
      .map((id) => remote.semantic.columns.find((column) => column.id === id))
      .filter((column): column is ErdColumn => column !== undefined);
    if (
      localColumns.length !== localColumnIds.length ||
      remoteColumns.length !== remoteColumnIds.length
    ) {
      warnings.push(`${relation.id}: relation references a missing column.`);
      continue;
    }
    for (const localColumn of localColumns) {
      if (semantic.onDelete === "set-null" && !localColumn.nullable)
        warnings.push(
          `${relation.id}: ON DELETE SET NULL targets non-nullable column ${local.semantic.tableName}.${localColumn.name}.`,
        );
      if (semantic.onUpdate === "set-null" && !localColumn.nullable)
        warnings.push(
          `${relation.id}: ON UPDATE SET NULL targets non-nullable column ${local.semantic.tableName}.${localColumn.name}.`,
        );
      if (
        (semantic.onDelete === "set-default" ||
          semantic.onUpdate === "set-default") &&
        !localColumn.defaultExpression?.trim()
      )
        warnings.push(
          `${relation.id}: SET DEFAULT targets ${local.semantic.tableName}.${localColumn.name}, which has no authored default expression.`,
        );
    }
    if (!isUniqueKey(remote.semantic, remoteColumnIds))
      warnings.push(
        `${relation.id}: referenced columns ${remote.semantic.tableName}.(${remoteColumns.map((column) => column.name).join(", ")}) are not a primary or matching unique key.`,
      );
    const name = constraintName(
      `fk_${local.semantic.tableName}_${localColumns.map((column) => column.name).join("_")}_${remote.semantic.tableName}`,
    );
    local.foreignConstraints.push(
      `CONSTRAINT ${name} FOREIGN KEY (${localColumns.map((column) => quoteIdentifier(column.name, dialect)).join(", ")}) REFERENCES ${quoteIdentifier(remote.semantic.tableName, dialect)} (${remoteColumns.map((column) => quoteIdentifier(column.name, dialect)).join(", ")})${referentialActionClause(semantic.onDelete, "DELETE", dialect, relation.id, warnings)}${referentialActionClause(semantic.onUpdate, "UPDATE", dialect, relation.id, warnings)}${deferrabilityClause(semantic.deferrability, dialect, relation.id, warnings)}`,
    );
    if (
      semantic.cardinality === "1:1" &&
      !isUniqueKey(local.semantic, localColumnIds)
    )
      local.constraints.push(
        `CONSTRAINT ${constraintName(`uq_${local.semantic.tableName}_${localColumns.map((column) => column.name).join("_")}`)} UNIQUE (${localColumns.map((column) => quoteIdentifier(column.name, dialect)).join(", ")})`,
      );
  }

  const statements = tables.map((table) => {
    if (!table.semantic.columns.length) {
      warnings.push(`${table.semantic.tableName}: table has no columns.`);
      return `-- Skipped empty table ${quoteIdentifier(table.semantic.tableName, dialect)}.`;
    }
    const definitions = table.semantic.columns.map((column) => {
      const parts = [
        quoteIdentifier(column.name, dialect),
        typeFor(column, dialect, warnings, table.semantic.tableName),
      ];
      if (!column.nullable || column.pk) parts.push("NOT NULL");
      const generatedExpression = generatedFor(
        column,
        warnings,
        table.semantic.tableName,
      );
      if (generatedExpression) {
        parts.push("GENERATED ALWAYS AS", `(${generatedExpression})`, "STORED");
        if (column.defaultExpression?.trim())
          warnings.push(
            `${table.semantic.tableName}.${column.name}: default expression was omitted because the column is generated.`,
          );
      } else {
        const defaultExpression = defaultFor(
          column,
          dialect,
          warnings,
          table.semantic.tableName,
        );
        if (defaultExpression) parts.push("DEFAULT", defaultExpression);
      }
      return `  ${parts.join(" ")}`;
    });
    const primary = table.semantic.columns.filter((column) => column.pk);
    if (primary.length)
      definitions.push(
        `  CONSTRAINT ${constraintName(`pk_${table.semantic.tableName}`)} PRIMARY KEY (${primary.map((column) => quoteIdentifier(column.name, dialect)).join(", ")})`,
      );
    definitions.push(...table.constraints.map((value) => `  ${value}`));
    if (dialect === "sqlite")
      definitions.push(
        ...table.foreignConstraints.map((value) => `  ${value}`),
      );
    const suffix = dialect === "mysql" ? " ENGINE=InnoDB" : "";
    return `CREATE TABLE ${quoteIdentifier(table.semantic.tableName, dialect)} (\n${definitions.join(",\n")}\n)${suffix};`;
  });
  const foreignKeys =
    dialect === "sqlite"
      ? []
      : tables.flatMap((table) =>
          table.foreignConstraints.map(
            (constraint) =>
              `ALTER TABLE ${quoteIdentifier(table.semantic.tableName, dialect)} ADD ${constraint};`,
          ),
        );
  const usedIndexNames = new Set<string>();
  const allocateIndexName = (preferred: string, explicit: boolean): string => {
    if (explicit) {
      const key = preferred.toLocaleLowerCase("en-US");
      if (usedIndexNames.has(key))
        warnings.push(`Duplicate index name: ${preferred}.`);
      if (
        dialect === "postgresql" &&
        new TextEncoder().encode(preferred).length > 63
      )
        warnings.push(
          `Index name ${preferred} exceeds PostgreSQL's 63-byte identifier limit and may be truncated by the database.`,
        );
      usedIndexNames.add(key);
      return preferred;
    }
    const base = constraintStem(preferred);
    let candidate = base;
    let suffix = 2;
    while (usedIndexNames.has(candidate)) {
      candidate = `${base.slice(0, 55 - String(suffix).length - 1)}_${suffix}`;
      suffix += 1;
    }
    usedIndexNames.add(candidate);
    return candidate;
  };
  const indexes = tables.flatMap((table) =>
    (table.semantic.indexes ?? []).flatMap((index) => {
      const seenColumns = new Set<string>();
      const columns = index.columns.flatMap((columnId) => {
        if (seenColumns.has(columnId)) {
          warnings.push(
            `${table.semantic.tableName}: index ${index.name || index.id} repeats column ${columnId}; the duplicate was omitted.`,
          );
          return [];
        }
        seenColumns.add(columnId);
        const column = table.semantic.columns.find(
          (candidate) => candidate.id === columnId,
        );
        if (!column)
          warnings.push(
            `${table.semantic.tableName}: index ${index.name || index.id} references missing column ${columnId}.`,
          );
        return column ? [column] : [];
      });
      if (!columns.length) {
        warnings.push(
          `${table.semantic.tableName}: index ${index.name || index.id} has no usable columns and was skipped.`,
        );
        return [];
      }
      const primary = table.semantic.columns
        .filter((column) => column.pk)
        .map((column) => column.id);
      if (
        primary.length === index.columns.length &&
        primary.every((columnId, at) => columnId === index.columns[at])
      ) {
        warnings.push(
          `${table.semantic.tableName}: index ${index.name || index.id} duplicates the primary key and was skipped.`,
        );
        return [];
      }
      const explicitName = index.name?.trim() || undefined;
      const preferred =
        explicitName ||
        `${index.unique ? "uq" : "idx"}_${table.semantic.tableName}_${columns
          .map((column) => column.name)
          .join("_")}`;
      const name = allocateIndexName(preferred, explicitName !== undefined);
      return [
        `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quoteIdentifier(name, dialect)} ON ${quoteIdentifier(table.semantic.tableName, dialect)} (${columns.map((column) => quoteIdentifier(column.name, dialect)).join(", ")});`,
      ];
    }),
  );
  if (!tables.length) warnings.push("This page contains no ERD tables.");
  const header = [
    `-- Generated by diagra for ${dialect}.`,
    "-- Review this migration before applying it to a database.",
    ...warnings.map((warning) => `-- Warning: ${comment(warning)}`),
  ];
  const sql = [
    ...header,
    ...(dialect === "sqlite" && tables.length
      ? ["", "PRAGMA foreign_keys = ON;"]
      : []),
    ...(statements.length ? ["", statements.join("\n\n")] : []),
    ...(indexes.length ? ["", indexes.join("\n")] : []),
    ...(foreignKeys.length ? ["", foreignKeys.join("\n")] : []),
    "",
  ].join("\n");
  return {
    dialect,
    sql,
    warnings,
    tableCount: tables.length,
    relationCount: relations.length,
    indexCount: tables.reduce(
      (count, table) => count + (table.semantic.indexes?.length ?? 0),
      0,
    ),
    checkCount: tables.reduce(
      (count, table) => count + (table.semantic.checks?.length ?? 0),
      0,
    ),
  };
}
