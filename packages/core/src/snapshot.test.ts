import { describe, expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { type Document, hasErrors, validateDocument } from "@diagra/ir";
import { Store } from "./store.ts";
import {
  document,
  element,
  erdFixture,
  makeEditor,
  TEST_PAGE,
} from "./test-helpers.ts";

function seededEditor() {
  const editor = makeEditor({ document: document(erdFixture()) });
  editor.createElement("uml.class", {
    visual: { x: 0, y: 200 },
    semantic: {
      name: "Order",
      stereotype: "entity",
      attributes: [
        { id: "a1", name: "total", type: "number", visibility: "-" },
      ],
      methods: [{ id: "m1", name: "submit", returnType: "void" }],
    },
  });
  editor.createElement("shape.geo", {
    visual: { x: 500, y: 400, width: 120, height: 80 },
    semantic: { geo: "ellipse", label: "note" },
  });
  const first = editor.createElement("node.generic", {
    visual: { x: 0, y: 500 },
    semantic: { label: "A" },
  });
  const second = editor.createElement("node.generic", {
    visual: { x: 300, y: 500 },
    semantic: { label: "B" },
  });
  editor.connect(first, second);
  return editor;
}

describe("getSnapshot", () => {
  test("validates against the IR with no issues at all", () => {
    const snapshot = seededEditor().getSnapshot();
    const issues = validateDocument(snapshot);
    expect(issues).toEqual([]);
  });

  test("is byte-stable through a serialize/parse round trip", () => {
    const snapshot = seededEditor().getSnapshot();
    const first = serializeDocument(snapshot);
    const second = serializeDocument(parseDocument(first));
    expect(second).toBe(first);
    expect(serializeDocument(parseDocument(second))).toBe(first);
  });

  test("orders elements by page then id regardless of insertion order", () => {
    const store = new Store({
      schemaVersion: 1,
      id: "doc",
      title: "t",
      pages: [
        { id: "p2", name: "Two", kind: "freeform" },
        { id: "p1", name: "One", kind: "erd" },
      ],
      elements: [
        element({
          id: "z",
          type: "node.generic",
          semantic: { label: "z" },
          page: "p2",
        }),
        element({
          id: "a",
          type: "node.generic",
          semantic: { label: "a" },
          page: "p2",
        }),
        element({
          id: "m",
          type: "node.generic",
          semantic: { label: "m" },
          page: "p1",
        }),
      ],
    });
    const snapshot = store.getSnapshot();
    expect(snapshot.pages.map((page) => page.id)).toEqual(["p1", "p2"]);
    expect(snapshot.elements.map((el) => el.id)).toEqual(["m", "a", "z"]);
  });

  test("two snapshots of the same state serialize identically", () => {
    const editor = seededEditor();
    expect(serializeDocument(editor.getSnapshot())).toBe(
      serializeDocument(editor.getSnapshot()),
    );
  });
});

describe("forward compatibility", () => {
  const forwardCompatible: Document = {
    schemaVersion: 1,
    id: "doc-fc",
    title: "Forward",
    pages: [TEST_PAGE],
    elements: [
      element({
        id: "future",
        type: "future.widget",
        semantic: { shape: "spiral" },
        visual: { x: 10, y: 10 },
      }),
    ],
    unknownRecords: [
      { kind: "annotationLayer", data: { kind: "annotationLayer", id: "l1" } },
    ],
    extensions: { writtenBy: "a newer build" },
  };

  test("carries unknown records and extensions through load and snapshot", () => {
    const editor = makeEditor({ document: forwardCompatible });
    const snapshot = editor.getSnapshot();
    expect(snapshot.unknownRecords).toEqual(forwardCompatible.unknownRecords);
    expect(snapshot.extensions).toEqual(forwardCompatible.extensions);
  });

  test("keeps carrying them after an edit", () => {
    const editor = makeEditor({ document: forwardCompatible });
    editor.apply([{ type: "updateVisual", id: "future", visual: { x: 42 } }]);
    const snapshot = editor.getSnapshot();
    expect(snapshot.unknownRecords).toEqual(forwardCompatible.unknownRecords);
    expect(snapshot.extensions).toEqual(forwardCompatible.extensions);
    expect(snapshot.elements[0]?.visual).toEqual({ x: 42, y: 10 });
  });

  test("an unknown element type is a warning, not an error", () => {
    const editor = makeEditor({ document: forwardCompatible });
    const issues = validateDocument(editor.getSnapshot());
    expect(hasErrors(issues)).toBe(false);
    expect(issues.some((issue) => issue.code === "type.unknown")).toBe(true);
  });

  test("round-trips a document containing an unknown type", () => {
    const editor = makeEditor({ document: forwardCompatible });
    const text = serializeDocument(editor.getSnapshot());
    expect(serializeDocument(parseDocument(text))).toBe(text);
  });
});
