import type { ErdColumn } from "@nodetto/ir";
import type { DatabaseDialect } from "./database-ddl.ts";

export type DefinitionColumn = Omit<ErdColumn, "id">;
export type DefinitionResult =
  | {
      readonly columns: readonly DefinitionColumn[];
      readonly error?: undefined;
    }
  | { readonly columns?: undefined; readonly error: string };

/** Split at top-level commas, never inside quoted strings or type/expression parentheses. */
function splitDefinitions(text: string): string[] {
  const rows: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) i++;
        else quote = "";
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "[") quote = "]";
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0)
      throw new Error("Unexpected closing parenthesis.");
    else if (ch === ";")
      throw new Error("Enter column definitions, not SQL statements.");
    else if (ch === "," && depth === 0) {
      rows.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || depth) throw new Error("Unclosed quote or parenthesis.");
  const last = text.slice(start).trim();
  if (last) rows.push(last);
  if (rows.some((row) => !row)) throw new Error("Empty column definition.");
  return rows;
}

function identifier(row: string, dialect: DatabaseDialect): [string, string] {
  const quote = row[0];
  if (quote === '"' || quote === "`" || quote === "[") {
    if (
      (quote === "`" && dialect === "postgresql") ||
      (quote === "[" && dialect !== "sqlite")
    )
      throw new Error("Identifier quoting does not match the page dialect.");
    const end = quote === "[" ? "]" : quote;
    let name = "";
    for (let i = 1; i < row.length; i++) {
      if (row[i] === end) {
        if (row[i + 1] === end) {
          name += end;
          i++;
        } else return [name, row.slice(i + 1).trim()];
      } else name += row[i];
    }
    throw new Error("Unclosed column name.");
  }
  const match = /^([\p{L}_][\p{L}\p{N}_$]*)\s+(.*)$/u.exec(row);
  if (!match) throw new Error("Expected a column name and type.");
  return [match[1] ?? "", match[2] ?? ""];
}

