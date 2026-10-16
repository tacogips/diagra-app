import {
  DATABASE_OBJECT_LABELS,
  type DatabaseObjectSemantic,
  type DatabaseObjectType,
  type Element,
  isDatabaseObjectType,
} from "@nodetto/ir";
import type { DatabaseDialect } from "./database-ddl.ts";
import { shapeAuthoringWarnings } from "./shape-warnings.ts";

export function databaseObjectsDdl(
  elements: readonly Element[],
  dialect: DatabaseDialect,
  quote: (name: string) => string,
  type: (value: string, name: string) => string,
): {
  readonly statements: readonly string[];
  readonly warnings: readonly string[];
  readonly count: number;
} {
  const compare = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;
  const warnings: string[] = [];
  const statements: string[] = [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const objects = elements
    .filter((element) => isDatabaseObjectType(element.type))
    .sort((a, b) => {
      const routine = (element: Element) =>
        element.type === "erd.function" || element.type === "erd.procedure"
          ? 0
          : 1;
      return (
        routine(a) - routine(b) ||
        compare(
          (a.semantic as DatabaseObjectSemantic).name,
          (b.semantic as DatabaseObjectSemantic).name,
        ) ||
        compare(a.id, b.id)
      );
    });
  const done = new Set<string>();
  const failed = new Set<string>();
  let pending = [...objects];
  while (pending.length) {
    const ready = pending.filter(
      (element) =>
        (element.semantic as DatabaseObjectSemantic).dependsOn?.every(
          (id) =>
            !objects.some((candidate) => candidate.id === id) ||
            done.has(id) ||
            failed.has(id),
        ) ?? true,
    );
    if (!ready.length) {
      for (const element of pending)
        warnings.push(
          `${(element.semantic as DatabaseObjectSemantic).name}: dependency cycle; definition omitted.`,
        );
      break;
    }
    for (const element of ready) {
      const semantic = element.semantic as DatabaseObjectSemantic;
      const label = DATABASE_OBJECT_LABELS[element.type as DatabaseObjectType];
      const routine =
        element.type === "erd.function" || element.type === "erd.procedure";
      const unsupported =
        (dialect === "sqlite" && routine) ||
        (element.type === "erd.materialized-view" && dialect !== "postgresql");
      const problems = [
        ...shapeAuthoringWarnings(element, { resolve: (id) => byId.get(id) }),
      ];
      if (unsupported)
        problems.push(`${label} is not supported by ${dialect}.`);
      if (routine && dialect === "mysql" && semantic.language === "plpgsql")
        problems.push("PL/pgSQL is not supported by MySQL.");
      if (semantic.dependsOn?.some((id) => failed.has(id)))
        problems.push("A required database object was omitted.");
      if (problems.length) {
        warnings.push(
          ...problems.map(
            (message) => `${semantic.name}: ${message} Definition omitted.`,
          ),
        );
        failed.add(element.id);
        continue;
      }
      const name = quote(semantic.name);
      if (!routine) {
        const columns = semantic.columns?.length
          ? ` (${semantic.columns.map((column) => quote(column.name)).join(", ")})`
          : "";
        statements.push(
          `CREATE ${element.type === "erd.materialized-view" ? "MATERIALIZED " : ""}VIEW ${name}${columns} AS\n${semantic.definition.trim().replace(/;+\s*$/, "")};`,
        );
      } else {
        const parameters = (semantic.parameters ?? [])
          .map(
            (parameter) =>
              `${element.type === "erd.procedure" ? `${(parameter.mode ?? "in").toUpperCase()} ` : ""}${quote(parameter.name)} ${type(parameter.dataType, `${semantic.name}.${parameter.name}`)}`,
          )
          .join(", ");
        const returns =
          element.type === "erd.function"
            ? ` RETURNS ${type(semantic.returnType ?? "", `${semantic.name} return type`)}`
            : "";
        const keyword =
          element.type === "erd.function" ? "FUNCTION" : "PROCEDURE";
        const body = semantic.definition.trim();
        if (dialect === "postgresql") {
          let tag = "$nodetto$";
          let counter = 1;
          while (body.includes(tag)) tag = `$nodetto_${counter++}$`;
          statements.push(
            `CREATE ${keyword} ${name}(${parameters})${returns}\nLANGUAGE ${semantic.language ?? "sql"} AS ${tag}\n${body}\n${tag};`,
          );
        } else {
          let delimiter = "$$";
          while (body.includes(delimiter)) delimiter += "$";
          statements.push(
            `DELIMITER ${delimiter}\nCREATE ${keyword} ${name}(${parameters})${returns}\n${body.replace(/;+\s*$/, "")}${delimiter}\nDELIMITER ;`,
          );
        }
      }
      done.add(element.id);
    }
    const ids = new Set(ready.map((element) => element.id));
    pending = pending.filter((element) => !ids.has(element.id));
  }
  return { statements, warnings, count: done.size };
}
