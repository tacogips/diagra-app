import { expect, test } from "bun:test";
import {
  type CommandIo,
  EXIT_DRIFT,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_WARNINGS,
  runCli,
} from "./commands.ts";

const ERD = [
  '{"kind":"document","schemaVersion":1,"id":"01JCLI0000000000000000000","title":"Shop"}',
  '{"kind":"page","id":"p1","name":"Schema","pageKind":"erd"}',
  '{"kind":"element","id":"t-users","page":"p1","type":"erd.table","index":"a0","semantic":{"tableName":"users","columns":[{"id":"c-id","name":"id","dataType":"varchar(36)","pk":true},{"id":"c-email","name":"email","dataType":"varchar(320)","nullable":false},{"id":"c-active","name":"active","dataType":"boolean","nullable":false,"defaultExpression":"true"}],"indexes":[{"id":"i-email","name":"ix_users_email","columns":["c-email"],"unique":true}]},"visual":{"x":0,"y":0,"width":280}}',
  "",
].join("\n");

function memoryIo(files: Record<string, string>): CommandIo & {
  readonly files: Map<string, string>;
} {
  const store = new Map(Object.entries(files));
  return {
    files: store,
    readText(path) {
      const text = store.get(path);
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    writeText(path, text) {
      store.set(path, text);
    },
  };
}

test("ddl prints the same SQL as the inspector for the only ERD page", () => {
  const result = runCli(
    ["ddl", "doc.jsonl", "--dialect", "postgresql"],
    memoryIo({ "doc.jsonl": ERD }),
    "test",
  );
  expect(result.exitCode).toBe(EXIT_OK);
  expect(result.stdout).toContain('CREATE TABLE "users" (');
  expect(result.stdout).toContain('"id" VARCHAR(36) NOT NULL');
  expect(result.stdout).toContain('"active" BOOLEAN NOT NULL DEFAULT true');
  expect(result.stdout).toContain(
    'CREATE UNIQUE INDEX "ix_users_email" ON "users" ("email");',
  );
});

test("ddl --output writes and --check detects drift", () => {
  const io = memoryIo({ "doc.jsonl": ERD });
  const written = runCli(
    ["ddl", "doc.jsonl", "--dialect=sqlite", "--output", "schema.sql"],
    io,
    "test",
  );
  expect(written.exitCode).toBe(EXIT_OK);
  expect(io.files.get("schema.sql")).toContain('"id" TEXT NOT NULL');

  const fresh = runCli(
    ["ddl", "doc.jsonl", "--dialect=sqlite", "--check", "schema.sql"],
    io,
    "test",
  );
  expect(fresh.exitCode).toBe(EXIT_OK);

  io.files.set("schema.sql", "-- edited by hand\n");
  const stale = runCli(
    ["ddl", "doc.jsonl", "--dialect=sqlite", "--check", "schema.sql"],
    io,
    "test",
  );
  expect(stale.exitCode).toBe(EXIT_DRIFT);
  expect(stale.stderr).toContain("schema.sql is out of date");
});

test("ddl --strict fails when the export warns", () => {
  const unsafe = ERD.replace('"dataType":"boolean"', '"dataType":"bool;drop"');
  const result = runCli(
    ["ddl", "doc.jsonl", "--strict"],
    memoryIo({ "doc.jsonl": unsafe }),
    "test",
  );
  expect(result.exitCode).toBe(EXIT_WARNINGS);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("unsafe or empty type");
});

test("ddl requires --page when several pages contain tables", () => {
  const twoPages = [
    ERD.trimEnd(),
    '{"kind":"page","id":"p2","name":"Other","pageKind":"erd"}',
    '{"kind":"element","id":"t-teams","page":"p2","type":"erd.table","index":"a0","semantic":{"tableName":"teams","columns":[{"id":"c-id","name":"id","dataType":"integer","pk":true}]}}',
    "",
  ].join("\n");
  const io = memoryIo({ "doc.jsonl": twoPages });
  const ambiguous = runCli(["ddl", "doc.jsonl"], io, "test");
  expect(ambiguous.exitCode).toBe(EXIT_ERROR);
  expect(ambiguous.stderr).toContain("choose one with --page");
  const byName = runCli(["ddl", "doc.jsonl", "--page", "Other"], io, "test");
  expect(byName.exitCode).toBe(EXIT_OK);
  expect(byName.stdout).toContain('CREATE TABLE "teams"');
  expect(byName.stdout).not.toContain('CREATE TABLE "users"');
});

test("format --check and --write use the canonical JSONL form", () => {
  const shuffled = ERD.split("\n").reverse().join("\n");
  const io = memoryIo({ "doc.jsonl": shuffled });
  expect(runCli(["format", "doc.jsonl", "--check"], io, "test").exitCode).toBe(
    EXIT_DRIFT,
  );
  expect(runCli(["format", "doc.jsonl", "--write"], io, "test").exitCode).toBe(
    EXIT_OK,
  );
  expect(runCli(["format", "doc.jsonl", "--check"], io, "test").exitCode).toBe(
    EXIT_OK,
  );
});

test("invalid documents and arguments exit with the error code", () => {
  const io = memoryIo({ "bad.jsonl": "{not json}\n" });
  expect(runCli(["validate", "bad.jsonl"], io, "test").exitCode).toBe(
    EXIT_ERROR,
  );
  expect(runCli(["ddl", "missing.jsonl"], io, "test").exitCode).toBe(
    EXIT_ERROR,
  );
  expect(
    runCli(["ddl", "bad.jsonl", "--dialect", "oracle"], io, "test").stderr,
  ).toContain('Unsupported dialect "oracle"');
  expect(runCli(["frobnicate"], io, "test").exitCode).toBe(EXIT_ERROR);
  expect(runCli(["--version"], io, "1.2.3").stdout).toBe("diagra-cli 1.2.3\n");
});

test("arrange --write tidies overlapping tables and --check is then clean", () => {
  const stacked = [
    '{"kind":"document","schemaVersion":1,"id":"01JCLI0000000000000000001","title":"Pile"}',
    '{"kind":"page","id":"p1","name":"Schema","pageKind":"erd"}',
    '{"kind":"element","id":"t-a","page":"p1","type":"erd.table","index":"a0","semantic":{"tableName":"a","columns":[{"id":"c-id","name":"id","dataType":"integer","pk":true}]},"visual":{"x":0,"y":0,"width":200}}',
    '{"kind":"element","id":"t-b","page":"p1","type":"erd.table","index":"a1","semantic":{"tableName":"b","columns":[{"id":"c-id","name":"id","dataType":"integer","pk":true},{"id":"c-a","name":"a_id","dataType":"integer"}]},"visual":{"x":0,"y":0,"width":200}}',
    '{"kind":"element","id":"r","page":"p1","type":"erd.relation","index":"a2","semantic":{"from":{"table":"t-b","column":"c-a"},"to":{"table":"t-a","column":"c-id"},"cardinality":"*:1","logical":true}}',
    "",
  ].join("\n");
  const io = memoryIo({ "doc.jsonl": stacked });
  expect(runCli(["arrange", "doc.jsonl", "--check"], io, "test").exitCode).toBe(
    EXIT_DRIFT,
  );
  expect(runCli(["arrange", "doc.jsonl", "--write"], io, "test").exitCode).toBe(
    EXIT_OK,
  );
  expect(runCli(["arrange", "doc.jsonl", "--check"], io, "test").exitCode).toBe(
    EXIT_OK,
  );
  const text = io.files.get("doc.jsonl") ?? "";
  expect(text).toContain('"id":"t-b"');
  expect(text).toMatch(/"id":"t-b".*"visual":\{"x":3\d\d/);
  expect(
    runCli(["arrange", "doc.jsonl", "--mode", "grid"], io, "test").stderr,
  ).toContain('Unsupported mode "grid"');
  // The logical relation emits no constraint.
  expect(runCli(["ddl", "doc.jsonl"], io, "test").stdout).not.toContain(
    "FOREIGN KEY",
  );
});

test("a value option followed by another option is missing its value", () => {
  const io = memoryIo({ "doc.jsonl": ERD });
  const result = runCli(
    ["ddl", "doc.jsonl", "--output", "--strict"],
    io,
    "test",
  );
  expect(result.exitCode).toBe(EXIT_ERROR);
  expect(result.stderr).toContain("--output requires a value.");
  expect(io.files.has("--strict")).toBe(false);

  // The `=` form still allows a value that starts with "--".
  const explicit = runCli(
    ["ddl", "doc.jsonl", "--output=--strict"],
    io,
    "test",
  );
  expect(explicit.exitCode).toBe(EXIT_OK);
  expect(io.files.get("--strict")).toContain('CREATE TABLE "users"');
});

test("write failures exit with the error code, not the drift code", () => {
  const failing: CommandIo = {
    readText: (path) => {
      if (path === "doc.jsonl") return ERD;
      throw new Error("ENOENT");
    },
    writeText: () => {
      throw new Error("ENOSPC: no space left on device");
    },
  };
  for (const args of [
    ["ddl", "doc.jsonl", "--output", "schema.sql"],
    ["format", "doc.jsonl", "--write"],
    ["arrange", "doc.jsonl", "--write"],
  ]) {
    const result = runCli(args, failing, "test");
    expect(result.exitCode).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("ENOSPC");
  }
});
