import { expect, test } from "bun:test";
import type { Document, Element } from "@diagra/ir";
import { availableMermaidKinds, exportMermaid } from "./export.ts";

function element(
  id: string,
  index: string,
  type: string,
  semantic: unknown,
  page = "page",
): Element {
  return { id, index, type, semantic, page, visual: {} };
}

function document(elements: readonly Element[]): Document {
  return {
    schemaVersion: 1,
    id: "doc",
    title: "Interchange",
    pages: [
      { id: "page", name: "Mixed", kind: "architecture" },
      { id: "other", name: "Other", kind: "erd" },
    ],
    elements,
  };
}

test("exports deterministic ER entities, attributes, keys and cardinality", () => {
  const users = element("users/main", "a1", "erd.table", {
    tableName: 'User "account"',
    columns: [
      { id: "user-id", name: "id", dataType: "uuid", pk: true },
      {
        id: "email",
        name: "email address",
        dataType: "varchar(255)",
        generatedExpression: "lower(raw_email)",
      },
    ],
    indexes: [
      { id: "email-key", columns: ["email"], unique: true },
      {
        id: "composite",
        name: "tenant email",
        columns: ["user-id", "email"],
        unique: true,
      },
    ],
    checks: [{ id: "email-check", expression: "length(email) > 0" }],
  });
  const orders = element("orders", "a2", "erd.table", {
    tableName: "orders",
    columns: [{ id: "order-id", name: "id", dataType: "bigint", pk: true }],
  });
  const relation = element("owns", "a3", "erd.relation", {
    from: { table: users.id, column: "user-id" },
    to: { table: orders.id, column: "order-id" },
    cardinality: "1:*",
    label: "places; tracks",
    onDelete: "cascade",
    onUpdate: "restrict",
    deferrability: "initially-deferred",
  });
  const input = document([relation, orders, users]);
  const before = structuredClone(input);
  const report = exportMermaid(input, "page", "erDiagram");

  expect(report.code).toBe(`erDiagram
  direction LR
  E_users_main["User #34;account#34;"] {
    uuid id PK
    varchar(255) email_address UK
  }
  E_orders["orders"] {
    bigint id PK
  }
  E_users_main ||--o{ E_orders : places#59; tracks
`);
  expect(report).toMatchObject({
    elementCount: 2,
    relationCount: 1,
    warnings: [
      { elementId: "users/main" },
      { elementId: "users/main" },
      { elementId: "users/main" },
      { elementId: "owns" },
      { elementId: "owns" },
    ],
  });
  expect(report.warnings.map((warning) => warning.message)).toEqual([
    'Composite unique index "tenant email" is not expressible as an ER attribute key.',
    "Check constraints are not expressible as Mermaid ER attributes and were omitted.",
    "Generated column expressions are not expressible as Mermaid ER attributes and were omitted.",
    "Referential actions are not expressible in Mermaid ER diagrams and were omitted.",
    "Foreign-key constraint timing is not expressible in Mermaid ER diagrams and was omitted.",
  ]);
  expect(input).toEqual(before);
  expect(
    exportMermaid(document([users, relation, orders]), "page", "erDiagram")
      .code,
  ).toBe(report.code);
});

test("warns when Mermaid omits composite foreign-key column pairs", () => {
  const parent = element("parent", "a1", "erd.table", {
    tableName: "accounts",
    columns: [
      { id: "tenant", name: "tenant_id", dataType: "uuid", pk: true },
      { id: "id", name: "id", dataType: "uuid", pk: true },
    ],
  });
  const child = element("child", "a2", "erd.table", {
    tableName: "invoices",
    columns: [
      { id: "tenant", name: "tenant_id", dataType: "uuid" },
      { id: "account", name: "account_id", dataType: "uuid" },
    ],
  });
  const relation = element("owner", "a3", "erd.relation", {
    from: { table: child.id, columns: ["tenant", "account"] },
    to: { table: parent.id, columns: ["tenant", "id"] },
    cardinality: "*:1",
  });
  expect(
    exportMermaid(document([parent, child, relation]), "page", "erDiagram")
      .warnings,
  ).toEqual([
    {
      elementId: "owner",
      message:
        "Composite foreign-key column pairs are not expressible in Mermaid ER diagrams and were omitted.",
    },
  ]);
});

