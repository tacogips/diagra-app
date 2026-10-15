import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { parseDocument, parseDocumentResult } from "@nodetto/io";
import { ELEMENT_TYPES, hasErrors } from "@nodetto/ir";
import {
  BPMN_LINT_RULE_IDS,
  lintBpmnPage,
  recommendedLintConfig,
} from "./lint/index.ts";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const readText = (path: string): string =>
  readFileSync(resolve(repositoryRoot, path), "utf8");

test("BPMN documentation example parses without errors", () => {
  const parsed = parseDocumentResult(
    readText("docs/bpmn/purchase-request.jsonl"),
  );
  expect(parsed.ok).toBe(true);
  expect(hasErrors(parsed.issues)).toBe(false);
});

test("BPMN documentation example matches the canonical io fixture bytes", () => {
  const example = readFileSync(
    resolve(repositoryRoot, "docs/bpmn/purchase-request.jsonl"),
  );
  const fixture = readFileSync(
    resolve(
      repositoryRoot,
      "packages/io/src/__fixtures__/bpmn/purchase-request.jsonl",
    ),
  );
  expect(example.equals(fixture)).toBe(true);
});

test("BPMN documentation example has no recommended lint findings", () => {
  const document = parseDocument(readText("docs/bpmn/purchase-request.jsonl"));
  const pages = document.pages.filter((page) => page.kind === "bpmn");
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) {
    expect(lintBpmnPage(document, page.id, recommendedLintConfig())).toEqual(
      [],
    );
  }
});

test("BPMN lint documentation lists each rule exactly once", () => {
  const lintRules = readText("docs/bpmn/lint-rules.md");
  const rows = [...lintRules.matchAll(/^\| `([a-z-]+)` \|/gm)].map(
    (match) => match[1],
  );
  expect(rows).toHaveLength(BPMN_LINT_RULE_IDS.length);
  expect(new Set(rows).size).toBe(rows.length);
  expect(new Set(rows)).toEqual(new Set(BPMN_LINT_RULE_IDS));
});

test("BPMN format documentation names every registered type", () => {
  const format = readText("docs/bpmn/format.md");
  const bpmnTypes = ELEMENT_TYPES.filter((type) => type.startsWith("bpmn."));
  expect(bpmnTypes).toHaveLength(16);
  for (const type of bpmnTypes) expect(format).toContain(`\`${type}\``);
});

test("BPMN documentation is ASCII only", () => {
  for (const path of [
    "docs/bpmn/format.md",
    "docs/bpmn/lint-rules.md",
    "docs/bpmn/ai-review-rules.md",
  ]) {
    expect(
      [...readText(path)].every((character) => character.charCodeAt(0) <= 0x7f),
    ).toBe(true);
  }
});

test("README documents BPMN lint and export commands", () => {
  const readme = readText("README.md");
  expect(readme).toContain("nodetto-cli lint");
  expect(readme).toContain("nodetto-cli bpmn export");
});
