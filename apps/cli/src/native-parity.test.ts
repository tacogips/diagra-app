import { expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Editor } from "@nodetto/core";
import { parseDocument, serializeDocument } from "@nodetto/io";

const binary = process.env.NODETTO_CLI_TEST_BINARY;
const fixtureRoot = join(
  import.meta.dir,
  "../../../packages/io/src/__fixtures__",
);
const source = join(import.meta.dir, "main.ts");
const nativeTest = binary ? test : test.skip;

function compare(args: string[], cwd?: string, stdin?: string) {
  const expected = Bun.spawnSync([process.execPath, source, ...args], {
    cwd,
    stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
  });
  const actual = Bun.spawnSync([binary!, ...args], {
    cwd,
    stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
  });
  expect(actual.exitCode).toBe(expected.exitCode);
  expect(actual.stdout.toString()).toBe(expected.stdout.toString());
  expect(actual.stderr.toString()).toBe(expected.stderr.toString());
  return actual;
}

nativeTest(
  "native CLI matches every JSONL golden fixture for validate, canonical format and both inspect formats",
  () => {
    for (const name of readdirSync(fixtureRoot).filter((name) =>
      name.endsWith(".jsonl"),
    )) {
      const path = join(fixtureRoot, name);
      for (const args of [
        ["validate", path],
        ["format", path],
        ["inspect", path],
        ["inspect", path, "--format", "json"],
      ])
        compare(args);
    }
  },
  60000,
);

nativeTest(
  "native CLI matches help, element catalogue, DDL, layout, diff, errors and BPMN",
  () => {
    for (const args of [
      ["--help"],
      ["--version"],
      ["help", "mcp"],
      ["types"],
      ["types", "erd.table", "--format", "json"],
      ["ddl", join(fixtureRoot, "erd.jsonl"), "--dialect", "mysql"],
      ["arrange", join(fixtureRoot, "erd.jsonl"), "--mode", "overlaps"],
      [
        "diff",
        join(fixtureRoot, "erd.jsonl"),
        join(fixtureRoot, "erd-unsorted.jsonl"),
        "--format",
        "json",
      ],
      [
        "lint",
        join(fixtureRoot, "bpmn/purchase-request.bpmn"),
        "--format",
        "json",
      ],
      ["bpmn", "export", join(fixtureRoot, "bpmn/purchase-request.jsonl")],
      ["validate", "/missing/document.jsonl"],
      ["export", "missing.jsonl", "--format", "bmp"],
      ["mcp", "--port", "1234"],
    ]) {
      // OS error wording differs between Node and std::fs; result codes and
      // contextual paths are checked separately for missing local files.
      if (args[0] === "validate" && args[1]?.startsWith("/missing")) {
        const result = Bun.spawnSync([binary!, ...args]);
        expect(result.exitCode).toBe(2);
        expect(result.stderr.toString()).toContain(
          "Cannot read /missing/document.jsonl:",
        );
      } else compare(args);
    }
  },
  60000,
);

