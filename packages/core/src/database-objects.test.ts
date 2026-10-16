import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  DATABASE_OBJECT_LABELS,
  getElementTypeDefinition,
  hasErrors,
} from "@nodetto/ir";
import { generateDatabaseDdl } from "./database-ddl.ts";
import { Editor } from "./editor.ts";
import { shapeAuthoringWarnings } from "./shape-warnings.ts";
import { renderPageSvg } from "./svg-export.ts";

test("all database objects have editable drafts, bounds, SVG rendering and table-only foreign keys", () => {
  const editor = new Editor();
  const table = editor.createElement("erd.table");
  for (const [i, type] of Object.keys(DATABASE_OBJECT_LABELS).entries()) {
    const id = editor.createElement(type, { visual: { x: 300 * i, y: 200 } });
    const object = editor.store.get(id)!;
    expect(
      shapeAuthoringWarnings(object, editor.createShapeContext(1)).length,
    ).toBeGreaterThan(0);
    expect(
      hasErrors(
        getElementTypeDefinition(type)!.validateSemantic(
          object.semantic,
          "semantic",
        ),
      ),
    ).toBe(false);
    expect(
      editor.registry.get(type)?.getBounds(object, editor.createShapeContext(1))
        ?.height,
    ).toBeGreaterThan(50);
    expect(() =>
      editor.createElement("erd.relation", {
        semantic: { from: { table }, to: { table: id }, cardinality: "1:*" },
      }),
    ).toThrow("Invalid connector endpoints");
  }
  const svg = renderPageSvg(
    editor.store,
    editor.registry,
    editor.currentPageId,
  )!;
  for (const label of Object.values(DATABASE_OBJECT_LABELS))
    expect(svg).toContain(label);
  expect(svg).not.toContain("Needs setup");
});

test("SQLite executes view exports in dependency order, even on pages without tables", () => {
  const editor = new Editor();
  const source = editor.createElement("erd.view", {
    semantic: {
      name: "z_source",
      definition: "SELECT 42 AS answer",
      columns: [{ id: "answer", name: "answer", dataType: "integer" }],
    },
  });
  editor.createElement("erd.view", {
    semantic: {
      name: "a_dependent",
      definition: "SELECT answer FROM z_source;",
      dependsOn: [source],
    },
  });
  const report = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  expect(report.warnings).toEqual([]);
  expect(report.objectCount).toBe(2);
  expect(report.sql.indexOf('CREATE VIEW "z_source"')).toBeLessThan(
    report.sql.indexOf('CREATE VIEW "a_dependent"'),
  );
  const db = new Database(":memory:");
  try {
    db.exec(report.sql);
    expect(db.query("SELECT answer FROM a_dependent").get()).toEqual({
      answer: 42,
    });
  } finally {
    db.close();
  }
});

test("PostgreSQL emits all four objects and escapes routine body delimiters", () => {
  const editor = new Editor();
  editor.createElement("erd.view", {
    semantic: { name: "v", definition: "SELECT 1" },
  });
  editor.createElement("erd.materialized-view", {
    semantic: { name: "m", definition: "SELECT 1;" },
  });
  editor.createElement("erd.function", {
    semantic: {
      name: "f",
      definition: "SELECT '$nodetto$';",
      returnType: "integer",
      parameters: [{ id: "x", name: "x", dataType: "integer" }],
    },
  });
  editor.createElement("erd.procedure", {
    semantic: {
      name: "p",
      definition: "BEGIN x := 1; END;",
      language: "plpgsql",
      parameters: [{ id: "x", name: "x", dataType: "integer", mode: "inout" }],
    },
  });
  const report = generateDatabaseDdl(
    editor,
    editor.currentPageId,
    "postgresql",
  );
  expect(report.warnings).toEqual([]);
  expect(report.objectCount).toBe(4);
  expect(report.sql).toContain('CREATE MATERIALIZED VIEW "m"');
  expect(report.sql).toContain(
    'CREATE FUNCTION "f"("x" INTEGER) RETURNS INTEGER',
  );
  expect(report.sql).toContain("AS $nodetto_1$");
  expect(report.sql).toContain('CREATE PROCEDURE "p"(INOUT "x" INTEGER)');
  expect(report.sql).toContain("LANGUAGE plpgsql");
});

test("MySQL uses client delimiters and unsupported objects propagate warnings to dependents", () => {
  const editor = new Editor();
  const materialized = editor.createElement("erd.materialized-view", {
    semantic: { name: "m", definition: "SELECT 1" },
  });
  editor.createElement("erd.view", {
    semantic: {
      name: "v",
      definition: "SELECT * FROM m",
      dependsOn: [materialized],
    },
  });
  editor.createElement("erd.function", {
    semantic: { name: "f", definition: "RETURN 1;", returnType: "integer" },
  });
  editor.createElement("erd.procedure", {
    semantic: { name: "p", definition: "BEGIN SELECT '$$'; END;" },
  });
  const mysql = generateDatabaseDdl(editor, editor.currentPageId, "mysql");
  expect(mysql.objectCount).toBe(2);
  expect(mysql.sql).toContain(
    "CREATE FUNCTION `f`() RETURNS INTEGER\nRETURN 1$$",
  );
  expect(mysql.sql).toContain("DELIMITER $$$\nCREATE PROCEDURE `p`()");
  expect(mysql.warnings.join("\n")).toContain(
    "Materialized view is not supported by mysql",
  );
  expect(mysql.warnings.join("\n")).toContain(
    "required database object was omitted",
  );
  const sqlite = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  expect(sqlite.objectCount).toBe(0);
  expect(sqlite.warnings.join("\n")).toContain(
    "Function is not supported by sqlite",
  );
});

test("missing definitions, duplicate members and dependency cycles stay visible and are omitted from SQL", () => {
  const editor = new Editor();
  const draft = editor.createElement("erd.function");
  const a = editor.createElement("erd.view", {
    semantic: {
      name: "a",
      definition: "SELECT 1",
      columns: [
        { id: "one", name: "x", dataType: "integer" },
        { id: "two", name: "x", dataType: "integer" },
      ],
    },
  });
  const b = editor.createElement("erd.view", {
    semantic: { name: "b", definition: "SELECT 1", dependsOn: [a] },
  });
  editor.apply([
    {
      type: "updateSemantic",
      id: a,
      semantic: {
        ...(editor.store.get(a)!.semantic as object),
        dependsOn: [b],
      },
    },
  ]);
  expect(
    shapeAuthoringWarnings(
      editor.store.get(a)!,
      editor.createShapeContext(1),
    ).join("\n"),
  ).toContain("cycle");
  expect(
    shapeAuthoringWarnings(
      editor.store.get(draft)!,
      editor.createShapeContext(1),
    ),
  ).toHaveLength(2);
  const report = generateDatabaseDdl(
    editor,
    editor.currentPageId,
    "postgresql",
  );
  expect(report.objectCount).toBe(0);
  expect(report.warnings.join("\n")).toContain("dependency cycle");
  expect(report.sql).not.toContain("CREATE VIEW");
  expect(
    hasErrors(
      getElementTypeDefinition("erd.function")!.validateSemantic(
        {
          name: "f",
          definition: "",
          parameters: [
            { id: "x", name: "a", dataType: "integer" },
            { id: "x", name: "b", dataType: "integer" },
          ],
        },
        "semantic",
      ),
    ),
  ).toBe(true);
});
