import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Editor } from "@nodetto/core";
import { parseDocument, serializeDocument } from "@nodetto/io";
import { runCliAsync } from "./cli.ts";
import type { CommandIo, CommandResult } from "./commands.ts";
import { COMMAND_HELP } from "./help.ts";
import { createMcpServer } from "./mcp.ts";

const doc = [
  '{"kind":"document","schemaVersion":1,"id":"doc","title":"Shop"}',
  '{"kind":"page","id":"p1","name":"Schema","pageKind":"erd"}',
  '{"kind":"element","id":"t-users","page":"p1","type":"erd.table","index":"a0","semantic":{"tableName":"users","columns":[{"id":"c-id","name":"id","dataType":"uuid","pk":true}]},"visual":{"x":0,"y":0,"width":280}}',
  "",
].join("\n");
const bpmn = readFileSync(
  new URL(
    "../../../packages/io/src/__fixtures__/bpmn/purchase-request.jsonl",
    import.meta.url,
  ),
  "utf8",
);
const xml = readFileSync(
  new URL(
    "../../../packages/io/src/__fixtures__/bpmn/purchase-request.bpmn",
    import.meta.url,
  ),
  "utf8",
);
const ops = '[{"op":"move","id":"t-users","x":100,"y":200}]';
function output(
  result: Awaited<ReturnType<Client["callTool"]>>,
): CommandResult {
  return result.structuredContent as unknown as CommandResult;
}

function memoryIo() {
  const files = new Map([
    ["doc.jsonl", doc],
    ["before.jsonl", doc],
    ["process.jsonl", bpmn],
    ["process.bpmn", xml],
    ["ops.json", ops],
    ["stale.sql", "-- stale\n"],
    ["unsafe.jsonl", doc.replace('"uuid"', '"uuid;drop"')],
  ]);
  const bytes = new Map<string, Uint8Array>();
  const opened: [string, string | undefined][] = [];
  const io: CommandIo = {
    readText(path) {
      const source = files.get(path);
      if (source === undefined) throw new Error("ENOENT");
      return source;
    },
    writeText: (path, text) => {
      files.set(path, text);
    },
    writeBytes: (path, data) => {
      bytes.set(path, data);
    },
    exists: (path) => files.has(path),
    readStdin: () => {
      throw new Error("MCP must never read transport stdin");
    },
    openDocument: async (path, app) => {
      opened.push([path, app]);
    },
  };
  return { io, files, bytes, opened };
}

async function connect(io: CommandIo) {
  const server = createMcpServer(io, "test");
  const client = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test("MCP discovers every document command and documents every CLI option", async () => {
  const session = await connect(memoryIo().io);
  try {
    const { tools } = await session.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "nodetto_cli",
        "nodetto_help",
        ...Object.keys(COMMAND_HELP)
          .filter((name) => name !== "mcp")
          .map((name) => `nodetto_${name}`),
      ].sort(),
    );
    for (const [command, help] of Object.entries(COMMAND_HELP)) {
      if (command === "mcp") continue;
      expect(
        tools.find((tool) => tool.name === `nodetto_${command}`)?.description,
      ).toBe(help);
    }
    for (const args of [[], ["edit"], ["mcp"]]) {
      const result = await session.client.callTool({
        name: "nodetto_help",
        arguments: { args },
      });
      expect(result.structuredContent).toEqual(
        await runCliAsync(["help", ...args], memoryIo().io, "test"),
      );
    }
  } finally {
    await session.close();
  }
});

const cases: string[][] = [
  ["inspect", "doc.jsonl", "--format", "json", "--ids", "full"],
  ["types", "erd.table", "--format", "json"],
  ["validate", "doc.jsonl"],
  ["diff", "before.jsonl", "doc.jsonl", "--format", "json", "--exit-code"],
  [
    "edit",
    "doc.jsonl",
    "--ops",
    "ops.json",
    "--snapshot",
    "snapshot.jsonl",
    "--format",
    "json",
  ],
  ["arrange", "doc.jsonl", "--mode", "overlaps", "--write"],
  ["format", "doc.jsonl", "--write"],
  ["ddl", "doc.jsonl", "--dialect", "sqlite", "--output", "schema.sql"],
  ["lint", "process.jsonl", "--format", "json"],
  ["bpmn", "export", "process.jsonl", "--output", "export.bpmn"],
  ["open", "doc.jsonl", "--app", "My Nodetto.app"],
  ["export", "doc.jsonl", "--format", "svg"],
];
for (const args of cases) {
  test(`MCP matches CLI results and effects: ${args.join(" ")}`, async () => {
    const direct = memoryIo();
    const remote = memoryIo();
    const expected = await runCliAsync(args, direct.io, "test");
    expect(expected.exitCode).toBe(0);
    const session = await connect(remote.io);
    try {
      const result = await session.client.callTool({
        name: `nodetto_${args[0]}`,
        arguments: { args: args.slice(1) },
      });
      expect(result.structuredContent).toEqual(expected);
      expect(result.isError).toBe(false);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(expected) },
      ]);
      expect(remote.files).toEqual(direct.files);
      expect(remote.bytes).toEqual(direct.bytes);
      expect(remote.opened).toEqual(direct.opened);
    } finally {
      await session.close();
    }
  });
}

