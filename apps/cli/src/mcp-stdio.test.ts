import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseDocument } from "@nodetto/io";
import type { CommandResult } from "./commands.ts";

const launches = [
  {
    name: "source",
    command: process.execPath,
    args: [join(import.meta.dir, "main.ts"), "mcp"],
  },
  ...(process.env.NODETTO_CLI_TEST_BINARY
    ? [
        {
          name: "compiled",
          command: process.env.NODETTO_CLI_TEST_BINARY,
          args: ["mcp"],
        },
      ]
    : []),
];
for (const launch of launches) {
  test(`MCP stdio ${launch.name}: real client, filesystem, renders and orderly shutdown`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "nodetto-mcp-"));
    const path = "document with spaces.jsonl";
    writeFileSync(
      join(cwd, path),
      [
        '{"kind":"document","schemaVersion":1,"id":"doc","title":"Demo"}',
        '{"kind":"page","id":"p1","name":"Flow","pageKind":"freeform"}',
        "",
      ].join("\n"),
    );
    const transport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      cwd,
      stderr: "pipe",
    });
    let diagnostics = "";
    transport.stderr?.on("data", (chunk) => {
      diagnostics += chunk.toString();
    });
    const client = new Client({ name: "stdio-test", version: "1" });
    try {
      await client.connect(transport);
      expect(
        (await client.listTools()).tools.some(
          (tool) => tool.name === "nodetto_open",
        ),
      ).toBe(true);
      const call = async (name: string, args: string[], stdin?: string) => {
        const result = await client.callTool({
          name,
          arguments: { args, ...(stdin === undefined ? {} : { stdin }) },
        });
        expect(result.isError).toBe(false);
        return result.structuredContent as unknown as CommandResult;
      };
      await call(
        "nodetto_edit",
        [path, "--ops", "-", "--snapshot", "baseline.jsonl"],
        JSON.stringify([
          {
            op: "add",
            page: "Flow",
            type: "node.generic",
            semantic: { label: "Hello MCP" },
          },
        ]),
      );
      const saved = readFileSync(join(cwd, path), "utf8");
      expect(parseDocument(saved).elements).toHaveLength(1);
      expect(readFileSync(join(cwd, "baseline.jsonl"), "utf8")).toBe(saved);
      expect((await call("nodetto_inspect", [path])).stdout).toContain(
        "Hello MCP",
      );
      await call("nodetto_validate", [path]);
      await call("nodetto_format", [path, "--check"]);
      await call("nodetto_export", [
        path,
        "--format",
        "png",
        "--output",
        "preview.png",
      ]);
      expect([
        ...readFileSync(join(cwd, "preview.png")).subarray(0, 4),
      ]).toEqual([137, 80, 78, 71]);
      const missing = await client.callTool({
        name: "nodetto_edit",
        arguments: { args: [path, "--ops", "-"] },
      });
      expect(missing.isError).toBe(true);
      expect((await call("nodetto_cli", ["--version"])).stdout).toMatch(
        /^nodetto-cli \d/,
      );
      // EOF must stop the server; a child left running would also block exit.
      const closed = new Promise<void>((resolve) => {
        transport.onclose = resolve;
      });
      await client.close();
      await closed;
      expect(diagnostics).toBe("");
    } finally {
      await client.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 15000);
  test(`MCP stdio ${launch.name} exits successfully on input EOF`, async () => {
    const child = Bun.spawn([launch.command, ...launch.args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill(), 5000);
    try {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "eof-test", version: "1" },
          },
        })}\n`,
      );
      child.stdin.end();
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout).result.serverInfo.name).toBe("nodetto-cli");
      expect(stderr).toBe("");
    } finally {
      clearTimeout(timer);
      child.kill();
    }
  }, 10000);
}

test("MCP startup help and invalid options return promptly without starting a server", () => {
  for (const args of [
    ["mcp", "--help"],
    ["help", "mcp"],
    ["mcp", "--port", "1234"],
  ]) {
    const result = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, "main.ts"),
      ...args,
    ]);
    expect(result.exitCode).toBe(args.includes("--port") ? 2 : 0);
    expect(
      new TextDecoder().decode(
        args.includes("--port") ? result.stderr : result.stdout,
      ),
    ).toContain("Usage: nodetto-cli mcp");
  }
});
