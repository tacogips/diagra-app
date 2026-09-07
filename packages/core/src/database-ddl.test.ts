import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Cardinality, ErdRelationSemantic } from "@diagra/ir";
import { generateDatabaseDdl } from "./database-ddl.ts";
import { makeEditor } from "./test-helpers.ts";

function databaseFixture(
  cardinality: Cardinality = "*:1",
  actions: Partial<
    Pick<ErdRelationSemantic, "onDelete" | "onUpdate" | "deferrability">
  > = {},
) {
  const editor = makeEditor();
  const users = editor.buildElement("erd.table", {
    id: "users",
    semantic: {
      tableName: "users",
      columns: [
        { id: "user-id", name: "id", dataType: "uuid", pk: true },
        {
          id: "email",
          name: "email",
          dataType: "text",
          nullable: true,
          defaultExpression: "'unknown'",
        },
      ],
      indexes: [
        {
          id: "users-email",
          name: "users_email_uq",
          columns: ["email"],
          unique: true,
        },
      ],
      checks: [
        {
          id: "email-check",
          name: "email_nonempty",
          expression: "length(email) > 0",
        },
      ],
    },
  });
  const orders = editor.buildElement("erd.table", {
    id: "orders",
    semantic: {
      tableName: "orders",
      columns: [
        { id: "order-id", name: "id", dataType: "bigint", pk: true },
        { id: "owner", name: "user_id", dataType: "uuid" },
      ],
      indexes: [{ id: "orders-owner-index", columns: ["owner", "order-id"] }],
    },
  });
  const relation = editor.buildElement("erd.relation", {
    id: "orders-owner",
    semantic: {
      from:
        cardinality === "1:1"
          ? { table: users.id, column: "user-id" }
          : { table: orders.id, column: "owner" },
      to:
        cardinality === "1:1"
          ? { table: orders.id, column: "owner" }
          : { table: users.id, column: "user-id" },
      cardinality,
      label: "owned by",
      ...actions,
    },
  });
  editor.apply([{ type: "createElement", element: users }]);
  editor.apply(
    [orders, relation].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  return { editor, users, orders, relation };
}

test("SQLite executes cascading updates and deletes authored on a relation", () => {
  const { editor } = databaseFixture("*:1", {
    onDelete: "cascade",
    onUpdate: "cascade",
  });
  const result = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  expect(result.warnings).toEqual([]);
  expect(result.sql).toContain("ON DELETE CASCADE ON UPDATE CASCADE");

  const database = new Database(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(result.sql);
    database.exec(
      "INSERT INTO users (id, email) VALUES ('first', 'first@example.test')",
    );
    database.exec("INSERT INTO orders (id, user_id) VALUES (1, 'first')");
    database.exec("UPDATE users SET id = 'renamed' WHERE id = 'first'");
    expect(
      database.query("SELECT user_id FROM orders WHERE id = 1").get(),
    ).toEqual({ user_id: "renamed" });
    database.exec("DELETE FROM users WHERE id = 'renamed'");
    expect(
      database.query("SELECT COUNT(*) AS count FROM orders").get(),
    ).toEqual({ count: 0 });
  } finally {
    database.close();
  }
});

test("SET DEFAULT is preserved where supported and omitted for MySQL", () => {
  const { editor } = databaseFixture("*:1", { onDelete: "set-default" });
  const postgres = generateDatabaseDdl(
    editor,
    editor.currentPageId,
    "postgresql",
  );
  expect(postgres.sql).toContain("ON DELETE SET DEFAULT");
  expect(postgres.warnings).toContain(
    "orders-owner: SET DEFAULT targets orders.user_id, which has no authored default expression.",
  );

  const mysql = generateDatabaseDdl(editor, editor.currentPageId, "mysql");
  const mysqlForeignKey = mysql.sql
    .split("\n")
    .find((line) => line.startsWith("ALTER TABLE"));
  expect(mysqlForeignKey).toBeDefined();
  expect(mysqlForeignKey).not.toContain("ON DELETE SET DEFAULT");
  expect(mysql.warnings).toContain(
    "orders-owner: MySQL does not support ON DELETE SET DEFAULT; the action was omitted.",
  );
});

test("deferred foreign keys allow transaction-order-independent SQLite imports", () => {
  const { editor } = databaseFixture("*:1", {
    deferrability: "initially-deferred",
  });
  const sqlite = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  expect(sqlite.warnings).toEqual([]);
  expect(sqlite.sql).toContain("DEFERRABLE INITIALLY DEFERRED");

  const database = new Database(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(sqlite.sql);
    database.exec("BEGIN");
    database.exec("INSERT INTO orders (id, user_id) VALUES (1, 'later')");
    database.exec(
      "INSERT INTO users (id, email) VALUES ('later', 'later@example.test')",
    );
    database.exec("COMMIT");
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    database.close();
  }

  const postgres = generateDatabaseDdl(
    editor,
    editor.currentPageId,
    "postgresql",
  );
  expect(postgres.sql).toContain("DEFERRABLE INITIALLY DEFERRED");
  const mysql = generateDatabaseDdl(editor, editor.currentPageId, "mysql");
  expect(mysql.sql).not.toContain("DEFERRABLE INITIALLY DEFERRED");
  expect(mysql.warnings).toContain(
    "orders-owner: MySQL does not support deferrable foreign keys; the constraint timing was omitted.",
  );
});

test("composite foreign keys execute with ordered columns and cascade", () => {
  const editor = makeEditor();
  const accounts = editor.buildElement("erd.table", {
    id: "accounts",
    semantic: {
      tableName: "accounts",
      columns: [
        { id: "account-tenant", name: "tenant_id", dataType: "uuid", pk: true },
        { id: "account-id", name: "id", dataType: "uuid", pk: true },
      ],
    },
  });
  const invoices = editor.buildElement("erd.table", {
    id: "invoices",
    semantic: {
      tableName: "invoices",
      columns: [
        { id: "invoice-id", name: "id", dataType: "uuid", pk: true },
        { id: "invoice-tenant", name: "tenant_id", dataType: "uuid" },
        { id: "invoice-account", name: "account_id", dataType: "uuid" },
      ],
    },
  });
  const owner = editor.buildElement("erd.relation", {
    id: "invoice-account",
    semantic: {
      from: {
        table: invoices.id,
        columns: ["invoice-tenant", "invoice-account"],
      },
      to: {
        table: accounts.id,
        columns: ["account-tenant", "account-id"],
      },
      cardinality: "*:1",
      onDelete: "cascade",
      onUpdate: "cascade",
    },
  });
  editor.apply(
    [accounts, invoices, owner].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );

  for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
    const ddl = generateDatabaseDdl(editor, editor.currentPageId, dialect);
    const quote = dialect === "mysql" ? "`" : '"';
    expect(ddl.warnings).toEqual([]);
    expect(ddl.sql).toContain(
      `FOREIGN KEY (${quote}tenant_id${quote}, ${quote}account_id${quote})`,
    );
    expect(ddl.sql).toContain(
      `REFERENCES ${quote}accounts${quote} (${quote}tenant_id${quote}, ${quote}id${quote})`,
    );
  }

  const sqlite = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  const database = new Database(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(sqlite.sql);
    database.exec("INSERT INTO accounts VALUES ('tenant-a', 'account-a')");
    database.exec(
      "INSERT INTO invoices VALUES ('invoice-a', 'tenant-a', 'account-a')",
    );
    expect(() =>
      database.exec(
        "INSERT INTO invoices VALUES ('invoice-b', 'tenant-b', 'account-a')",
      ),
    ).toThrow();
    database.exec(
      "UPDATE accounts SET id = 'account-b' WHERE tenant_id = 'tenant-a' AND id = 'account-a'",
    );
    expect(database.query("SELECT account_id FROM invoices").get()).toEqual({
      account_id: "account-b",
    });
    database.exec("DELETE FROM accounts");
    expect(
      database.query("SELECT COUNT(*) AS count FROM invoices").get(),
    ).toEqual({ count: 0 });
  } finally {
    database.close();
  }
});

