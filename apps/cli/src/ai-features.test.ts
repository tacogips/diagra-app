import { expect, test } from "bun:test";
import { Editor } from "@nodetto/core";
import { parseDocument } from "@nodetto/io";
import type { Document, Element } from "@nodetto/ir";
import { runCliAsync } from "./cli.ts";
import {
  type CommandIo,
  EXIT_DRIFT,
  EXIT_ERROR,
  EXIT_OK,
  runCli,
} from "./commands.ts";

const DOC = (pageKind: string) =>
  [
    '{"kind":"document","schemaVersion":1,"id":"01JFEAT0000000000000000000","title":"Features"}',
    `{"kind":"page","id":"p1","name":"Main","pageKind":"${pageKind}"}`,
    "",
  ].join("\n");

function memoryIo(files: Record<string, string>): CommandIo & {
  readonly files: Map<string, string>;
  readonly bytes: Map<string, Uint8Array>;
} {
  const store = new Map(Object.entries(files));
  const bytes = new Map<string, Uint8Array>();
  return {
    files: store,
    bytes,
    readText(path) {
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

function edit(
  pageKind: string,
  ops: readonly unknown[],
): { readonly io: ReturnType<typeof memoryIo>; readonly document: Document } {
  const io = memoryIo({
    "doc.jsonl": DOC(pageKind),
    "ops.json": JSON.stringify(ops),
  });
  const result = runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t");
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(EXIT_OK);
  return { io, document: parseDocument(io.files.get("doc.jsonl") ?? "") };
}

function bounds(document: Document, element: Element | undefined) {
  const editor = new Editor({ document });
  editor.setCurrentPage(element?.page ?? "p1");
  const box = editor.getBounds(element?.id ?? "", editor.createShapeContext(1));
  if (!box) throw new Error("no bounds");
  return box;
}

const byLabel = (document: Document, label: string) =>
  document.elements.find(
    (element) =>
      (element.semantic as { label?: string; name?: string }).label === label ||
      (element.semantic as { name?: string }).name === label,
  );

test("add merges given fields over the type defaults", () => {
  const { document } = edit("bpmn", [
    { op: "add", page: "p1", type: "bpmn.event", semantic: { name: "Start" } },
  ]);
  const event = document.elements[0];
  expect(event?.semantic).toMatchObject({ name: "Start" });
  expect(
    Array.isArray((event?.semantic as { definitions?: unknown }).definitions),
  ).toBe(true);
});

test("elements without a position line up in a row and never overlap", () => {
  const { document } = edit("freeform", [
    { op: "add", page: "p1", type: "node.generic", semantic: { label: "A" } },
    {
      op: "add",
      page: "p1",
      type: "shape.geo",
      semantic: { geo: "rect", label: "B" },
      visual: { width: 100, height: 120 },
    },
    { op: "add", page: "p1", type: "node.generic", semantic: { label: "C" } },
  ]);
  const [a, b, c] = ["A", "B", "C"].map((label) =>
    bounds(document, byLabel(document, label)),
  );
  if (!a || !b || !c) throw new Error("missing");
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  expect(c.x).toBeGreaterThanOrEqual(b.x + b.width);
  // Centred on the previous auto-placed element.
  expect(b.y + b.height / 2).toBeCloseTo(a.y + a.height / 2, 0);
  expect(c.y + c.height / 2).toBeCloseTo(b.y + b.height / 2, 0);
});

test("place puts an element beside another with a gap and alignment", () => {
  const { document } = edit("freeform", [
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      ref: "a",
      semantic: { label: "A" },
      visual: { x: 100, y: 100 },
    },
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      semantic: { label: "Right" },
      place: { rightOf: "@a", gap: 40 },
    },
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      semantic: { label: "Below" },
      place: { below: "@a", align: "center" },
    },
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      semantic: { label: "Left" },
      place: { leftOf: "@a" },
    },
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      semantic: { label: "Above" },
      place: { above: "@a" },
    },
  ]);
  const a = bounds(document, byLabel(document, "A"));
  const right = bounds(document, byLabel(document, "Right"));
  const below = bounds(document, byLabel(document, "Below"));
  const left = bounds(document, byLabel(document, "Left"));
  const above = bounds(document, byLabel(document, "Above"));
  expect(right.x).toBe(a.x + a.width + 40);
  expect(right.y).toBe(a.y);
  expect(below.y).toBe(a.y + a.height + 80);
  expect(below.x + below.width / 2).toBeCloseTo(a.x + a.width / 2, 0);
  expect(left.x + left.width).toBe(a.x - 80);
  expect(above.y + above.height).toBe(a.y - 80);
});

