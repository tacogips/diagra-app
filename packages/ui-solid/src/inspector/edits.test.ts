// DOM-free tests of the payload edits the Inspector's row editors apply.
//
// The one promise every edit makes is that item ids survive: a rename, a
// reorder or a flag flip must never look like a delete plus an insert.

import { describe, expect, test } from "bun:test";
import type { ErdTableSemantic, UmlClassSemantic } from "@diagra/ir";
import {
  addErdColumnPair,
  addErdColumn,
  addErdCheck,
  addErdIndex,
  addUmlAttribute,
  addUmlMethod,
  moveErdColumn,
  moveErdColumnPair,
  moveItem,
  moveUmlAttribute,
  moveUmlMethod,
  parseNumber,
  parseParameters,
  readErdRelation,
  readErdColumnPairs,
  readErdTable,
  readUmlClass,
  removeErdColumn,
  removeErdColumnPair,
  removeErdCheck,
  removeErdIndex,
  removeUmlAttribute,
  removeUmlMethod,
  serializeParameters,
  setErdDeferrability,
  setErdEndpointColumn,
  setErdColumnPair,
  setErdReferentialAction,
  updateErdColumn,
  updateErdCheck,
  updateErdIndex,
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

  test("database defaults and indexes retain stable ids and column references", () => {
    const withDefault = updateErdColumn(table, "c2", {
      defaultExpression: "'unknown'",
    });
    expect(withDefault.columns[1]?.defaultExpression).toBe("'unknown'");
    expect(
      updateErdColumn(withDefault, "c2", { defaultExpression: "" }).columns[1]
        ?.defaultExpression,
    ).toBeUndefined();

    const added = addErdIndex(table, "i1");
    expect(added.indexes).toEqual([{ id: "i1", columns: ["c1"] }]);
    const composite = updateErdIndex(added, "i1", {
      name: "users_email_age",
      columns: ["c2", "c3", "c2", "missing"],
      unique: true,
    });
    expect(composite.indexes).toEqual([
      {
        id: "i1",
        name: "users_email_age",
        columns: ["c2", "c3"],
        unique: true,
      },
    ]);
    expect(removeErdColumn(composite, "c2").indexes?.[0]?.columns).toEqual([
      "c3",
    ]);
    expect(removeErdIndex(composite, "i1").indexes).toBeUndefined();
    expect(removeErdIndex(table, "missing")).toBe(table);
  });

  test("generated and default expressions stay mutually exclusive", () => {
    const generated = updateErdColumn(table, "c2", {
      generatedExpression: "lower(email)",
    });
    expect(generated.columns[1]).toEqual({
      id: "c2",
      name: "email",
      dataType: "text",
      generatedExpression: "lower(email)",
    });
    const defaulted = updateErdColumn(generated, "c2", {
      defaultExpression: "'unknown'",
    });
    expect(defaulted.columns[1]?.generatedExpression).toBeUndefined();
    expect(defaulted.columns[1]?.defaultExpression).toBe("'unknown'");
    const regenerated = updateErdColumn(defaulted, "c2", {
      generatedExpression: "lower(email)",
    });
    expect(regenerated.columns[1]?.defaultExpression).toBeUndefined();
    const primary = updateErdColumn(regenerated, "c2", { pk: true });
    expect(primary.columns[1]?.generatedExpression).toBeUndefined();
    expect(primary.columns[1]?.pk).toBe(true);
    expect(
      updateErdColumn(regenerated, "c2", { generatedExpression: "" }).columns[1]
        ?.generatedExpression,
    ).toBeUndefined();
  });

  test("database checks retain stable ids and omit cleared optional names", () => {
    const added = addErdCheck(table, "ck1");
    expect(added.checks).toEqual([{ id: "ck1", expression: "1 = 1" }]);
    const edited = updateErdCheck(added, "ck1", {
      name: "age_nonnegative",
      expression: "age >= 0",
    });
    expect(edited.checks).toEqual([
      { id: "ck1", name: "age_nonnegative", expression: "age >= 0" },
    ]);
    expect(updateErdCheck(edited, "ck1", { name: "" }).checks).toEqual([
      { id: "ck1", expression: "age >= 0" },
    ]);
    expect(removeErdCheck(edited, "ck1").checks).toBeUndefined();
    expect(removeErdCheck(table, "missing")).toBe(table);
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

  test("referential actions store intent and omit the portable default", () => {
    const relation = readErdRelation({
      from: { table: "orders", column: "user_id" },
      to: { table: "users", column: "id" },
      cardinality: "*:1",
    });
    const cascading = setErdReferentialAction(
      setErdReferentialAction(relation, "onDelete", "cascade"),
      "onUpdate",
      "restrict",
    );
    expect(cascading).toMatchObject({
      onDelete: "cascade",
      onUpdate: "restrict",
    });
    expect(
      setErdReferentialAction(cascading, "onDelete", "no-action"),
    ).not.toHaveProperty("onDelete");
  });

  test("constraint timing stores deferred modes and omits the default", () => {
    const relation = readErdRelation({
      from: { table: "orders", column: "user_id" },
      to: { table: "users", column: "id" },
      cardinality: "*:1",
    });
    const deferred = setErdDeferrability(relation, "initially-deferred");
    expect(deferred.deferrability).toBe("initially-deferred");
    expect(setErdDeferrability(deferred, "not-deferrable")).not.toHaveProperty(
      "deferrability",
    );
  });

  test("composite foreign-key pairs keep order and compact single columns", () => {
    const relation = readErdRelation({
      from: { table: "orders", column: "tenant" },
      to: { table: "accounts", column: "tenant" },
      cardinality: "*:1",
    });
    const composite = addErdColumnPair(relation, {
      from: "account_id",
      to: "id",
    });
    expect(composite.from).toEqual({
      table: "orders",
      columns: ["tenant", "account_id"],
    });
    expect(composite.to).toEqual({
      table: "accounts",
      columns: ["tenant", "id"],
    });
    expect(readErdColumnPairs(composite)).toEqual([
      { from: "tenant", to: "tenant" },
      { from: "account_id", to: "id" },
    ]);
    expect(setErdColumnPair(composite, 1, "from", "tenant")).toBe(composite);

    const reordered = moveErdColumnPair(composite, 1, -1);
    expect(readErdColumnPairs(reordered)[0]).toEqual({
      from: "account_id",
      to: "id",
    });
    const single = removeErdColumnPair(reordered, 1);
    expect(single.from).toEqual({ table: "orders", column: "account_id" });
    expect(single.to).toEqual({ table: "accounts", column: "id" });
    const empty = removeErdColumnPair(single, 0);
    expect(empty.from).toEqual({ table: "orders" });
    expect(empty.to).toEqual({ table: "accounts" });
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
