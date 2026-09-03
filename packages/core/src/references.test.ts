// Reference rewriting, in isolation from the store.
//
// Every path shape the registry can report is exercised here — a scalar
// field, a nested endpoint object, and an array slot — because paste and
// copy both stand on `remapReferences`/`selfContained` getting them right.

import { describe, expect, test } from "bun:test";
import {
  detachReference,
  referencesOf,
  remapReferences,
  selfContained,
} from "./references.ts";
import { element } from "./test-helpers.ts";

function remapped(
  type: string,
  semantic: unknown,
  mapping: Record<string, string>,
): unknown {
  return remapReferences(type, semantic, new Map(Object.entries(mapping)));
}

describe("referencesOf", () => {
  test("reports the declared paths of a known type", () => {
    const relation = element({
      id: "rel",
      type: "erd.relation",
      semantic: {
        from: { table: "users", column: "c1" },
        to: { table: "orders", column: "c2" },
        cardinality: "1:*",
      },
    });
    expect(referencesOf(relation)).toEqual([
      { field: "from.table", id: "users" },
      { field: "to.table", id: "orders" },
    ]);
  });

  test("an unmodelled type reports nothing", () => {
    const foreign = element({
      id: "x",
      type: "future.widget",
      semantic: { from: "a", to: "b" },
    });
    expect(referencesOf(foreign)).toEqual([]);
  });
});

describe("remapReferences", () => {
  test("rewrites the scalar endpoints of an edge", () => {
    expect(
      remapped(
        "edge.generic",
        { from: "a", to: "b", arrowheads: { end: "arrow" } },
        { a: "a2", b: "b2" },
      ),
    ).toEqual({ from: "a2", to: "b2", arrowheads: { end: "arrow" } });
  });

  test("rewrites a uml association without touching its kind", () => {
    expect(
      remapped(
        "uml.association",
        { from: "a", to: "b", kind: "inherit", label: "is a" },
        { a: "a2", b: "b2" },
      ),
    ).toEqual({ from: "a2", to: "b2", kind: "inherit", label: "is a" });
  });

  test("rewrites erd endpoint tables and leaves column ids alone", () => {
    expect(
      remapped(
        "erd.relation",
        {
          from: { table: "users", column: "c1" },
          to: { table: "orders", column: "c2" },
          cardinality: "1:*",
        },
        { users: "users2", orders: "orders2", c1: "nope" },
      ),
    ).toEqual({
      from: { table: "users2", column: "c1" },
      to: { table: "orders2", column: "c2" },
      cardinality: "1:*",
    });
  });

  test("rewrites the mapped slots of a group and keeps their order", () => {
    expect(
      remapped("group", { memberIds: ["a", "b", "c"] }, { a: "a2", c: "c2" }),
    ).toEqual({ memberIds: ["a2", "b", "c2"] });
  });

  test("rewrites a sequence activation's participant", () => {
    expect(
      remapped(
        "sequence.activation",
        { participant: "p", fromOrder: "a1", toOrder: "a2" },
        { p: "p2" },
      ),
    ).toEqual({ participant: "p2", fromOrder: "a1", toOrder: "a2" });
  });

  test("an unmapped id and an unknown type come back untouched", () => {
    const semantic = { from: "a", to: "b" };
    expect(remapped("edge.generic", semantic, { z: "z2" })).toBe(semantic);
    expect(remapped("future.widget", semantic, { a: "a2" })).toBe(semantic);
    expect(remapped("edge.generic", semantic, {})).toBe(semantic);
  });
});

describe("detachReference", () => {
  test("drops a scalar field and one array slot", () => {
    expect(
      detachReference({ from: "a", to: "b" }, { field: "from", id: "a" }, "a"),
    ).toEqual({ to: "b" });
    expect(
      detachReference(
        { memberIds: ["a", "b"] },
        { field: "memberIds[0]", id: "a" },
        "a",
      ),
    ).toEqual({ memberIds: ["b"] });
  });
});

function table(id: string): ReturnType<typeof element> {
  return element({
    id,
    type: "erd.table",
    semantic: { tableName: id, columns: [] },
  });
}

function relation(id: string, from: string, to: string) {
  return element({
    id,
    type: "erd.relation",
    semantic: {
      from: { table: from },
      to: { table: to },
      cardinality: "1:*",
    },
  });
}

describe("selfContained", () => {
  test("keeps a fragment that references only itself, in input order", () => {
    const fragment = [
      table("users"),
      table("orders"),
      relation("r", "users", "orders"),
    ];
    expect(selfContained(fragment).map((entry) => entry.id)).toEqual([
      "users",
      "orders",
      "r",
    ]);
  });

  test("drops a relation whose other table was not copied", () => {
    const fragment = [table("users"), relation("r", "users", "orders")];
    expect(selfContained(fragment).map((entry) => entry.id)).toEqual(["users"]);
  });

  test("detaches a group member that was left behind", () => {
    const fragment = [
      table("users"),
      element({
        id: "g",
        type: "group",
        semantic: { memberIds: ["users", "orders"] },
      }),
    ];
    const kept = selfContained(fragment);
    expect(kept.map((entry) => entry.id)).toEqual(["users", "g"]);
    expect(kept[1]?.semantic).toEqual({ memberIds: ["users"] });
  });

  test("drops a group that kept no member at all", () => {
    const fragment = [
      element({ id: "g", type: "group", semantic: { memberIds: ["gone"] } }),
    ];
    expect(selfContained(fragment)).toEqual([]);
  });

  test("cascades transitively when a dropped element was itself a target", () => {
    // The group survives only through `users`; dropping the relation is not
    // enough, and the second pass has to see the group empty out too.
    const fragment = [
      element({ id: "g", type: "group", semantic: { memberIds: ["r"] } }),
      relation("r", "users", "orders"),
    ];
    expect(selfContained(fragment)).toEqual([]);
  });

  test("an unmodelled type is never dropped", () => {
    const fragment = [
      element({
        id: "x",
        type: "future.widget",
        semantic: { from: "missing" },
      }),
    ];
    expect(selfContained(fragment).map((entry) => entry.id)).toEqual(["x"]);
  });
});
