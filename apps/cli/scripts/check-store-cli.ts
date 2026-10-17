// Run only against an explicitly authorized, disposable project folder.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const executable = process.argv[2];
const directory = process.argv[3];
if (!executable || !directory)
  throw new Error(
    "Usage: check-store-cli.ts <sandboxed-cli> <authorized-qa-project>",
  );
const client = new Client({ name: "store-cli-qa", version: "1" });
const transport = new StdioClientTransport({
  command: resolve(executable),
  args: ["--cwd", resolve(directory), "mcp"],
  cwd: resolve(directory),
  stderr: "inherit",
});
try {
  await client.connect(transport);
  for (const [name, args, stdin] of [
    ["nodetto_validate", ["schema.jsonl"]],
    [
      "nodetto_edit",
      ["schema.jsonl", "--ops", "-", "--snapshot", "mcp-snapshot.jsonl"],
      '[{"op":"add-page","name":"MCP Sandbox","kind":"freeform"}]',
    ],
    [
      "nodetto_export",
      [
        "schema.jsonl",
        "--page",
        "Domain model",
        "--format",
        "png",
        "--output",
        "mcp-preview.png",
      ],
    ],
    ["nodetto_cli", ["--version"]],
  ] as const) {
    const result = await client.callTool({
      name,
      arguments: { args: [...args], ...(stdin === undefined ? {} : { stdin }) },
    });
    if (result.isError)
      throw new Error(
        JSON.stringify(result.structuredContent ?? result.content),
      );
    console.log(`${name}: OK`);
  }
  if (
    !existsSync(resolve(directory, "mcp-preview.png")) ||
    !existsSync(resolve(directory, "mcp-snapshot.jsonl"))
  )
    throw new Error("MCP did not write sandboxed output files");
} finally {
  await client.close();
}