test("exports UML members, classifiers, multiplicities and associations", () => {
  const child = element("child", "a1", "uml.class", {
    name: "Purchase Item",
    stereotype: "entity",
    attributes: [
      { id: "sku", name: "sku", type: "String", visibility: "-", static: true },
    ],
    methods: [
      {
        id: "total",
        name: "total",
        parameters: [{ name: "tax rate", type: "Decimal" }],
        returnType: "Money",
        visibility: "+",
        abstract: true,
      },
    ],
  });
  const parent = element("parent", "a2", "uml.class", {
    name: "Line",
    attributes: [],
    methods: [],
  });
  const association = element("inherit", "a3", "uml.association", {
    from: child.id,
    to: parent.id,
    kind: "inherit",
    cardinalities: { from: "0..*", to: "1" },
    label: "extends",
  });
  const report = exportMermaid(
    document([association, parent, child]),
    "page",
    "classDiagram",
  );

  expect(report.code).toBe(`classDiagram
  direction LR
  class C_child["Purchase Item"] {
    <<entity>>
    -String sku$
    +total(Decimal tax_rate) Money*
  }
  class C_parent["Line"] {
  }
  C_child "0..*" --|> "1" C_parent : extends
`);
  expect(report).toMatchObject({
    elementCount: 2,
    relationCount: 1,
    warnings: [],
  });
});

test("exports ordered sequence actors, messages and activation events", () => {
  const api = element("api", "a1", "sequence.participant", {
    name: "API",
    kind: "service",
    order: "a2",
  });
  const user = element("user", "a2", "sequence.participant", {
    name: "end",
    kind: "actor",
    order: "a1",
  });
  const request = element("request", "a3", "sequence.message", {
    from: user.id,
    to: api.id,
    order: "b1",
    label: "Create#order",
    kind: "async",
  });
  const response = element("response", "a4", "sequence.message", {
    from: api.id,
    to: user.id,
    order: "b2",
    label: "Created",
    kind: "return",
  });
  const activation = element("work", "a5", "sequence.activation", {
    participant: api.id,
    fromOrder: "b1",
    toOrder: "b2",
  });
  const dangling = element("dangling", "a6", "sequence.message", {
    from: api.id,
    to: "outside",
    order: "b3",
    kind: "sync",
  });
  const report = exportMermaid(
    document([response, activation, api, dangling, request, user]),
    "page",
    "sequenceDiagram",
  );

  expect(report.code).toBe(`sequenceDiagram
  actor P_user as #101;nd
  participant P_api as API
  activate P_api
  P_user-)P_api: Create#35;order
  P_api-->>P_user: Created
  deactivate P_api
`);
  expect(report).toMatchObject({
    elementCount: 2,
    relationCount: 2,
    warnings: [{ elementId: "dangling" }],
  });
});

test("discovers only Mermaid dialects represented on the page", () => {
  const input = document([
    element("table", "a1", "erd.table", { tableName: "t", columns: [] }),
    element("class", "a2", "uml.class", {
      name: "C",
      attributes: [],
      methods: [],
    }),
    element(
      "other-sequence",
      "a3",
      "sequence.participant",
      { name: "Other", kind: "actor", order: "a1" },
      "other",
    ),
  ]);
  expect(availableMermaidKinds(input, "page")).toEqual([
    "erDiagram",
    "classDiagram",
  ]);
  expect(availableMermaidKinds(input, "other")).toEqual(["sequenceDiagram"]);
});