test("SQLite handoff executes and enforces keys, defaults, checks and indexes", () => {
  const { editor } = databaseFixture();
  const before = editor.getSnapshot();
  const result = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  const database = new Database(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(result.sql);
    database
      .query("INSERT INTO users (id, email) VALUES (?, ?)")
      .run("first", "first@example.test");
    database.query("INSERT INTO users (id) VALUES (?)").run("second");
    expect(
      database.query("SELECT email FROM users WHERE id = ?").get("second"),
    ).toEqual({ email: "unknown" });
    database
      .query("INSERT INTO orders (id, user_id) VALUES (?, ?)")
      .run(1, "first");
    expect(() =>
      database
        .query("INSERT INTO users (id, email) VALUES (?, ?)")
        .run("first", "different@example.test"),
    ).toThrow();
    expect(() =>
      database
        .query("INSERT INTO orders (id, user_id) VALUES (?, ?)")
        .run(2, "missing"),
    ).toThrow();
    expect(() =>
      database
        .query("INSERT INTO users (id, email) VALUES (?, ?)")
        .run("third", "first@example.test"),
    ).toThrow();
    expect(() =>
      database
        .query("INSERT INTO users (id, email) VALUES (?, ?)")
        .run("third", ""),
    ).toThrow();
    expect(() =>
      database
        .query("INSERT INTO users (id, email) VALUES (?, ?)")
        .run(null, "third@example.test"),
    ).toThrow();
    expect(() =>
      database.query("DELETE FROM users WHERE id = ?").run("first"),
    ).toThrow();
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database.query("SELECT COUNT(*) AS count FROM orders").get(),
    ).toEqual({ count: 1 });
    expect(editor.getSnapshot()).toEqual(before);
  } finally {
    database.close();
  }
});

