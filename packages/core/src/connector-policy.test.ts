import { expect, test } from "bun:test";
import {
  connectorEndpointIssues,
  validateDocument,
  type Element,
} from "@nodetto/ir";
import { Editor } from "./editor.ts";

test("typed connectors reject wrong endpoint types atomically through command writes", () => {
  for (const [connector, endpoint] of [
    ["erd.relation", "erd.table"],
    ["uml.association", "uml.class"],
    ["sequence.message", "sequence.participant"],
    ["uml.component-relationship", "uml.component"],
  ]) {
    const editor = new Editor();
    const from = editor.createElement(endpoint as string);
    const to = editor.createElement(endpoint as string);
    const note = editor.createElement("text.note");
    const id = editor.connectSmart(from, to);
    expect(id).not.toBeNull();
    const relation = editor.store.get(id as string) as Element;
    expect(relation.type).toBe(connector);
    const before = editor.getSnapshot();
    const semantic = {
      ...(relation.semantic as object),
      to: connector === "erd.relation" ? { table: note } : note,
    };
    expect(() =>
      editor.apply([{ type: "updateSemantic", id: relation.id, semantic }]),
    ).toThrow("Invalid connector endpoints");
    expect(editor.getSnapshot()).toEqual(before);
    expect(() => editor.createElement(connector, { semantic })).toThrow(
      "Invalid connector endpoints",
    );
    expect(editor.getSnapshot()).toEqual(before);
  }
});

test("forward references in valid batches work and column-free foreign keys remain drafts", () => {
  const editor = new Editor();
  const a = editor.buildElement("erd.table");
  const b = editor.buildElement("erd.table");
  const fk = editor.buildElement("erd.relation", {
    semantic: {
      from: { table: a.id },
      to: { table: b.id },
      cardinality: "1:*",
    },
  });
  editor.apply([
    { type: "createElement", element: fk },
    { type: "createElement", element: a },
    { type: "createElement", element: b },
  ]);
  expect(editor.store.get(fk.id)).toBeDefined();
});

test("legacy wrong-type connections load with warnings and can be repaired", () => {
  const editor = new Editor();
  const from = editor.createElement("erd.table");
  const to = editor.createElement("erd.table");
  const note = editor.createElement("text.note");
  const id = editor.connectSmart(from, to) as string;
  const doc = editor.getSnapshot();
  const broken = {
    ...doc,
    elements: doc.elements.map((element) =>
      element.id === id
        ? {
            ...element,
            semantic: { ...(element.semantic as object), to: { table: note } },
          }
        : element,
    ),
  };
  expect(
    validateDocument(broken)
      .filter((issue) => issue.code === "connector.endpointType")
      .map((issue) => issue.severity),
  ).toEqual(["warning"]);
  const restored = new Editor({ document: broken });
  restored.apply([
    { type: "updateSemantic", id, semantic: editor.store.get(id)?.semantic },
  ]);
  expect(
    validateDocument(restored.getSnapshot()).filter(
      (issue) => issue.code === "connector.endpointType",
    ),
  ).toEqual([]);
});

test("policy limits typed links to one page and leaves generic connectors unrestricted", () => {
  const targets = new Map([
    ["a", { type: "erd.table", page: "p1" }],
    ["b", { type: "erd.table", page: "p2" }],
  ]);
  expect(
    connectorEndpointIssues(
      "erd.relation",
      { from: { table: "a" }, to: { table: "b" } },
      "p1",
      (id) => targets.get(id),
    )[0]?.code,
  ).toBe("connector.endpointPage");
  expect(
    connectorEndpointIssues(
      "edge.generic",
      { from: "a", to: "b" },
      "p1",
      (id) => targets.get(id),
    ),
  ).toEqual([]);
  expect(
    connectorEndpointIssues("toString", {}, "p1", () => undefined),
  ).toEqual([]);
});
