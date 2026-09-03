// DOM-free tests of the payload edits the Inspector's row editors apply.
//
// The one promise every edit makes is that item ids survive: a rename, a
// reorder or a flag flip must never look like a delete plus an insert.

import { describe, expect, test } from "bun:test";
import type { ErdTableSemantic, UmlClassSemantic } from "@diagra/ir";
import {
  addErdColumn,
  addUmlAttribute,
  addUmlMethod,
  moveErdColumn,
  moveItem,
  moveUmlAttribute,
  moveUmlMethod,
  parseNumber,
  parseParameters,
  readErdRelation,
  readErdTable,
  readUmlClass,
  removeErdColumn,
  removeUmlAttribute,
  removeUmlMethod,
  serializeParameters,
  setErdEndpointColumn,
  updateErdColumn,
  updateUmlAttribute,
  updateUmlMethod,
  withOptionalFlag,
  withOptionalString,
} from "./edits.ts";

const table: ErdTableSemantic = {
  tableName: "users",
  columns: [
    { id: "c1", name: "id", dataType: "uuid", pk: true },
    { id: "c2", name: "email", dataType: "text" },
    { id: "c3", name: "age", dataType: "int", nullable: true },
  ],
};

const klass: UmlClassSemantic = {
  name: "Repo",
  attributes: [
    { id: "a1", name: "size", type: "int", static: true },
    { id: "a2", name: "items" },
  ],
  methods: [
    {
      id: "m1",
      name: "find",
      parameters: [{ name: "id", type: "string" }],
      returnType: "Row",
    },
    { id: "m2", name: "clear" },
  ],
};

const ids = (items: readonly { readonly id: string }[]): string[] =>
  items.map((item) => item.id);

describe("moveItem", () => {
  test("moves an element up and down", () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
  });

  test("returns the same list for a move out of range", () => {
    const items = [1, 2, 3];
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(moveItem(items, 2, 3)).toBe(items);
    expect(moveItem(items, 1, 1)).toBe(items);
  });
});

describe("optional fields", () => {
  test("an empty string drops the key instead of storing it", () => {
    expect<unknown>(
      withOptionalString({ a: 1, label: "x" }, "label", ""),
    ).toEqual({ a: 1 });
    expect<unknown>(withOptionalString({ a: 1 }, "label", "y")).toEqual({
      a: 1,
      label: "y",
    });
  });

  test("a false flag drops the key instead of storing false", () => {
    expect<unknown>(withOptionalFlag({ pk: true }, "pk", false)).toEqual({});
    expect<unknown>(withOptionalFlag({}, "pk", true)).toEqual({ pk: true });
  });

  test("parseNumber accepts finite numbers only", () => {
    expect(parseNumber(" 12.5 ")).toBe(12.5);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("Infinity")).toBeNull();
  });
});

