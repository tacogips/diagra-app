import { expect, test } from "bun:test";
import type { Document, Element } from "@diagra/ir";
import { exportD2 } from "./export.ts";

function element(
  id: string,
  index: string,
  type: string,
  semantic: unknown,
  visual: Element["visual"] = {},
  page = "page",
): Element {
  return { id, index, type, semantic, visual, page };
}

function document(elements: readonly Element[]): Document {
  return {
    schemaVersion: 1,
    id: "doc",
    title: "D2 export",
    pages: [{ id: "page", name: "Architecture", kind: "architecture" }],
    elements,
  };
}

test("exports nested architecture shapes, connections and portable styles", () => {
  const frame = element(
    "system",
    "a1",
    "frame",
    { name: "Checkout", memberIds: ["api"] },
    { x: 0, y: 0, width: 500, height: 300 },
  );
  const api = element(
    "api",
    "a2",
    "node.generic",
    { label: 'API "edge"' },
    {
      x: 40,
      y: 50,
      width: 160,
      height: 80,
      style: {
        fill: "#eff6ff",
        stroke: "#2563eb",
        strokeWidth: 2,
        cornerRadius: 12,
      },
    },
  );
  const database = element(
    "db",
    "a3",
    "shape.geo",
    { geo: "cylinder", label: "Orders" },
    { x: 600, y: 50, width: 140, height: 100 },
  );
  const edge = element("call", "a4", "edge.generic", {
    from: "api",
    to: "db",
    label: "stores",
    arrowheads: { start: "none", end: "arrow" },
  });

  const report = exportD2(document([edge, database, api, frame]), "page");

  expect(report.code).toBe(`direction: right
n_system: "Checkout" {
  n_api: "API \\"edge\\"" {
    width: 160
    height: 80
    style.fill: "#eff6ff"
    style.stroke: "#2563eb"
    style.stroke-width: 2
    style.border-radius: 12
  }
}
n_db: "Orders" {
  shape: cylinder
  width: 140
  height: 100
}
n_system.n_api -> n_db: "stores" {
  target-arrowhead.shape: arrow
}
`);
  expect(report).toMatchObject({
    elementCount: 3,
    relationCount: 1,
    warnings: [],
  });
});

test("exports ER tables with row targets, constraints and crow-foot ends", () => {
  const users = element("users", "a1", "erd.table", {
    tableName: "users",
    columns: [
      { id: "id", name: "id", dataType: "uuid", pk: true },
      {
        id: "email",
        name: "email",
        dataType: "varchar",
        generatedExpression: "lower(raw_email)",
      },
    ],
    indexes: [{ id: "email-uq", columns: ["email"], unique: true }],
    checks: [{ id: "email-check", expression: "length(email) > 0" }],
  });
  const orders = element("orders", "a2", "erd.table", {
    tableName: "orders",
    columns: [{ id: "owner", name: "owner id", dataType: "uuid" }],
  });
  const relation = element("owns", "a3", "erd.relation", {
    from: { table: "users", column: "id" },
    to: { table: "orders", column: "owner" },
    cardinality: "1:*",
    label: "owns",
    onDelete: "cascade",
    onUpdate: "restrict",
    deferrability: "initially-deferred",
  });

  const report = exportD2(document([users, orders, relation]), "page");

  expect(report.code).toBe(`direction: right
n_users: "users" {
  shape: sql_table
  c_id: "uuid" { constraint: primary_key }
  c_email: "varchar" { constraint: unique }
}
n_orders: "orders" {
  shape: sql_table
  c_owner_id: "uuid"
}
n_users.c_id -> n_orders.c_owner_id: "owns" {
  source-arrowhead.shape: cf-one-required
  target-arrowhead.shape: cf-many-required
}
`);
  expect(report.warnings).toEqual([
    {
      elementId: "users",
      message:
        "Check constraints are not expressible on D2 SQL-table rows and were omitted.",
    },
    {
      elementId: "users",
      message:
        "Generated column expressions are not expressible on D2 SQL-table rows and were omitted.",
    },
    {
      elementId: "owns",
      message:
        "Referential actions are not expressible on D2 SQL-table connections and were omitted.",
    },
    {
      elementId: "owns",
      message:
        "Foreign-key constraint timing is not expressible on D2 SQL-table connections and was omitted.",
    },
  ]);
});

