import { expect, test } from "bun:test";
import { parseDocument } from "@nodetto/io";
import { runCliAsync } from "./cli.ts";
import { type CommandIo, EXIT_ERROR, EXIT_OK, runCli } from "./commands.ts";
import { EXIT_CONTENDED } from "./edit-command.ts";
import { COMMAND_HELP, OVERVIEW } from "./help.ts";
import { shortIds } from "./ids.ts";

const EMPTY_ERD = [
  '{"kind":"document","schemaVersion":1,"id":"01JAI00000000000000000000","title":"Shop"}',
  '{"kind":"page","id":"p1","name":"Schema","pageKind":"erd"}',
  "",
].join("\n");

const DRAW = JSON.stringify([
  {
    op: "add",
    page: "Schema",
    type: "erd.table",
    ref: "users",
    semantic: {
      tableName: "users",
      columns: [{ name: "id", dataType: "uuid", pk: true }],
    },
    visual: { x: 0, y: 0 },
  },
  {
    op: "add",
    page: "p1",
    type: "erd.table",
    ref: "orders",
    semantic: {
      tableName: "orders",
      columns: [
        { name: "id", dataType: "uuid", pk: true },
        { name: "user_id", dataType: "uuid", nullable: false },
      ],
    },
    visual: { x: 360, y: 0 },
  },
  {
    op: "add",
    page: "p1",
    type: "erd.relation",
    semantic: {
      from: { table: "@orders", column: "user_id" },
      to: { table: "@users", column: "id" },
      cardinality: "*:1",
    },
  },
]);

