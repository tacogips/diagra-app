import { describe, expect, test } from "bun:test";
import { hasErrors, type ValidationIssue } from "./issues.ts";
import {
  ELEMENT_TYPES,
  getElementTypeDefinition,
  isKnownElementType,
  listElementTypeDefinitions,
} from "./registry.ts";

/** The v1 registry, verbatim from product design section 5.2. */
const DESIGN_TABLE_TYPES: readonly string[] = [
  "node.generic",
  "edge.generic",
  "erd.table",
  "erd.relation",
  "uml.class",
  "uml.association",
  "sequence.participant",
  "sequence.message",
  "sequence.activation",
  "draw.freehand",
  "shape.geo",
  "text.note",
  "frame",
  "group",
];

function codes(issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function validate(type: string, semantic: unknown): readonly ValidationIssue[] {
  const definition = getElementTypeDefinition(type);
  if (!definition) {
    throw new Error(`unregistered type ${type}`);
  }
  return definition.validateSemantic(semantic, "semantic");
}

function expectValid(type: string, semantic: unknown): void {
  const issues = validate(type, semantic);
  expect({ type, issues }).toEqual({ type, issues: [] });
}

describe("registry contents", () => {
  test("registers exactly the v1 design table", () => {
    expect(Array.from<string>(ELEMENT_TYPES).sort()).toEqual(
      [...DESIGN_TABLE_TYPES].sort(),
    );
  });

  test("has no duplicate entries", () => {
    expect(new Set(ELEMENT_TYPES).size).toBe(ELEMENT_TYPES.length);
  });

  test("every definition declares a key order covering its own fields", () => {
    for (const definition of listElementTypeDefinitions()) {
      expect(definition.keyOrder.keys.length).toBeGreaterThan(0);
      const declared = new Set(definition.keyOrder.keys);
      for (const child of Object.keys(definition.keyOrder.children ?? {})) {
        expect(declared.has(child)).toBe(true);
      }
    }
  });

  test("isKnownElementType tracks the registry", () => {
    expect(isKnownElementType("erd.table")).toBe(true);
    expect(isKnownElementType("vendor.future")).toBe(false);
    expect(getElementTypeDefinition("vendor.future")).toBeUndefined();
  });

  test("edges cascade and containers detach on a deleted reference", () => {
    expect(getElementTypeDefinition("erd.relation")?.onReferenceDeleted).toBe(
      "cascade",
    );
    expect(getElementTypeDefinition("edge.generic")?.onReferenceDeleted).toBe(
      "cascade",
    );
    expect(getElementTypeDefinition("group")?.onReferenceDeleted).toBe(
      "detach",
    );
  });
});

describe("semantic validation", () => {
  test("accepts the design's example payloads", () => {
    expectValid("node.generic", { label: "" });
    expectValid("edge.generic", { from: "a", to: "b" });
    expectValid("erd.table", {
      tableName: "users",
      columns: [{ id: "c1", name: "id", dataType: "uuid", pk: true }],
    });
    expectValid("erd.relation", {
      from: { table: "users", column: "c1" },
      to: { table: "orders", column: "c9" },
      cardinality: "1:*",
    });
    expectValid("uml.class", {
      name: "Invoice",
      attributes: [],
      methods: [],
    });
    expectValid("uml.association", { from: "a", to: "b", kind: "inherit" });
    expectValid("sequence.participant", {
      name: "API",
      kind: "service",
      order: "a1",
    });
    expectValid("sequence.message", {
      from: "a",
      to: "b",
      order: "a1",
      kind: "sync",
    });
    expectValid("sequence.activation", {
      participant: "a",
      fromOrder: "a1",
      toOrder: "a2",
    });
    expectValid("draw.freehand", { points: [{ x: 0, y: 0 }] });
    expectValid("shape.geo", { geo: "rect" });
    expectValid("text.note", { text: "hi" });
    expectValid("frame", { name: "Group A" });
    expectValid("group", { memberIds: ["a", "b"] });
  });

  test("tolerates unknown fields inside a known payload", () => {
    expectValid("shape.geo", { geo: "rect", futureField: { a: 1 } });
  });

  test("rejects a non-object payload", () => {
    expect(codes(validate("shape.geo", "rect"))).toEqual(["type.object"]);
    expect(codes(validate("shape.geo", null))).toEqual(["type.object"]);
  });

  test("rejects a missing required field", () => {
    expect(codes(validate("erd.table", { columns: [] }))).toEqual([
      "field.missing",
    ]);
  });

  test("rejects a value outside an enum", () => {
    expect(codes(validate("shape.geo", { geo: "octagon" }))).toEqual([
      "value.enum",
    ]);
    expect(
      codes(
        validate("erd.relation", {
          from: { table: "a" },
          to: { table: "b" },
          cardinality: "many-to-many",
        }),
      ),
    ).toEqual(["value.enum"]);
  });

  test("rejects duplicate column ids in a table", () => {
    const issues = validate("erd.table", {
      tableName: "t",
      columns: [
        { id: "c1", name: "a", dataType: "int" },
        { id: "c1", name: "b", dataType: "int" },
      ],
    });
    expect(codes(issues)).toEqual(["id.duplicate"]);
    expect(issues[0]?.path).toBe("semantic.columns[1].id");
  });

  test("rejects wrong field types with a precise path", () => {
    const issues = validate("erd.table", {
      tableName: "t",
      columns: [{ id: "c1", name: 7, dataType: "int" }],
    });
    expect(issues[0]?.path).toBe("semantic.columns[0].name");
    expect(issues[0]?.code).toBe("type.string");
  });

  test("validates nested uml method parameters", () => {
    const issues = validate("uml.class", {
      name: "C",
      attributes: [],
      methods: [{ id: "m", name: "f", parameters: [{ type: "int" }] }],
    });
    expect(issues[0]?.path).toBe("semantic.methods[0].parameters[0].name");
  });

  test("rejects a text mark reaching past the end of the text", () => {
    expect(
      codes(
        validate("text.note", {
          text: "abc",
          marks: [{ start: 0, end: 9, kind: "bold" }],
        }),
      ),
    ).toEqual(["range.overflow"]);
  });

  test("rejects an inverted text mark range", () => {
    expect(
      codes(
        validate("text.note", {
          text: "abcdef",
          marks: [{ start: 4, end: 1, kind: "bold" }],
        }),
      ),
    ).toEqual(["range.inverted"]);
  });

  test("rejects non-finite freehand coordinates", () => {
    expect(
      hasErrors(
        validate("draw.freehand", {
          points: [{ x: Number.NaN, y: 0 }],
        }),
      ),
    ).toBe(true);
  });
});

describe("references", () => {
  function refs(type: string, semantic: unknown): unknown {
    return getElementTypeDefinition(type)?.references(semantic);
  }

  test("edges report both endpoints", () => {
    expect(refs("edge.generic", { from: "a", to: "b" })).toEqual([
      { field: "from", id: "a" },
      { field: "to", id: "b" },
    ]);
  });

  test("erd relations report the table, not the column", () => {
    expect(
      refs("erd.relation", {
        from: { table: "t1", column: "c1" },
        to: { table: "t2", column: "c2" },
      }),
    ).toEqual([
      { field: "from.table", id: "t1" },
      { field: "to.table", id: "t2" },
    ]);
  });

  test("groups report each member with its index", () => {
    expect(refs("group", { memberIds: ["a", "b"] })).toEqual([
      { field: "memberIds[0]", id: "a" },
      { field: "memberIds[1]", id: "b" },
    ]);
  });

  test("sequence activations point at their participant", () => {
    expect(refs("sequence.activation", { participant: "p1" })).toEqual([
      { field: "participant", id: "p1" },
    ]);
  });

  test("nodes have no outgoing references", () => {
    expect(refs("erd.table", { tableName: "t", columns: [] })).toEqual([]);
    expect(refs("shape.geo", { geo: "rect" })).toEqual([]);
  });

  test("survives malformed payloads without throwing", () => {
    expect(refs("edge.generic", null)).toEqual([]);
    expect(refs("edge.generic", { from: 42 })).toEqual([]);
    expect(refs("group", { memberIds: "not-an-array" })).toEqual([]);
    expect(refs("erd.relation", { from: "not-an-object" })).toEqual([]);
  });
});