test("D2 targets the first composite pair and reports the remaining loss", () => {
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
  const report = exportD2(document([parent, child, relation]), "page");
  expect(report.code).toContain("n_child.c_tenant_id -> n_parent.c_tenant_id");
  expect(report.warnings).toEqual([
    {
      elementId: "owner",
      message:
        "Composite foreign-key endpoints are not expressible on one D2 connection; only the first column pair was targeted.",
    },
  ]);
});

test("exports UML classes and relationship arrowhead semantics", () => {
  const child = element("child", "a1", "uml.class", {
    name: "Line item",
    attributes: [{ id: "sku", name: "sku", type: "String", visibility: "-" }],
    methods: [
      {
        id: "total",
        name: "total",
        parameters: [{ name: "tax", type: "Decimal" }],
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
  const relation = element("extends", "a3", "uml.association", {
    from: "child",
    to: "parent",
    kind: "inherit",
    label: "extends",
  });

  expect(exportD2(document([relation, parent, child]), "page").code).toBe(
    `direction: right
n_child: "Line item" {
  shape: class
  "-sku": "String"
  "+total(tax Decimal)*": "Money"
}
n_parent: "Line" {
  shape: class
}
n_child -> n_parent: "extends" {
  target-arrowhead.shape: triangle
  target-arrowhead.style.filled: false
}
`,
  );
});

test("exports ordered sequence participants, activation spans and return styling", () => {
  const user = element("user", "a1", "sequence.participant", {
    name: "Shopper",
    kind: "actor",
    order: "a1",
  });
  const api = element("api", "a2", "sequence.participant", {
    name: "API",
    kind: "service",
    order: "a2",
  });
  const request = element("request", "a3", "sequence.message", {
    from: "user",
    to: "api",
    order: "b1",
    kind: "sync",
    label: "Create",
  });
  const response = element("response", "a4", "sequence.message", {
    from: "api",
    to: "user",
    order: "b2",
    kind: "return",
    label: "Created",
  });
  const activation = element("active", "a5", "sequence.activation", {
    participant: "api",
    fromOrder: "b1",
    toOrder: "b2",
  });

  const report = exportD2(
    document([response, api, activation, user, request]),
    "page",
  );

  expect(report.code).toBe(`direction: right
d2_sequence: "Architecture" {
  shape: sequence_diagram
  n_user: "Shopper" { shape: person }
  n_api: "API"
  n_user -> n_api.span_1: "Create"
  n_api.span_1 -> n_user: "Created" {
    style.stroke-dash: 5
  }
}
`);
  expect(report).toMatchObject({
    elementCount: 2,
    relationCount: 2,
    warnings: [],
  });
});

test("is deterministic, non-mutating and warns instead of emitting dangling data", () => {
  const node = element("Node/A", "a1", "node.generic", { label: "A\nB" });
  const hidden = element(
    "hidden",
    "a2",
    "node.generic",
    { label: "Secret" },
    { hidden: true },
  );
  const path = element("ink", "a3", "draw.freehand", {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  });
  const edge = element("bad", "a4", "edge.generic", {
    from: "Node/A",
    to: "outside",
  });
  const input = document([edge, hidden, path, node]);
  const before = structuredClone(input);
  const first = exportD2(input, "page");
  const second = exportD2(document([path, node, edge, hidden]), "page");

  expect(first).toEqual(second);
  expect(input).toEqual(before);
  expect(first.code).toContain('n_node_a: "A\\nB"');
  expect(first.code).not.toContain("Secret");
  expect(first.code).not.toContain("outside");
  expect(first.warnings.map((warning) => warning.elementId)).toEqual([
    "ink",
    "bad",
  ]);
});

test("rejects an unknown page", () => {
  expect(() => exportD2(document([]), "missing")).toThrow(
    "page not found: missing",
  );
});
