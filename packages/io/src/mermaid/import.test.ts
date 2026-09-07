import { expect, test } from "bun:test";
import { validateDocument } from "@diagra/ir";
import { exportMermaid } from "./export.ts";
import { MermaidParseError, importMermaid } from "./import.ts";

test("imports ER entities, keys, nullable columns and relationships", () => {
  const source = `erDiagram
  direction LR
  USERS["User account"] {
    uuid id PK
    varchar email UK
    text? nickname
  }
  ORDERS {
    bigint id PK
  }
  USERS ||--o{ ORDERS : places#59; tracks
`;
  const first = importMermaid(source, {
    documentId: "erd-doc",
    pageId: "schema",
    title: "Store schema",
  });
  const second = importMermaid(source, {
    documentId: "erd-doc",
    pageId: "schema",
    title: "Store schema",
  });

  expect(first).toEqual(second);
  expect(first.kind).toBe("erDiagram");
  expect(first.warnings).toEqual([]);
  expect(validateDocument(first.document)).toEqual([]);
  expect(first.document.pages).toEqual([
    { id: "schema", name: "Store schema", kind: "erd" },
  ]);
  expect(first.document.elements).toHaveLength(3);
  expect(first.document.elements[0]?.semantic).toEqual({
    tableName: "User account",
    columns: [
      { id: "column-1", name: "id", dataType: "uuid", pk: true },
      { id: "column-2", name: "email", dataType: "varchar" },
      {
        id: "column-3",
        name: "nickname",
        dataType: "text",
        nullable: true,
      },
    ],
    indexes: [{ id: "unique-1", columns: ["column-2"], unique: true }],
  });
  expect(first.document.elements[2]?.semantic).toMatchObject({
    cardinality: "1:*",
    label: "places; tracks",
  });
  expect(exportMermaid(first.document, "schema", "erDiagram").warnings).toEqual(
    [],
  );
});

test("imports class aliases, members, stereotypes and inheritance", () => {
  const report = importMermaid(`classDiagram
  class Base["Base model"] {
    <<abstract>>
    #uuid id$
    +save(String path) Result*
  }
  class Child {
    -String name
  }
  Base "1" <|-- "0..*" Child : extends
`);

  expect(report.kind).toBe("classDiagram");
  expect(report.warnings).toEqual([]);
  expect(validateDocument(report.document)).toEqual([]);
  expect(report.document.elements[0]?.semantic).toEqual({
    name: "Base model",
    stereotype: "abstract",
    attributes: [
      {
        id: "attribute-1",
        name: "id",
        type: "uuid",
        visibility: "#",
        static: true,
      },
    ],
    methods: [
      {
        id: "method-1",
        name: "save",
        parameters: [{ name: "path", type: "String" }],
        returnType: "Result",
        visibility: "+",
        abstract: true,
      },
    ],
  });
  expect(report.document.elements[2]?.semantic).toEqual({
    from: "mermaid-class-child",
    to: "mermaid-class-base",
    kind: "inherit",
    cardinalities: { from: "0..*", to: "1" },
    label: "extends",
  });
});

test("imports sequence participants, messages and activation spans", () => {
  const report = importMermaid(`sequenceDiagram
  autonumber
  actor shopper as Shopper
  participant api as API
  shopper->>api: Create order
  activate api
  api--)queue: Publish event
  queue-->>shopper: Accepted
  deactivate api
`);

  expect(report.kind).toBe("sequenceDiagram");
  expect(report.warnings).toEqual([]);
  expect(validateDocument(report.document)).toEqual([]);
  const participants = report.document.elements.filter(
    (element) => element.type === "sequence.participant",
  );
  expect(participants.map((element) => element.semantic)).toEqual([
    { name: "Shopper", kind: "actor", order: "a000001" },
    { name: "API", kind: "service", order: "a000002" },
    { name: "queue", kind: "service", order: "a000003" },
  ]);
  const messages = report.document.elements.filter(
    (element) => element.type === "sequence.message",
  );
  expect(messages.map((element) => element.semantic)).toEqual([
    {
      from: "mermaid-participant-shopper",
      to: "mermaid-participant-api",
      order: "b000001",
      kind: "sync",
      label: "Create order",
    },
    {
      from: "mermaid-participant-api",
      to: "mermaid-participant-queue",
      order: "b000003",
      kind: "async",
      label: "Publish event",
    },
    {
      from: "mermaid-participant-queue",
      to: "mermaid-participant-shopper",
      order: "b000004",
      kind: "return",
      label: "Accepted",
    },
  ]);
  expect(report.document.elements.at(-1)?.semantic).toEqual({
    participant: "mermaid-participant-api",
    fromOrder: "b000002",
    toOrder: "b000005",
  });
});

test("accepts BOM, frontmatter and comments while reporting lossy statements", () => {
  const report = importMermaid(`\uFEFF---
title: example
---
%% comment
classDiagram
  class Good
  note for Good "not represented"
`);

  expect(report.document.elements).toHaveLength(1);
  expect(report.warnings).toEqual([
    { line: 7, message: "Unsupported class statement was ignored." },
  ]);
});

test("rejects missing dialects, unterminated frontmatter and oversized input", () => {
  expect(() => importMermaid("flowchart LR\n  A --> B")).toThrow(
    MermaidParseError,
  );
  expect(() => importMermaid("---\ntitle: broken")).toThrow(
    "unterminated Mermaid frontmatter",
  );
  expect(() =>
    importMermaid(`classDiagram\n${"x".repeat(1024 * 1024)}`),
  ).toThrow("exceeds the 1 MiB limit");
});

test("warns for unmatched and open blocks without producing invalid IR", () => {
  const er = importMermaid("erDiagram\n  LOST }\n  TABLE {\n    uuid id PK");
  const sequence = importMermaid(
    "sequenceDiagram\n  participant API\n  deactivate API\n  activate API",
  );

  expect(er.warnings.map((warning) => warning.message)).toEqual([
    "Unsupported ER statement was ignored.",
    "Unclosed ER entity block was accepted.",
  ]);
  expect(sequence.warnings.map((warning) => warning.message)).toEqual([
    "Unmatched deactivate statement was ignored.",
    "Open activation for API was closed at the end.",
  ]);
  expect(validateDocument(er.document)).toEqual([]);
  expect(validateDocument(sequence.document)).toEqual([]);
});