test("connect uses the connector of each diagram kind", () => {
  const freeform = edit("freeform", [
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      ref: "a",
      semantic: { label: "A" },
    },
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      ref: "b",
      semantic: { label: "B" },
    },
    { op: "connect", from: "@a", to: "@b", label: "next", ref: "edge" },
  ]).document;
  expect(
    freeform.elements.find((e) => e.type === "edge.generic")?.semantic,
  ).toMatchObject({
    label: "next",
    arrowheads: { end: "arrow" },
  });

  const bpmn = edit("bpmn", [
    {
      op: "add",
      page: "p1",
      type: "bpmn.event",
      ref: "s",
      semantic: { name: "Start", position: "start" },
    },
    {
      op: "add",
      page: "p1",
      type: "bpmn.task",
      ref: "t",
      semantic: { name: "Work" },
    },
    { op: "connect", from: "@s", to: "@t", label: "go" },
  ]).document;
  expect(
    bpmn.elements.find((e) => e.type === "bpmn.sequenceFlow")?.semantic,
  ).toMatchObject({
    name: "go",
  });

  const sequence = edit("sequence", [
    {
      op: "add",
      page: "p1",
      type: "sequence.participant",
      ref: "u",
      semantic: { name: "User", kind: "actor", order: "a0" },
    },
    {
      op: "add",
      page: "p1",
      type: "sequence.participant",
      ref: "s",
      semantic: { name: "Server", kind: "service", order: "a1" },
    },
    { op: "connect", from: "@u", to: "@s", label: "request" },
    { op: "connect", from: "@s", to: "@u", label: "response" },
  ]).document;
  const messages = sequence.elements.filter(
    (e) => e.type === "sequence.message",
  );
  const request = messages.find(
    (m) => (m.semantic as { label: string }).label === "request",
  );
  const response = messages.find(
    (m) => (m.semantic as { label: string }).label === "response",
  );
  expect(response?.visual.y).toBeGreaterThan(
    request?.visual.y ?? Number.POSITIVE_INFINITY,
  );
  expect(
    (response?.semantic as { order: string }).order >
      (request?.semantic as { order: string }).order,
  ).toBe(true);
});

test("connect between ERD tables resolves column names", () => {
  const { document } = edit("erd", [
    {
      op: "add",
      page: "p1",
      type: "erd.table",
      ref: "u",
      semantic: {
        tableName: "users",
        columns: [{ name: "id", dataType: "uuid", pk: true }],
      },
    },
    {
      op: "add",
      page: "p1",
      type: "erd.table",
      ref: "o",
      semantic: {
        tableName: "orders",
        columns: [
          { name: "id", dataType: "uuid", pk: true },
          { name: "user_id", dataType: "uuid" },
        ],
      },
    },
    {
      op: "connect",
      from: "@o",
      to: "@u",
      fromColumn: "user_id",
      toColumn: "id",
    },
  ]);
  const orders = document.elements.find(
    (e) => (e.semantic as { tableName?: string }).tableName === "orders",
  );
  const userId = (
    orders?.semantic as { columns: { id: string; name: string }[] }
  ).columns.find((c) => c.name === "user_id");
  expect(
    document.elements.find((e) => e.type === "erd.relation")?.semantic,
  ).toMatchObject({
    from: { table: orders?.id, column: userId?.id },
    cardinality: "*:1",
  });
});

test("connect refuses a link the diagram rules forbid and writes nothing", () => {
  const io = memoryIo({
    "doc.jsonl": DOC("bpmn"),
    "ops.json": JSON.stringify([
      {
        op: "add",
        page: "p1",
        type: "bpmn.event",
        ref: "e",
        semantic: { name: "End", position: "end" },
      },
      {
        op: "add",
        page: "p1",
        type: "bpmn.task",
        ref: "t",
        semantic: { name: "Work" },
      },
      { op: "connect", from: "@e", to: "@t" },
    ]),
  });
  const result = runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t");
  expect(result.exitCode).toBe(EXIT_ERROR);
  expect(result.stderr).toContain("Operation 2 (connect)");
  expect(io.files.get("doc.jsonl")).toBe(DOC("bpmn"));
});

test("append and remove-item edit one list item at a time", () => {
  const { document } = edit("erd", [
    {
      op: "add",
      page: "p1",
      type: "erd.table",
      ref: "t",
      semantic: {
        tableName: "t",
        columns: [{ name: "id", dataType: "uuid", pk: true }],
      },
    },
    {
      op: "append",
      id: "@t",
      field: "columns",
      items: [
        { name: "a", dataType: "text" },
        { name: "b", dataType: "text" },
      ],
    },
    { op: "remove-item", id: "@t", field: "columns", item: "a" },
  ]);
  const columns = (
    document.elements[0]?.semantic as {
      columns: { id: string; name: string }[];
    }
  ).columns;
  expect(columns.map((c) => c.name)).toEqual(["id", "b"]);
  expect(
    columns.every((c) => typeof c.id === "string" && c.id.length > 0),
  ).toBe(true);
});