test("PostgreSQL DDL preserves table order, keys, nullability and relations", () => {
  const { editor } = databaseFixture();
  const before = editor.getSnapshot();
  const result = generateDatabaseDdl(
    editor,
    editor.currentPageId,
    "postgresql",
  );
  expect(result).toMatchObject({
    dialect: "postgresql",
    tableCount: 2,
    relationCount: 1,
    indexCount: 2,
    checkCount: 1,
    warnings: [],
  });
  expect(result.sql).toContain('"id" UUID NOT NULL');
  expect(result.sql).toContain('"email" TEXT');
  expect(result.sql).not.toContain('"email" TEXT NOT NULL');
  expect(result.sql).toContain(`"email" TEXT DEFAULT 'unknown'`);
  expect(result.sql).toContain(
    'CREATE UNIQUE INDEX "users_email_uq" ON "users" ("email")',
  );
  expect(result.sql).toContain(
    'CREATE INDEX "idx_orders_user_id_id" ON "orders" ("user_id", "id")',
  );
  expect(result.sql).toContain('CONSTRAINT "pk_users" PRIMARY KEY ("id")');
  expect(result.sql).toContain(
    'CONSTRAINT "email_nonempty" CHECK (length(email) > 0)',
  );
  expect(result.sql).toContain(
    'FOREIGN KEY ("user_id") REFERENCES "users" ("id")',
  );
  expect(result.sql).toContain(
    'ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_user_id_users"',
  );
  expect(result.sql.indexOf('CREATE TABLE "users"')).toBeLessThan(
    result.sql.indexOf('CREATE TABLE "orders"'),
  );
  expect(result.sql.indexOf('CREATE TABLE "orders"')).toBeLessThan(
    result.sql.indexOf('ALTER TABLE "orders"'),
  );
  const sqlite = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  expect(sqlite.sql).toContain(
    'CONSTRAINT "fk_orders_user_id_users" FOREIGN KEY ("user_id")',
  );
  expect(sqlite.sql).not.toContain("ALTER TABLE");
  expect(editor.getSnapshot()).toEqual(before);
});

