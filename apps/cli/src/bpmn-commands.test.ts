import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBpmnXml, parseDocumentResult } from "@nodetto/io";
import {
  EXIT_DRIFT,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_WARNINGS,
  type CommandIo,
  runCli,
} from "./commands.ts";

const fixtureRoot = join(
  import.meta.dir,
  "../../../packages/io/src/__fixtures__/bpmn",
);
const fixtureNames = [
  "purchase-request.bpmn",
  "purchase-request-draft.bpmn",
  "purchase-request-swapped.bpmn",
  "purchase-request-inverted.bpmn",
] as const;
const fixtures = Object.fromEntries(
  fixtureNames.map((name) => [
    name,
    readFileSync(join(fixtureRoot, name), "utf8"),
  ]),
);
const purchaseJsonl = readFileSync(
  join(fixtureRoot, "purchase-request.jsonl"),
  "utf8",
);

function memoryIo(initial: Record<string, string>): CommandIo & {
  readonly files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readText(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
    writeText(path, text) {
      files.set(path, text);
    },
    exists(path) {
      return files.has(path);
    },
  };
}

const cli = (args: readonly string[], io: CommandIo) =>
  runCli(args, io, "test");

test("lint reports the three draft findings and clean BPMN fixtures", () => {
  const io = memoryIo(fixtures);
  const draft = cli(["lint", "purchase-request-draft.bpmn"], io);
  expect(draft.exitCode).toBe(EXIT_DRIFT);
  expect(draft.stdout.match(/ {2}[^\n]+ {2}error {2}/g)).toHaveLength(3);
  expect(draft.stdout).toContain("Task_PlaceOrder");
  expect(draft.stdout).toContain("Event_OrderNoticeProcurement");
  expect(draft.stdout).toContain("label-required");
  expect(draft.stdout).toContain("no-implicit-end");
  expect(draft.stdout).toContain("no-implicit-start");
  expect(draft.stdout).toContain("3 problems (3 errors, 0 warnings)");
  for (const name of fixtureNames.filter(
    (item) => item !== "purchase-request-draft.bpmn",
  )) {
    const clean = cli(["lint", name], io);
    expect(clean.exitCode).toBe(EXIT_OK);
    expect(clean.stdout).toBe("");
  }
});

test("lint JSON always prints a report and config overrides recommended severities", () => {
  const config = JSON.stringify({
    extends: "bpmnlint:recommended",
    rules: {
      "label-required": "off",
      "no-implicit-end": "warn",
      "no-implicit-start": "warn",
    },
  });
  const io = memoryIo({ ...fixtures, "custom.json": config });
  const draft = cli(
    ["lint", "purchase-request-draft.bpmn", "--format", "json"],
    io,
  );
  const draftJson = JSON.parse(draft.stdout) as {
    summary: { problems: number; errors: number; warnings: number };
  };
  expect(draft.exitCode).toBe(EXIT_DRIFT);
  expect(draftJson.summary).toEqual({ problems: 3, errors: 3, warnings: 0 });
  const clean = cli(["lint", "purchase-request.bpmn", "--format", "json"], io);
  expect(clean.exitCode).toBe(EXIT_OK);
  expect(JSON.parse(clean.stdout).summary.problems).toBe(0);

  const overridden = cli(
    ["lint", "purchase-request-draft.bpmn", "--config", "custom.json"],
    io,
  );
  expect(overridden.exitCode).toBe(EXIT_OK);
  expect(overridden.stdout).toContain("2 warnings)");
  expect(overridden.stdout).not.toContain("label-required");
  const discovered = cli(
    ["lint", "purchase-request-draft.bpmn"],
    memoryIo({ ...fixtures, ".bpmnlintrc": config }),
  );
  expect(discovered.exitCode).toBe(EXIT_OK);
  const invalid = cli(
    ["lint", "purchase-request-draft.bpmn"],
    memoryIo({ ...fixtures, ".bpmnlintrc": "{" }),
  );
  expect(invalid.exitCode).toBe(EXIT_ERROR);
  expect(invalid.stderr).toContain("Lint configuration is not valid JSON.");
});

