import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, parseDocumentResult } from "./parse.ts";
import { serializeDocument } from "./serialize.ts";
import { hasErrors, type Document } from "@diagra/ir";

const FIXTURES = join(import.meta.dir, "..", "__fixtures__");

describe("BPMN JSONL compatibility", () => {
  test("existing fixture documents retain canonical round trips", () => {
    for (const name of readdirSync(FIXTURES).filter((file) =>
      file.endsWith(".jsonl"),
    )) {
      const text = readFileSync(join(FIXTURES, name), "utf8");
      const result = parseDocumentResult(text);
      expect(result.ok).toBe(true);
      expect(hasErrors(result.issues)).toBe(false);
      expect(
        result.issues.some((issue) => issue.code.startsWith("bpmn.")),
      ).toBe(false);
      const canonical = serializeDocument(parseDocument(text));
      expect(serializeDocument(parseDocument(canonical))).toBe(canonical);
    }
  });
  test("labelBounds survives as visual data and rounds coordinates", () => {
    const source: Document = {
      schemaVersion: 1,
      id: "doc",
      title: "BPMN",
      pages: [{ id: "p", name: "BPMN", kind: "bpmn" }],
      elements: [
        {
          id: "t",
          page: "p",
          type: "bpmn.task",
          index: "a1",
          semantic: { taskType: "none", loop: "none" },
          visual: {
            x: 0,
            y: 0,
            width: 100,
            height: 80,
            labelBounds: {
              x: 10.123456,
              y: 11.123456,
              width: 30.123456,
              height: 12.123456,
            },
          },
        },
      ],
    };
    const text = serializeDocument(source);
    const roundTrip = serializeDocument(parseDocument(text));
    expect(roundTrip).toBe(text);
    const parsed = parseDocument(text).elements[0];
    expect(parsed?.visual.labelBounds).toEqual({
      x: 10.12,
      y: 11.12,
      width: 30.12,
      height: 12.12,
    });
    expect(parsed?.visual.extensions).toBeUndefined();
  });
});