nativeTest(
  "native edit handles refs, arrangement, snapshots and rollback using the shared engine",
  () => {
    const cwd = mkdtempSync(join(tmpdir(), "nodetto-native-edit-"));
    try {
      const source = serializeDocument(new Editor().getSnapshot());
      writeFileSync(join(cwd, "doc.jsonl"), source);
      const operations = [
        { op: "add-page", name: "Flow", kind: "freeform", ref: "flow" },
        {
          op: "add",
          page: "@flow",
          type: "node.generic",
          ref: "one",
          semantic: { label: "First" },
        },
        {
          op: "add",
          page: "@flow",
          type: "node.generic",
          ref: "two",
          place: { rightOf: "@one", gap: 80 },
          semantic: { label: "Second" },
        },
        { op: "connect", from: "@one", to: "@two", label: "Next" },
        { op: "update", id: "@one", visual: { x: 40 } },
        { op: "move", id: "@two", x: 400, y: 100 },
        { op: "rename-page", id: "@flow", name: "Renamed" },
      ];
      const applied = Bun.spawnSync(
        [
          binary!,
          "edit",
          "doc.jsonl",
          "--ops",
          "-",
          "--snapshot",
          "last.jsonl",
          "--arrange",
        ],
        { cwd, stdin: new TextEncoder().encode(JSON.stringify(operations)) },
      );
      expect(applied.exitCode).toBe(0);
      const saved = readFileSync(join(cwd, "doc.jsonl"), "utf8");
      const document = parseDocument(saved);
      expect(document.elements).toHaveLength(3);
      expect(document.pages.some((page) => page.name === "Renamed")).toBe(true);
      expect(readFileSync(join(cwd, "last.jsonl"), "utf8")).toBe(saved);
      compare(["inspect", "doc.jsonl"], cwd);
      compare(["format", "doc.jsonl", "--check"], cwd);
      const invalid = Bun.spawnSync(
        [binary!, "edit", "doc.jsonl", "--ops", "-"],
        {
          cwd,
          stdin: new TextEncoder().encode(
            '[{"op":"move","id":"missing","x":0,"y":0}]',
          ),
        },
      );
      expect(invalid.exitCode).toBe(2);
      expect(readFileSync(join(cwd, "doc.jsonl"), "utf8")).toBe(saved);
      const importResult = Bun.spawnSync(
        [
          binary!,
          "bpmn",
          "import",
          join(fixtureRoot, "bpmn/purchase-request.bpmn"),
          "--output",
          "process.jsonl",
        ],
        { cwd },
      );
      expect(importResult.exitCode).toBe(0);
      expect(
        parseDocument(readFileSync(join(cwd, "process.jsonl"), "utf8")).pages[0]
          ?.kind,
      ).toBe("bpmn");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
  15000,
);

nativeTest(
  "native --cwd supports document commands and preserves check/strict exit codes",
  () => {
    const cwd = mkdtempSync(join(tmpdir(), "nodetto-native-cwd-"));
    try {
      const erd = readFileSync(join(fixtureRoot, "erd.jsonl"), "utf8");
      writeFileSync(join(cwd, "doc.jsonl"), erd);
      writeFileSync(join(cwd, "stale.sql"), "-- stale\n");
      const native = Bun.spawnSync([
        binary!,
        "--cwd",
        cwd,
        "inspect",
        "doc.jsonl",
        "--format",
        "json",
      ]);
      const expected = Bun.spawnSync(
        [process.execPath, source, "inspect", "doc.jsonl", "--format", "json"],
        { cwd },
      );
      expect(native.exitCode).toBe(0);
      expect(native.stdout.toString()).toBe(expected.stdout.toString());
      expect(
        Bun.spawnSync([
          binary!,
          "--cwd",
          cwd,
          "ddl",
          "doc.jsonl",
          "--check",
          "stale.sql",
        ]).exitCode,
      ).toBe(1);
      writeFileSync(
        join(cwd, "unsafe.jsonl"),
        erd.replace(/"dataType":"[^"]+"/, '"dataType":"uuid;drop"'),
      );
      expect(
        Bun.spawnSync([
          binary!,
          "--cwd",
          cwd,
          "ddl",
          "unsafe.jsonl",
          "--strict",
        ]).exitCode,
      ).toBe(3);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);

nativeTest(
  "native renders SVG with byte parity, PNG, PDF and HTML ZIP without a JS runtime",
  () => {
    const cwd = mkdtempSync(join(tmpdir(), "nodetto-native-export-"));
    try {
      for (const name of [
        "erd",
        "uml-class",
        "uml-component",
        "sequence",
        "bpmn",
        "ui-controls",
        "freeform",
      ])
        compare([
          "export",
          join(fixtureRoot, `${name}.jsonl`),
          "--format",
          "svg",
        ]);
      const editor = new Editor();
      const frame = editor.createElement("frame", {
        semantic: { name: "Home", platform: "web" },
        visual: { x: 0, y: 0, width: 500, height: 500 },
      });
      editor.createElement("text.note", {
        semantic: { text: "Hello 日本語 \u{1f469}\u200d\u{1f4bb}" },
        visual: { x: 20, y: 20, width: 240 },
      });
      writeFileSync(
        join(cwd, "design.jsonl"),
        serializeDocument(editor.getSnapshot()),
      );
      for (const format of ["png", "pdf", "html"]) {
        const result = Bun.spawnSync(
          [
            binary!,
            "export",
            "design.jsonl",
            "--format",
            format,
            "--element",
            frame,
            "--output",
            `out.${format}`,
          ],
          { cwd },
        );
        expect(result.exitCode).toBe(0);
        const bytes = readFileSync(join(cwd, `out.${format}`));
        const signature =
          format === "png"
            ? [137, 80, 78, 71]
            : format === "pdf"
              ? [37, 80, 68, 70]
              : [80, 75, 3, 4];
        expect([...bytes.subarray(0, 4)]).toEqual(signature);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
  30000,
);