describe("erd table edits", () => {
  test("adding a column appends it with the given id", () => {
    const next = addErdColumn(table, "c4");
    expect(ids(next.columns)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(next.columns[3]).toEqual({
      id: "c4",
      name: "column_4",
      dataType: "text",
    });
    expect(table.columns).toHaveLength(3);
  });

  test("removing a column keeps the others in order", () => {
    expect(ids(removeErdColumn(table, "c2").columns)).toEqual(["c1", "c3"]);
    expect(removeErdColumn(table, "missing")).toEqual(table);
  });

  test("moving a column shifts it by the delta and clamps at the ends", () => {
    expect(ids(moveErdColumn(table, "c3", -1).columns)).toEqual([
      "c1",
      "c3",
      "c2",
    ]);
    expect(ids(moveErdColumn(table, "c1", -1).columns)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    expect(moveErdColumn(table, "missing", 1)).toBe(table);
  });

  test("a rename keeps the id and the other fields", () => {
    const next = updateErdColumn(table, "c1", { name: "user_id" });
    expect(next.columns[0]).toEqual({
      id: "c1",
      name: "user_id",
      dataType: "uuid",
      pk: true,
    });
    expect(next.columns[1]).toBe(table.columns[1] as never);
  });

  test("flags are stored as true or dropped, never false", () => {
    const on = updateErdColumn(table, "c2", { pk: true, nullable: true });
    expect(on.columns[1]).toEqual({
      id: "c2",
      name: "email",
      dataType: "text",
      pk: true,
      nullable: true,
    });
    const off = updateErdColumn(on, "c2", { pk: false, nullable: false });
    expect(off.columns[1]).toEqual({
      id: "c2",
      name: "email",
      dataType: "text",
    });
  });

  test("readErdTable tolerates a malformed payload", () => {
    expect(readErdTable(null)).toEqual({ tableName: "", columns: [] });
    expect(readErdTable({ tableName: "t", columns: "nope" })).toEqual({
      tableName: "t",
      columns: [],
    });
  });
});

describe("erd relation edits", () => {
  test("an endpoint can point at a column or at the whole table", () => {
    const relation = readErdRelation({
      from: { table: "users" },
      to: { table: "orders", column: "c2" },
      cardinality: "1:*",
    });
    const anchored = setErdEndpointColumn(relation, "from", "c1");
    expect(anchored.from).toEqual({ table: "users", column: "c1" });
    const cleared = setErdEndpointColumn(anchored, "to", "");
    expect(cleared.to).toEqual({ table: "orders" });
    expect(cleared.cardinality).toBe("1:*");
  });

  test("readErdRelation falls back to a valid cardinality", () => {
    expect(readErdRelation({ from: { table: "a" }, to: {} }).cardinality).toBe(
      "1:*",
    );
  });
});

describe("uml class edits", () => {
  test("attributes add, remove and move with stable ids", () => {
    const added = addUmlAttribute(klass, "a3");
    expect(ids(added.attributes)).toEqual(["a1", "a2", "a3"]);
    expect(added.attributes[2]).toEqual({ id: "a3", name: "attribute3" });
    expect(ids(removeUmlAttribute(klass, "a1").attributes)).toEqual(["a2"]);
    expect(ids(moveUmlAttribute(klass, "a2", -1).attributes)).toEqual([
      "a2",
      "a1",
    ]);
    expect(klass.methods).toBe(moveUmlAttribute(klass, "a2", -1).methods);
  });

  test("attribute fields update one at a time", () => {
    const typed = updateUmlAttribute(klass, "a2", {
      type: "Item[]",
      visibility: "-",
    });
    expect(typed.attributes[1]).toEqual({
      id: "a2",
      name: "items",
      type: "Item[]",
      visibility: "-",
    });
    const cleared = updateUmlAttribute(typed, "a2", { type: "", static: true });
    expect(cleared.attributes[1]).toEqual({
      id: "a2",
      name: "items",
      visibility: "-",
      static: true,
    });
    expect(
      updateUmlAttribute(klass, "a1", { static: false }).attributes[0],
    ).toEqual({ id: "a1", name: "size", type: "int" });
  });

  test("methods add, remove and move with stable ids", () => {
    const added = addUmlMethod(klass, "m3");
    expect(ids(added.methods)).toEqual(["m1", "m2", "m3"]);
    expect(ids(removeUmlMethod(klass, "m2").methods)).toEqual(["m1"]);
    expect(ids(moveUmlMethod(klass, "m1", 1).methods)).toEqual(["m2", "m1"]);
    expect(moveUmlMethod(klass, "m2", 1)).toBe(klass);
  });

  test("method fields update, and empty parameters drop the key", () => {
    const next = updateUmlMethod(klass, "m2", {
      parameters: [{ name: "n", type: "int" }],
      returnType: "void",
      visibility: "#",
      abstract: true,
    });
    expect(next.methods[1]).toEqual({
      id: "m2",
      name: "clear",
      parameters: [{ name: "n", type: "int" }],
      returnType: "void",
      visibility: "#",
      abstract: true,
    });
    const emptied = updateUmlMethod(next, "m2", {
      parameters: [],
      returnType: "",
      abstract: false,
    });
    expect(emptied.methods[1]).toEqual({
      id: "m2",
      name: "clear",
      visibility: "#",
    });
  });

  test("readUmlClass tolerates a malformed payload", () => {
    expect(readUmlClass({ name: 3 })).toEqual({
      name: "",
      attributes: [],
      methods: [],
    });
  });
});

describe("parameters text", () => {
  test("parses names and optional types", () => {
    expect(parseParameters("a: T, b:U,c")).toEqual([
      { name: "a", type: "T" },
      { name: "b", type: "U" },
      { name: "c" },
    ]);
  });

  test("keeps commas inside generics with the parameter", () => {
    expect(parseParameters("map: Map<string, number>, n: int")).toEqual([
      { name: "map", type: "Map<string, number>" },
      { name: "n", type: "int" },
    ]);
  });

  test("drops empty entries and blank names", () => {
    expect(parseParameters("")).toEqual([]);
    expect(parseParameters(" , : T, ")).toEqual([]);
  });

  test("serializes back to the same text", () => {
    const text = "a: T, b: U, c";
    expect(serializeParameters(parseParameters(text))).toBe(text);
    expect(serializeParameters(undefined)).toBe("");
  });
});