test("MySQL and SQLite map portable types and quote hostile identifiers", () => {
  const editor = makeEditor();
  const table = editor.buildElement("erd.table", {
    semantic: {
      tableName: 'odd`"table',
      columns: [
        { id: "id", name: "select", dataType: "uuid", pk: true },
        { id: "payload", name: "pay`load", dataType: "json" },
        {
          id: "unsafe",
          name: "unsafe",
          dataType: "text); DROP TABLE x;--",
          defaultExpression: "0; DROP TABLE x;--",
        },
      ],
    },
  });
  editor.apply([{ type: "createElement", element: table }]);

  const mysql = generateDatabaseDdl(editor, editor.currentPageId, "mysql");
  expect(mysql.sql).toContain('CREATE TABLE `odd``"table`');
  expect(mysql.sql).toContain("`select` CHAR(36) NOT NULL");
  expect(mysql.sql).toContain("`pay``load` JSON NOT NULL");
  expect(mysql.sql).toContain("`unsafe` TEXT NOT NULL");
  expect(mysql.sql).toContain("ENGINE=InnoDB;");
  expect(mysql.sql).not.toContain("DEFAULT 0;");
  expect(mysql.warnings).toHaveLength(2);

  const sqlite = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  expect(sqlite.sql).toContain("PRAGMA foreign_keys = ON;");
  expect(sqlite.sql).toContain('"select" TEXT NOT NULL');
  expect(sqlite.sql).toContain('"pay`load" TEXT NOT NULL');
  expect(sqlite.warnings).toHaveLength(2);
});

test("unsafe or malformed check expressions are omitted with warnings", () => {
  const editor = makeEditor();
  const table = editor.buildElement("erd.table", {
    semantic: {
      tableName: "accounts",
      columns: [{ id: "balance", name: "balance", dataType: "decimal" }],
      checks: [
        { id: "valid", expression: "balance >= 0" },
        {
          id: "states",
          name: "Valid state",
          expression: "state IN ('open', 'closed')",
        },
        { id: "inject", expression: "balance >= 0; DROP TABLE accounts" },
        {
          id: "subquery",
          expression: "balance > (SELECT min(balance) FROM accounts)",
        },
        { id: "quote", expression: "state = 'open" },
        { id: "comment", expression: "balance >= 0 -- bypass" },
        { id: "newline", expression: "balance >= 0\nAND balance < 100" },
      ],
    },
  });
  editor.apply([{ type: "createElement", element: table }]);

  const result = generateDatabaseDdl(editor, editor.currentPageId, "sqlite");
  expect(result.checkCount).toBe(7);
  expect(result.sql).toContain(
    'CONSTRAINT "ck_accounts_valid" CHECK (balance >= 0)',
  );
  expect(result.sql).toContain(
    `CONSTRAINT "Valid state" CHECK (state IN ('open', 'closed'))`,
  );
  expect(result.sql).not.toContain("DROP TABLE accounts");
  expect(result.sql).not.toContain("SELECT min");
  expect(result.warnings).toHaveLength(5);
});

test("one-to-one constraints and incomplete relations produce actionable SQL warnings", () => {
  const { editor, relation } = databaseFixture("1:1");
  const many = editor.buildElement("erd.relation", {
    id: "many-to-many",
    semantic: {
      from: { table: "users", column: "email" },
      to: { table: "orders", column: "owner" },
      cardinality: "*:*",
    },
  });
  editor.apply([{ type: "createElement", element: many }]);
  const result = generateDatabaseDdl(
    editor,
    editor.currentPageId,
    "postgresql",
  );
  expect(result.sql).toContain(
    'CONSTRAINT "uq_orders_user_id" UNIQUE ("user_id")',
  );
  expect(result.sql).toContain(
    `-- Warning: ${many.id}: many-to-many relation requires an explicit junction table.`,
  );
  expect(result.relationCount).toBe(2);
  expect(result.sql).toContain(`CONSTRAINT "fk_orders_user_id_users"`);
  expect(relation.id).toBe("orders-owner");
});

