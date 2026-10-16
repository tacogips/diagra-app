import { expect, test } from "bun:test";
import type { Document, Element } from "@nodetto/ir";
import {
  diffDocuments,
  isEmptyCommit,
  mergeDocuments,
} from "./document-merge.ts";

function element(id: string, label: string, x = 0): Element {
  return {
    id,
    page: "p1",
    type: "node.generic",
    index: "a0",
    semantic: { label },
    visual: { x, y: 0 },
  };
}

function doc(elements: readonly Element[], title = "Doc"): Document {
  return {
    schemaVersion: 1,
    id: "d1",
    title,
    pages: [{ id: "p1", name: "Page", kind: "freeform" }],
    elements,
  };
}

test("disjoint additions on both sides are kept", () => {
  const base = doc([element("a", "A")]);
  const result = mergeDocuments(
    base,
    doc([element("a", "A"), element("local", "L")]),
    doc([element("a", "A"), element("remote", "R")]),
  );
  expect(result.conflicts).toEqual([]);
  expect(result.document.elements.map((e) => e.id).sort()).toEqual([
    "a",
    "local",
    "remote",
  ]);
});

test("different fields of one element merge; the same field keeps local and conflicts", () => {
  const base = doc([element("a", "A", 0)]);
  const moved = mergeDocuments(
    base,
    doc([element("a", "A", 50)]),
    doc([element("a", "Renamed", 0)]),
  );
  expect(moved.conflicts).toEqual([]);
  expect(moved.document.elements[0]).toMatchObject({
    semantic: { label: "Renamed" },
    visual: { x: 50 },
  });

  const both = mergeDocuments(
    base,
    doc([element("a", "Mine")]),
    doc([element("a", "Theirs")]),
  );
  expect(both.conflicts).toEqual([
    { id: "a", kind: "element", reason: "both-changed" },
  ]);
  expect(both.document.elements[0]?.semantic).toEqual({ label: "Mine" });
});

test("deletes: an untouched element follows the delete, an edited one survives with a conflict", () => {
  const base = doc([element("a", "A"), element("b", "B")]);
  const result = mergeDocuments(
    base,
    doc([element("a", "A"), element("b", "B edited")]),
    doc([]),
  );
  expect(result.document.elements.map((e) => e.id)).toEqual(["b"]);
  expect(result.conflicts).toEqual([
    { id: "b", kind: "element", reason: "deleted-remotely" },
  ]);
});

test("diffDocuments expresses element and page changes, and refuses metadata changes", () => {
  const current = doc([element("a", "A"), element("b", "B")]);
  const target = doc([element("a", "A2"), element("c", "C")]);
  const commit = diffDocuments(current, target);
  expect(commit?.update?.map((e) => e.id)).toEqual(["a"]);
  expect(commit?.insert?.map((e) => e.id)).toEqual(["c"]);
  expect(commit?.remove).toEqual(["b"]);
  expect(isEmptyCommit(diffDocuments(current, current) ?? {})).toBe(true);
  expect(diffDocuments(current, doc([], "Renamed"))).toBeNull();
});