/** Portable column definitions; unsupported clauses fail rather than disappear. */
export function parseErdDefinition(
  text: string,
  dialect: DatabaseDialect,
): DefinitionResult {
  try {
    if (text.length > 100_000)
      throw new Error("Definition exceeds 100,000 characters.");
    const rows = splitDefinitions(text.trim());
    if (rows.length > 1000)
      throw new Error("At most 1,000 columns are supported.");
    const seen = new Set<string>();
    const columns = rows.map((row, index): DefinitionColumn => {
      try {
        const [name, body] = identifier(row, dialect);
        if (!name || seen.has(name.toLowerCase()))
          throw new Error("Empty or duplicate column name.");
        seen.add(name.toLowerCase());
        const type =
          /^(autoincremente?\b|auto_increment\b|[a-z][a-z0-9_]*(?:\s+(?:precision|varying|with time zone|without time zone))?(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)(.*)$/i.exec(
            body,
          );
        if (!type) throw new Error("Expected a SQL data type.");
        let dataType = (type[1] ?? "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .replace(/\s*\(\s*/g, "(")
          .replace(/\s*,\s*/g, ",")
          .replace(/\s*\)/g, ")");
        let rest = (type[2] ?? "").trim();
        let autoIncrement =
          /^auto/.test(dataType) ||
          /^(smallserial|serial|bigserial)$/.test(dataType);
        if (/serial$/.test(dataType) && dialect !== "postgresql")
          throw new Error("SERIAL requires PostgreSQL input dialect.");
        if (/^auto/.test(dataType)) dataType = "integer";
        else if (/serial$/.test(dataType))
          dataType =
            dataType === "bigserial"
              ? "bigint"
              : dataType === "smallserial"
                ? "smallint"
                : "integer";
        let pk = false;
        let nullable = true;
        let nullSeen = false;
        let defaultExpression: string | undefined;
        let generatedExpression: string | undefined;
        while (rest) {
          const primary = /^(?:PRIMARY\s+KEY|PK)\b\s*/i.exec(rest);
          const nullability = /^(NOT\s+NULL|NULL)\b\s*/i.exec(rest);
          const identity =
            /^(AUTO_INCREMENT|AUTOINCREMENT|AUTOINCREMENTE|GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY)\b\s*/i.exec(
              rest,
            );
          if (primary) {
            if (pk) throw new Error("Repeated primary key clause.");
            pk = true;
            rest = rest.slice(primary[0].length);
          } else if (nullability) {
            if (nullSeen) throw new Error("Repeated nullability clause.");
            nullSeen = true;
            nullable = /^NULL/i.test(nullability[1] ?? "");
            rest = rest.slice(nullability[0].length);
          } else if (identity) {
            if (autoIncrement)
              throw new Error("Repeated auto-increment clause.");
            if (/^GENERATED/i.test(identity[0]) && dialect !== "postgresql")
              throw new Error("IDENTITY requires PostgreSQL input dialect.");
            autoIncrement = true;
            rest = rest.slice(identity[0].length);
          } else if (/^DEFAULT\s+/i.test(rest)) {
            if (defaultExpression) throw new Error("Repeated default clause.");
            const value =
              /^DEFAULT\s+('(?:[^']|'')*'|[+-]?\d+(?:\.\d+)?|TRUE\b|FALSE\b|NULL\b|CURRENT_TIMESTAMP\b|CURRENT_DATE\b|CURRENT_TIME\b)\s*/i.exec(
                rest,
              );
            if (!value)
              throw new Error(
                "Use a literal or CURRENT_TIMESTAMP/DATE/TIME default.",
              );
            defaultExpression = value[1];
            rest = rest.slice(value[0].length);
          } else if (/^GENERATED\s+ALWAYS\s+AS\s*\(/i.test(rest)) {
            const generated =
              /^GENERATED\s+ALWAYS\s+AS\s*\(([\s\S]*)\)\s+STORED\s*$/i.exec(
                rest,
              );
            if (!generated || generatedExpression)
              throw new Error(
                "Expected GENERATED ALWAYS AS (expression) STORED.",
              );
            generatedExpression = generated[1]?.trim();
            rest = "";
          } else throw new Error(`Unsupported clause: ${rest.slice(0, 48)}`);
        }
        if (pk && nullSeen && nullable)
          throw new Error("Primary keys cannot be nullable.");
        if (pk) nullable = false;
        if (defaultExpression && generatedExpression)
          throw new Error("Choose a default or generated expression.");
        return {
          name,
          dataType,
          pk,
          nullable,
          ...(autoIncrement ? { autoIncrement: true } : {}),
          ...(defaultExpression ? { defaultExpression } : {}),
          ...(generatedExpression ? { generatedExpression } : {}),
        };
      } catch (cause) {
        throw new Error(
          `Column ${index + 1}: ${cause instanceof Error ? cause.message : "Invalid definition."}`,
        );
      }
    });
    for (const column of columns) {
      if (
        column.autoIncrement &&
        (!column.pk ||
          !/^(int|integer|smallint|bigint)$/.test(column.dataType) ||
          columns.filter((item) => item.pk).length !== 1 ||
          column.defaultExpression ||
          column.generatedExpression)
      )
        throw new Error(
          `${column.name}: auto-increment requires a single integer primary key without a default or generated expression.`,
        );
    }
    return { columns };
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "Invalid definition.",
    };
  }
}

export function formatErdDefinition(
  columns: readonly ErdColumn[],
  dialect: DatabaseDialect,
): string {
  const quote = dialect === "mysql" ? "`" : '"';
  return columns
    .map((column) => {
      const parts = [
        quote + column.name.replaceAll(quote, quote + quote) + quote,
        column.dataType,
      ];
      if (column.autoIncrement && dialect === "postgresql")
        parts.push("GENERATED BY DEFAULT AS IDENTITY");
      if (column.pk) parts.push("PRIMARY KEY");
      else parts.push(column.nullable ? "NULL" : "NOT NULL");
      if (column.autoIncrement && dialect !== "postgresql")
        parts.push(dialect === "mysql" ? "AUTO_INCREMENT" : "AUTOINCREMENT");
      if (column.defaultExpression)
        parts.push("DEFAULT", column.defaultExpression);
      if (column.generatedExpression)
        parts.push(
          "GENERATED ALWAYS AS",
          `(${column.generatedExpression})`,
          "STORED",
        );
      return parts.join(" ");
    })
    .join(",\n");
}