function memoryIo(
  files: Record<string, string>,
  hooks: { readonly onRead?: (path: string, count: number) => void } = {},
): CommandIo & {
  readonly files: Map<string, string>;
  readonly bytes: Map<string, Uint8Array>;
} {
  const store = new Map(Object.entries(files));
  const bytes = new Map<string, Uint8Array>();
  const reads = new Map<string, number>();
  return {
    files: store,
    bytes,
    readText(path) {
      const count = (reads.get(path) ?? 0) + 1;
      reads.set(path, count);
      hooks.onRead?.(path, count);
      const text = store.get(path);
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    writeText(path, text) {
      store.set(path, text);
    },
    writeBytes(path, data) {
      bytes.set(path, data);
    },
  };
}

function drawn(): ReturnType<typeof memoryIo> {
  const io = memoryIo({ "doc.jsonl": EMPTY_ERD, "ops.json": DRAW });
  const result = runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t");
  expect(result.exitCode).toBe(EXIT_OK);
  return io;
}

test("top-level help is a short overview and each command has its own page", () => {
  const overview = runCli(["--help"], memoryIo({}), "t").stdout;
  expect(overview.split("\n").length).toBeLessThan(40);
  for (const command of ["inspect", "types", "edit", "export"]) {
    expect(overview).toContain(`nodetto-cli ${command}`);
    const page = runCli([command, "--help"], memoryIo({}), "t");
    expect(page.exitCode).toBe(EXIT_OK);
    expect(page.stdout).toBe(`${COMMAND_HELP[command]}\n`);
    expect(runCli(["help", command], memoryIo({}), "t").stdout).toBe(
      page.stdout,
    );
  }
  expect(runCli(["help"], memoryIo({}), "t").stdout).toBe(`${OVERVIEW}\n`);
});

test("edit applies a batch with refs, generated column ids and name-based relation columns", () => {
  const io = drawn();
  const document = parseDocument(io.files.get("doc.jsonl") ?? "");
  const tables = document.elements.filter((e) => e.type === "erd.table");
  expect(tables).toHaveLength(2);
  const relation = document.elements.find((e) => e.type === "erd.relation");
  const orders = tables.find(
    (e) => (e.semantic as { tableName: string }).tableName === "orders",
  );
  const userId = (
    orders?.semantic as { columns: { id: string; name: string }[] }
  ).columns.find((column) => column.name === "user_id");
  expect(userId?.id).toBeTruthy();
  expect(relation?.semantic).toMatchObject({
    from: { table: orders?.id, column: userId?.id },
    cardinality: "*:1",
  });
});

test("an invalid operation names its index and writes nothing", () => {
  const io = memoryIo({
    "doc.jsonl": EMPTY_ERD,
    "ops.json": JSON.stringify([
      {
        op: "add",
        page: "p1",
        type: "erd.table",
        semantic: {
          tableName: "t",
          columns: [{ name: "id", dataType: "uuid" }],
        },
      },
      { op: "move", id: "missing", x: 0, y: 0 },
    ]),
  });
  const result = runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t");
  expect(result.exitCode).toBe(EXIT_ERROR);
  expect(result.stderr).toContain("Operation 1 (move)");
  expect(io.files.get("doc.jsonl")).toBe(EMPTY_ERD);
});

test("a semantic validation error explains the field", () => {
  const io = memoryIo({
    "doc.jsonl": EMPTY_ERD,
    "ops.json": JSON.stringify([
      {
        op: "add",
        page: "p1",
        type: "erd.table",
        semantic: { tableName: "t" },
      },
    ]),
  });
  const result = runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t");
  expect(result.exitCode).toBe(EXIT_ERROR);
  expect(result.stderr).toContain("Operation 0 (add): invalid element:");
  expect(result.stderr).toContain("columns");
});

test("update deep-merges objects, replaces arrays, and accepts id prefixes", () => {
  const io = drawn();
  const users = parseDocument(io.files.get("doc.jsonl") ?? "").elements.find(
    (e) => (e.semantic as { tableName?: string }).tableName === "users",
  );
  io.files.set(
    "ops.json",
    JSON.stringify([
      {
        op: "update",
        id: users?.id.slice(0, 20),
        semantic: { tableName: "accounts" },
        visual: { x: 40 },
      },
    ]),
  );
  expect(
    runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t").exitCode,
  ).toBe(EXIT_OK);
  const updated = parseDocument(io.files.get("doc.jsonl") ?? "").elements.find(
    (e) => e.id === users?.id,
  );
  expect(updated?.semantic).toMatchObject({
    tableName: "accounts",
    columns: [{ name: "id", pk: true }],
  });
  expect(updated?.visual.x).toBe(40);
});

test("edit reapplies the batch when the file changes before the write", () => {
  let injected = false;
  const io = memoryIo(
    { "doc.jsonl": EMPTY_ERD, "ops.json": DRAW },
    {
      onRead(path, count) {
        // The person saves in the app between the CLI's read and its write.
        if (path === "doc.jsonl" && count === 2 && !injected) {
          injected = true;
          io.files.set(
            "doc.jsonl",
            EMPTY_ERD.replace('"title":"Shop"', '"title":"Shop v2"'),
          );
        }
      },
    },
  );
  const result = runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t");
  expect(result.exitCode).toBe(EXIT_OK);
  const document = parseDocument(io.files.get("doc.jsonl") ?? "");
  expect(document.title).toBe("Shop v2");
  expect(document.elements).toHaveLength(3);
});

test("edit gives up without writing when the file never settles", () => {
  let version = 0;
  const io = memoryIo(
    { "doc.jsonl": EMPTY_ERD, "ops.json": DRAW },
    {
      onRead(path) {
        if (path !== "doc.jsonl") return;
        version += 1;
        io.files.set(
          "doc.jsonl",
          EMPTY_ERD.replace('"title":"Shop"', `"title":"Shop ${version}"`),
        );
      },
    },
  );
  const result = runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t");
  expect(result.exitCode).toBe(EXIT_CONTENDED);
  expect(parseDocument(io.files.get("doc.jsonl") ?? "").elements).toHaveLength(
    0,
  );
});

test("inspect prints a compact outline with short ids and nested columns", () => {
  const io = drawn();
  const result = runCli(["inspect", "doc.jsonl"], io, "t");
  expect(result.exitCode).toBe(EXIT_OK);
  const lines = result.stdout.split("\n");
  expect(lines[0]).toBe('document "Shop"');
  expect(lines[1]).toBe('  page p1 "Schema" erd (3 elements)');
  expect(result.stdout).toMatch(/erd\.table \S+ users @0,0 \d+x\d+/);
  expect(result.stdout).toContain("      column user_id uuid not-null");
  expect(result.stdout).toMatch(
    /erd\.relation \S+ orders\.user_id -> users\.id \*:1/,
  );
  const json = runCli(["inspect", "doc.jsonl", "--format", "json"], io, "t");
  expect(JSON.parse(json.stdout).pages[0].elements).toHaveLength(3);
});

test("short ids are unique prefixes of at least six characters", () => {
  const ids = ["01ABCDEF1", "01ABCDEF2", "f-users", "abc"];
  const short = shortIds(ids);
  expect(short.get("01ABCDEF1")).toBe("01ABCDEF1");
  expect(short.get("f-users")).toBe("f-user");
  expect(short.get("abc")).toBe("abc");
});

test("types lists types per page kind and describes one type with an example", () => {
  const list = runCli(["types", "--kind", "erd"], memoryIo({}), "t");
  expect(list.stdout).toContain("erd: erd.table, erd.relation");
  const table = runCli(["types", "erd.table"], memoryIo({}), "t");
  expect(table.exitCode).toBe(EXIT_OK);
  expect(table.stdout).toContain("tableName");
  expect(table.stdout).toContain('{"op":"add"');
  expect(runCli(["types", "nope"], memoryIo({}), "t").exitCode).toBe(
    EXIT_ERROR,
  );
});

test("export renders SVG to stdout and PNG and PDF to files", async () => {
  const io = drawn();
  const svg = await runCliAsync(
    ["export", "doc.jsonl", "--format", "svg"],
    io,
    "t",
  );
  expect(svg.exitCode).toBe(EXIT_OK);
  expect(svg.stdout.startsWith("<svg")).toBe(true);

  const png = await runCliAsync(
    ["export", "doc.jsonl", "--format", "png", "--output", "out.png"],
    io,
    "t",
  );
  expect(png.exitCode).toBe(EXIT_OK);
  const pngBytes = io.bytes.get("out.png");
  expect([...(pngBytes ?? []).slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);

  const pdf = await runCliAsync(
    [
      "export",
      "doc.jsonl",
      "--format",
      "pdf",
      "--pdf-page",
      "a4",
      "--output",
      "out.pdf",
    ],
    io,
    "t",
  );
  expect(pdf.exitCode).toBe(EXIT_OK);
  expect(new TextDecoder().decode(io.bytes.get("out.pdf")?.slice(0, 5))).toBe(
    "%PDF-",
  );

  const missing = await runCliAsync(
    ["export", "doc.jsonl", "--format", "png"],
    io,
    "t",
  );
  expect(missing.exitCode).toBe(EXIT_ERROR);
  expect(missing.stderr).toContain("requires --output");
  const bad = await runCliAsync(
    [
      "export",
      "doc.jsonl",
      "--format",
      "png",
      "--scale",
      "7",
      "--output",
      "x.png",
    ],
    io,
    "t",
  );
  expect(bad.exitCode).toBe(EXIT_ERROR);
});
