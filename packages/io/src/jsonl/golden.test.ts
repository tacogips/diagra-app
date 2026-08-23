import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasErrors } from "@diagra/ir";
import { parseDocument, parseDocumentResult } from "./parse.ts";
import { serializeDocument } from "./serialize.ts";

const FIXTURES = join(import.meta.dir, "..", "__fixtures__");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.jsonl`), "utf8");
}

/**
 * Golden files are hand-authored canonical JSONL. Each one must (a) parse
 * without errors, (b) reserialize byte-for-byte, and (c) survive a second
 * parse unchanged. (b) is what pins the deterministic-output contract: a
 * change in key order, record order, or coordinate rounding fails here.
 */
const GOLDEN = [
  "erd",
  "uml-class",
  "sequence",
  "freeform",
  "forward-compat",
] as const;

describe("golden files", () => {
  for (const name of GOLDEN) {
    describe(name, () => {
      test("parses without errors", () => {
        const result = parseDocumentResult(readFixture(name));
        expect(result.ok).toBe(true);
        expect(hasErrors(result.issues)).toBe(false);
      });

      test("reserializes byte-for-byte", () => {
        const text = readFixture(name);
        expect(serializeDocument(parseDocument(text))).toBe(text);
      });

      test("round-trips to an identical document", () => {
        const document = parseDocument(readFixture(name));
        const reparsed = parseDocument(serializeDocument(document));
        expect(reparsed).toEqual(document);
      });
    });
  }
});

describe("canonicalization", () => {
  test("sorts records and keys and rounds coordinates", () => {
    const messy = parseDocument(readFixture("erd-unsorted"));
    expect(serializeDocument(messy)).toBe(readFixture("erd"));
  });

  test("readers keep file order; only writers sort", () => {
    // Design section 6: "Writers must sort; readers must not depend on
    // order." So the parsed document still reflects the file's own order,
    // and normalization is what makes the two fixtures converge.
    const messy = parseDocument(readFixture("erd-unsorted"));
    expect(messy.elements.map((element) => element.id)).toEqual([
      "t-users",
      "t-orders",
      "e-rel-1",
    ]);

    const normalized = parseDocument(serializeDocument(messy));
    expect(normalized).toEqual(parseDocument(readFixture("erd")));
  });
});

describe("golden file coverage", () => {
  test("covers every registered element type at least once", async () => {
    const { ELEMENT_TYPES } = await import("@diagra/ir");
    const seen = new Set<string>();
    for (const name of GOLDEN) {
      for (const element of parseDocument(readFixture(name)).elements) {
        seen.add(element.type);
      }
    }
    const missing = ELEMENT_TYPES.filter((type) => !seen.has(type));
    expect(missing).toEqual([]);
  });
});