test("diff lists added, changed and removed elements with changed fields", () => {
  const { io } = edit("freeform", [
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      ref: "a",
      id: "node-a",
      semantic: { label: "A" },
    },
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      id: "node-b",
      semantic: { label: "B" },
    },
  ]);
  io.files.set(
    "ops.json",
    JSON.stringify([
      { op: "update", id: "node-a", semantic: { label: "A2" } },
      { op: "delete", id: "node-b" },
      {
        op: "add",
        page: "p1",
        type: "node.generic",
        id: "node-c",
        semantic: { label: "C" },
      },
    ]),
  );
  expect(
    runCli(
      ["edit", "doc.jsonl", "--ops", "ops.json", "--snapshot", "before.jsonl"],
      io,
      "t",
    ).exitCode,
  ).toBe(EXIT_OK);
  // The snapshot is the batch result; the person then edits the file.
  io.files.set(
    "ops.json",
    JSON.stringify([{ op: "move", id: "node-a", x: 500, y: 0 }]),
  );
  runCli(["edit", "doc.jsonl", "--ops", "ops.json"], io, "t");
  const result = runCli(
    ["diff", "before.jsonl", "doc.jsonl", "--exit-code"],
    io,
    "t",
  );
  expect(result.exitCode).toBe(EXIT_DRIFT);
  expect(result.stdout).toContain('~ node.generic node-a "A2"');
  expect(result.stdout).toContain("[visual.x]");
  expect(result.stdout).toContain("0 added, 1 changed, 0 removed.");
  const same = runCli(
    ["diff", "doc.jsonl", "doc.jsonl", "--exit-code"],
    io,
    "t",
  );
  expect(same.exitCode).toBe(EXIT_OK);
  expect(same.stdout).toBe("No changes.\n");
  const json = JSON.parse(
    runCli(["diff", "before.jsonl", "doc.jsonl", "--format", "json"], io, "t")
      .stdout,
  );
  expect(json.changes[0]).toMatchObject({ kind: "changed", id: "node-a" });
});

test("export --element renders one frame or element; large pages scale down automatically", async () => {
  const { io } = edit("freeform", [
    {
      op: "add",
      page: "p1",
      type: "frame",
      id: "frame-1",
      semantic: { name: "Area" },
      visual: { x: 0, y: 0, width: 400, height: 300 },
    },
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      id: "inside",
      semantic: { label: "In" },
      visual: { x: 40, y: 40 },
    },
    {
      op: "add",
      page: "p1",
      type: "node.generic",
      id: "far-away",
      semantic: { label: "Far" },
      visual: { x: 9000, y: 4500 },
    },
  ]);
  const frame = await runCliAsync(
    ["export", "doc.jsonl", "--element", "frame-1", "--format", "svg"],
    io,
    "t",
  );
  expect(frame.exitCode).toBe(EXIT_OK);
  expect(frame.stdout).toContain('width="400"');
  const node = await runCliAsync(
    [
      "export",
      "doc.jsonl",
      "--element",
      "inside",
      "--format",
      "png",
      "--output",
      "n.png",
    ],
    io,
    "t",
  );
  expect(node.exitCode).toBe(EXIT_OK);

  const page = await runCliAsync(
    [
      "export",
      "doc.jsonl",
      "--format",
      "png",
      "--scale",
      "4",
      "--output",
      "p.png",
    ],
    io,
    "t",
  );
  expect(page.exitCode).toBe(EXIT_ERROR);
  expect(page.stderr).toContain("limited to 8192 pixels");
  const fitted = await runCliAsync(
    ["export", "doc.jsonl", "--format", "png", "--output", "p.png"],
    io,
    "t",
  );
  expect(fitted.exitCode).toBe(EXIT_OK);
  expect(fitted.stderr).toContain("scaled to");
});

test("AI connect creates destination-aware popup transitions and preserves animation overrides", () => {
  const { document } = edit("freeform", [
    {
      op: "add",
      page: "p1",
      type: "frame",
      ref: "screen",
      semantic: { name: "Home", screenKind: "screen" },
      visual: { x: 0, y: 0, width: 400, height: 600 },
    },
    {
      op: "add",
      page: "p1",
      type: "ui.control",
      ref: "button",
      semantic: { control: "button", label: "Show details" },
      visual: { x: 20, y: 60, width: 180, height: 44 },
    },
    {
      op: "add",
      page: "p1",
      type: "frame",
      ref: "sheet",
      semantic: { name: "Details", screenKind: "bottom-sheet" },
      visual: { x: 600, y: 0, width: 390, height: 300 },
    },
    {
      op: "connect",
      from: "@button",
      to: "@sheet",
      semantic: { prototype: true, prototypeDuration: 400 },
    },
  ]);
  const edge = document.elements.find(
    (element) => element.type === "edge.generic",
  );
  expect(edge?.semantic).toMatchObject({
    prototype: true,
    prototypeAction: "open-overlay",
    prototypeTransition: "slide-up",
    prototypeOverlayPosition: "bottom-center",
    prototypeDuration: 400,
  });
});
