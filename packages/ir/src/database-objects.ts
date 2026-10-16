import { checkArray, checkEnum, checkObject, checkString } from "./checks.ts";
import type { ElementTypeDefinition } from "./registry.ts";
import { error, type ValidationIssue } from "./issues.ts";
import type { ErdColumn } from "./semantics.ts";

export const DATABASE_OBJECT_LABELS = {
  "erd.view": "View",
  "erd.materialized-view": "Materialized view",
  "erd.function": "Function",
  "erd.procedure": "Procedure",
} as const;
export type DatabaseObjectType = keyof typeof DATABASE_OBJECT_LABELS;
export function isDatabaseObjectType(type: string): type is DatabaseObjectType {
  return Object.hasOwn(DATABASE_OBJECT_LABELS, type);
}
export interface DatabaseParameter {
  readonly id: string;
  readonly name: string;
  readonly dataType: string;
  readonly mode?: "in" | "out" | "inout";
}
export interface DatabaseObjectSemantic {
  readonly name: string;
  /** SELECT query for views; routine body for functions and procedures. */
  readonly definition: string;
  readonly columns?: readonly ErdColumn[];
  readonly parameters?: readonly DatabaseParameter[];
  readonly returnType?: string;
  readonly language?: "sql" | "plpgsql";
  readonly dependsOn?: readonly string[];
}
export const databaseObjectDefinitions: readonly ElementTypeDefinition[] =
  Object.keys(DATABASE_OBJECT_LABELS).map((type) => ({
    type: type as DatabaseObjectType,
    category: "node",
    onReferenceDeleted: "detach",
    keyOrder: {
      keys: [
        "name",
        "definition",
        "columns",
        "parameters",
        "returnType",
        "language",
        "dependsOn",
      ],
      children: {
        columns: { keys: ["id", "name", "dataType"] },
        parameters: { keys: ["id", "name", "dataType", "mode"] },
      },
    },
    references(semantic) {
      if (
        !semantic ||
        typeof semantic !== "object" ||
        !("dependsOn" in semantic) ||
        !Array.isArray(semantic.dependsOn)
      )
        return [];
      return semantic.dependsOn.flatMap((id, index) =>
        typeof id === "string" ? [{ id, field: `dependsOn[${index}]` }] : [],
      );
    },
    validateSemantic(semantic, path) {
      const out: ValidationIssue[] = [];
      if (!checkObject(out, semantic, path)) return out;
      checkString(out, semantic["name"], `${path}.name`);
      checkString(out, semantic["definition"], `${path}.definition`, {
        allowEmpty: true,
      });
      checkString(out, semantic["returnType"], `${path}.returnType`, {
        optional: true,
        allowEmpty: true,
      });
      checkEnum(
        out,
        semantic["language"],
        `${path}.language`,
        ["sql", "plpgsql"],
        { optional: true },
      );
      for (const field of ["columns", "parameters"] as const) {
        const rows = semantic[field];
        if (rows === undefined || !checkArray(out, rows, `${path}.${field}`))
          continue;
        const ids = new Set<string>();
        for (const [i, row] of rows.entries()) {
          const at = `${path}.${field}[${i}]`;
          if (!checkObject(out, row, at)) continue;
          for (const key of ["id", "name", "dataType"])
            checkString(out, row[key], `${at}.${key}`);
          if (typeof row["id"] === "string") {
            if (ids.has(row["id"]))
              out.push(error("id.duplicate", `${at}.id`, "duplicate row id"));
            ids.add(row["id"]);
          }
          if (field === "parameters")
            checkEnum(out, row["mode"], `${at}.mode`, ["in", "out", "inout"], {
              optional: true,
            });
        }
      }
      const dependencies = semantic["dependsOn"];
      if (
        dependencies !== undefined &&
        checkArray(out, dependencies, `${path}.dependsOn`)
      )
        dependencies.forEach((id, i) =>
          checkString(out, id, `${path}.dependsOn[${i}]`),
        );
      return out;
    },
  }));