test("lint accepts imported JSONL and reports usage, page, and format errors", () => {
  const draftIo = memoryIo({
    "draft.bpmn": fixtures["purchase-request-draft.bpmn"],
  });
  const imported = cli(["bpmn", "import", "draft.bpmn"], draftIo);
  expect(imported.exitCode).toBe(EXIT_OK);
  const io = memoryIo({ "draft.jsonl": imported.stdout });
  const lint = cli(["lint", "draft.jsonl"], io);
  expect(lint.exitCode).toBe(EXIT_DRIFT);
  expect(lint.stdout).toContain("3 problems (3 errors, 0 warnings)");
  expect(cli(["lint", "draft.jsonl", "--format", "xml"], io).exitCode).toBe(
    EXIT_ERROR,
  );
  expect(cli(["lint", "draft.jsonl", "--page", "missing"], io).exitCode).toBe(
    EXIT_ERROR,
  );
  expect(
    cli(
      ["lint", "purchase-request.jsonl"],
      memoryIo({ "purchase-request.jsonl": purchaseJsonl }),
    ).exitCode,
  ).toBe(EXIT_OK);
});

test("bpmn import emits canonical JSONL and supports --output", () => {
  const io = memoryIo(fixtures);
  const imported = cli(["bpmn", "import", "purchase-request.bpmn"], io);
  expect(imported.exitCode).toBe(EXIT_OK);
  expect(parseDocumentResult(imported.stdout).ok).toBe(true);
  const written = cli(
    ["bpmn", "import", "purchase-request.bpmn", "--output", "out.jsonl"],
    io,
  );
  expect(written.exitCode).toBe(EXIT_OK);
  expect(parseDocumentResult(io.files.get("out.jsonl") ?? "").ok).toBe(true);
});

test("bpmn export round-trips and --check detects matching and stale XML", () => {
  const io = memoryIo({ "doc.jsonl": purchaseJsonl });
  const exported = cli(["bpmn", "export", "doc.jsonl"], io);
  expect(exported.exitCode).toBe(EXIT_OK);
  expect(exported.stdout).toContain("<bpmn:definitions");
  expect(importBpmnXml(exported.stdout).document.pages[0]?.kind).toBe("bpmn");
  const written = cli(
    ["bpmn", "export", "doc.jsonl", "--output", "written.bpmn"],
    io,
  );
  expect(written.exitCode).toBe(EXIT_OK);
  expect(io.files.get("written.bpmn")).toBe(exported.stdout);
  io.files.set("out.bpmn", exported.stdout);
  expect(
    cli(["bpmn", "export", "doc.jsonl", "--check", "out.bpmn"], io).exitCode,
  ).toBe(EXIT_OK);
  io.files.set("out.bpmn", `${exported.stdout}<!-- drift -->\n`);
  const stale = cli(["bpmn", "export", "doc.jsonl", "--check", "out.bpmn"], io);
  expect(stale.exitCode).toBe(EXIT_DRIFT);
  expect(stale.stderr).toContain("out.bpmn is out of date");
  expect(
    cli(
      [
        "bpmn",
        "export",
        "doc.jsonl",
        "--output",
        "out.bpmn",
        "--check",
        "out.bpmn",
      ],
      io,
    ).exitCode,
  ).toBe(EXIT_ERROR);
});

test("bpmn strict warnings and unknown subcommands use the documented exits", () => {
  const noDi =
    '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="p"><bpmn:startEvent id="start"/><bpmn:endEvent id="end"/></bpmn:process></bpmn:definitions>';
  const io = memoryIo({ "missing-di.bpmn": noDi });
  const strict = cli(["bpmn", "import", "missing-di.bpmn", "--strict"], io);
  expect(strict.exitCode).toBe(EXIT_WARNINGS);
  expect(strict.stderr).toContain("warning:");
  expect(cli(["bpmn"], io).exitCode).toBe(EXIT_ERROR);
  expect(cli(["bpmn", "frobnicate"], io).stderr).toContain("import or export");
});

test("help lists lint and bpmn and protected CLI command tests stay untouched", () => {
  const result = cli(["--help"], memoryIo({}));
  expect(result.stdout).toContain("nodetto-cli lint");
  expect(result.stdout).toContain("nodetto-cli bpmn import");
});