test("database defaults and generated composite index names stay dialect-safe", () => {
  const editor = makeEditor();
  const table = editor.buildElement("erd.table", {
    semantic: {
      tableName: "events",
      columns: [
        {
          id: "id",
          name: "id",
          dataType: "uuid",
          pk: true,
          defaultExpression: "gen_random_uuid()",
        },
        {
          id: "status",
          name: "status",
          dataType: "text",
          defaultExpression: "'new'",
        },
        {
          id: "created",
          name: "created_at",
          dataType: "timestamp",
          defaultExpression: "now()",
        },
      ],
      indexes: [
        { id: "status-index", columns: ["status"], unique: true },
        { id: "timeline-index", columns: ["status", "created"] },
      ],
    },
  });
  editor.apply([{ type: "createElement", element: table }]);

  const postgres = generateDatabaseDdl(
    editor,
    editor.currentPageId,
    "postgresql",
  );
  expect(postgres.warnings).toEqual([]);
  expect(postgres.sql).toContain("DEFAULT gen_random_uuid()");
  expect(postgres.sql).toContain(`"status" TEXT NOT NULL DEFAULT 'new'`);
  expect(postgres.sql).toContain(
    '"created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
  );
  expect(postgres.sql).toContain(
    'CREATE UNIQUE INDEX "uq_events_status" ON "events" ("status")',
  );
  expect(postgres.sql).toContain(
    'CREATE INDEX "idx_events_status_created_at" ON "events" ("status", "created_at")',
  );

  const mysql = generateDatabaseDdl(editor, editor.currentPageId, "mysql");
  expect(mysql.sql).not.toContain("DEFAULT gen_random_uuid()");
  expect(mysql.sql).toContain("DEFAULT CURRENT_TIMESTAMP");
  expect(mysql.warnings).toHaveLength(1);
});

test("stored generated columns are portable and unsafe expressions are omitted", () => {
  const editor = makeEditor();
  const table = editor.buildElement("erd.table", {
    semantic: {
      tableName: "line_items",
      columns: [
        { id: "quantity", name: "quantity", dataType: "decimal" },
        { id: "price", name: "unit_price", dataType: "decimal" },
        {
          id: "total",
          name: "total",
          dataType: "decimal",
          generatedExpression: "quantity * unit_price",
        },
        {
          id: "unsafe",
          name: "unsafe_total",
          dataType: "decimal",
          generatedExpression: "quantity; DROP TABLE line_items",
        },
      ],
    },
  });
  editor.apply([{ type: "createElement", element: table }]);

  for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
    const result = generateDatabaseDdl(editor, editor.currentPageId, dialect);
    const quoted = dialect === "mysql" ? "`total`" : '"total"';
    const type = dialect === "sqlite" ? "NUMERIC" : "DECIMAL";
    expect(result.sql).toContain(
      `${quoted} ${type} NOT NULL GENERATED ALWAYS AS (quantity * unit_price) STORED`,
    );
    expect(result.sql).not.toContain(
      "GENERATED ALWAYS AS (quantity; DROP TABLE line_items)",
    );
    expect(result.warnings).toEqual([
      'line_items.unsafe_total: unsafe or unsupported generated expression "quantity; DROP TABLE line_items" was omitted. Use one portable row-local SQL expression.',
    ]);
    if (dialect === "sqlite") {
      const database = new Database(":memory:");
      try {
        database.exec(result.sql);
        database
          .query(
            "INSERT INTO line_items (quantity, unit_price, unsafe_total) VALUES (?, ?, ?)",
          )
          .run(3, 12.5, 0);
        expect(database.query("SELECT total FROM line_items").get()).toEqual({
          total: 37.5,
        });
        database.exec("UPDATE line_items SET quantity = 4");
        expect(database.query("SELECT total FROM line_items").get()).toEqual({
          total: 50,
        });
        expect(() =>
          database.exec("UPDATE line_items SET total = 0"),
        ).toThrow();
      } finally {
        database.close();
      }
    }
  }
});