test("MCP supplies inline operations, preserves dry-run and snapshots, and stays usable after errors", async () => {
  const memory = memoryIo();
  const session = await connect(memory.io);
  const editArgs = ["doc.jsonl", "--ops", "-", "--snapshot", "snapshot.jsonl"];
  try {
    const missing = await session.client.callTool({
      name: "nodetto_edit",
      arguments: { args: editArgs },
    });
    expect(missing.isError).toBe(true);
    expect(output(missing).stderr).toContain("stdin field");
    const invalid = await session.client.callTool({
      name: "nodetto_edit",
      arguments: { args: editArgs, stdin: "bad json" },
    });
    expect(invalid.isError).toBe(true);
    expect(memory.files.get("doc.jsonl")).toBe(doc);
    const dry = await session.client.callTool({
      name: "nodetto_edit",
      arguments: { args: [...editArgs, "--dry-run"], stdin: ops },
    });
    expect(dry.isError).toBe(false);
    expect(memory.files.get("doc.jsonl")).toBe(doc);
    expect(memory.files.has("snapshot.jsonl")).toBe(false);
    const applied = await session.client.callTool({
      name: "nodetto_edit",
      arguments: { args: editArgs, stdin: ops },
    });
    expect(applied.isError).toBe(false);
    expect(
      parseDocument(memory.files.get("doc.jsonl")!).elements[0]?.visual?.x,
    ).toBe(100);
    expect(memory.files.get("snapshot.jsonl")).toBe(
      memory.files.get("doc.jsonl"),
    );
  } finally {
    await session.close();
  }
});

test("generic MCP tool preserves CLI exit codes, help/version and exception recovery", async () => {
  const memory = memoryIo();
  const session = await connect(memory.io);
  try {
    for (const [args, exitCode] of [
      [["--version"], 0],
      [["--help"], 0],
      [["help", "bpmn"], 0],
      [["ddl", "doc.jsonl", "--check", "stale.sql"], 1],
      [["validate", "missing.jsonl"], 2],
      [["ddl", "unsafe.jsonl", "--strict"], 3],
      [["mcp"], 2],
      [["mcp", "--help"], 0],
    ] as const) {
      const result = await session.client.callTool({
        name: "nodetto_cli",
        arguments: { args: [...args] },
      });
      expect(output(result).exitCode).toBe(exitCode);
      expect(result.isError).toBe(exitCode !== 0);
    }
    const invalid = await session.client.callTool({
      name: "nodetto_cli",
      arguments: { args: "not an array" },
    });
    expect(invalid.isError).toBe(true);
    const unknown = await session.client.callTool({
      name: "missing_tool",
      arguments: { args: [] },
    });
    expect(unknown.isError).toBe(true);
    memory.io.readText = () => {
      throw new Error("unexpected read failure");
    };
    const failure = await session.client.callTool({
      name: "nodetto_edit",
      arguments: { args: ["doc.jsonl", "--ops", "-"], stdin: ops },
    });
    expect(failure.isError).toBe(true);
    expect(
      (
        await session.client.callTool({
          name: "nodetto_cli",
          arguments: { args: ["--version"] },
        })
      ).isError,
    ).toBe(false);
  } finally {
    await session.close();
  }
});

test("MCP supports BPMN import and all four render formats", async () => {
  const memory = memoryIo();
  const session = await connect(memory.io);
  try {
    const imported = await session.client.callTool({
      name: "nodetto_bpmn",
      arguments: {
        args: ["import", "process.bpmn", "--output", "imported.jsonl"],
      },
    });
    expect(imported.isError).toBe(false);
    expect(
      parseDocument(memory.files.get("imported.jsonl")!).pages[0]?.kind,
    ).toBe("bpmn");
    const editor = new Editor();
    const frame = editor.createElement("frame", {
      semantic: { name: "Home", platform: "web" },
      visual: { x: 0, y: 0, width: 500, height: 500 },
    });
    memory.files.set("design.jsonl", serializeDocument(editor.getSnapshot()));
    for (const format of ["svg", "png", "pdf", "html"]) {
      const path = `out.${format}`;
      const result = await session.client.callTool({
        name: "nodetto_export",
        arguments: {
          args:
            format === "html"
              ? [
                  "design.jsonl",
                  "--format",
                  format,
                  "--output",
                  path,
                  "--element",
                  frame,
                ]
              : ["doc.jsonl", "--format", format, "--output", path],
        },
      });
      expect(result.isError).toBe(false);
      if (format === "svg") expect(memory.files.get(path)).toContain("<svg");
      else {
        const data = memory.bytes.get(path)!;
        const signature =
          format === "png"
            ? [137, 80, 78, 71]
            : format === "pdf"
              ? [37, 80, 68, 70]
              : [80, 75, 3, 4];
        expect([...data.slice(0, 4)]).toEqual(signature);
      }
    }
  } finally {
    await session.close();
  }
});

test("MCP preserves edit contention exit code 4 without writing", async () => {
  const memory = memoryIo();
  let reads = 0;
  memory.io.readText = () => doc.replace('"Shop"', `"Shop ${reads++}"`);
  const session = await connect(memory.io);
  try {
    const result = await session.client.callTool({
      name: "nodetto_edit",
      arguments: { args: ["doc.jsonl", "--ops", "-"], stdin: ops },
    });
    expect(output(result).exitCode).toBe(4);
    expect(result.isError).toBe(true);
    expect(memory.files.get("doc.jsonl")).toBe(doc);
  } finally {
    await session.close();
  }
});
