import { describe, expect, test } from "bun:test";
import type { Document } from "@diagra/ir";
import * as Y from "yjs";
import { allFixtures, erdDocument, freeformDocument } from "./test-fixtures.ts";
import {
  applyIrToDoc,
  ELEMENTS_KEY,
  elementFromY,
  irToYDoc,
  META_KEY,
  PAGES_KEY,
  pageFromY,
  ydocToIr,
} from "./ydoc.ts";

/** The IR as `ydocToIr` reports it, for comparison against the input. */
function roundTrip(document: Document): Document {
  return ydocToIr(irToYDoc(document));
}

/** Sorted copy, since `ydocToIr` orders by id and fixtures need not. */
function sortedById(document: Document): Document {
  return {
    ...document,
    pages: [...document.pages].sort((a, b) => a.id.localeCompare(b.id)),
    elements: [...document.elements].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

describe("ydoc mapping", () => {
  test("round-trips every fixture through the Y.Doc", () => {
    for (const fixture of allFixtures()) {
      expect(roundTrip(fixture)).toEqual(sortedById(fixture));
    }
  });

  test("nests arrays of objects as Y.Array of Y.Map", () => {
    const doc = irToYDoc(erdDocument());
    const table = doc
      .getMap<Y.Map<unknown>>(ELEMENTS_KEY)
      .get("t-users") as Y.Map<unknown>;
    const semantic = table.get("semantic") as Y.Map<unknown>;
    const columns = semantic.get("columns") as Y.Array<Y.Map<unknown>>;

    expect(columns).toBeInstanceOf(Y.Array);
    expect(columns.length).toBe(2);
    expect(columns.get(0)).toBeInstanceOf(Y.Map);
    expect(columns.get(0).get("name")).toBe("id");
    // One nested item is one Y.Map, so two peers renaming two columns of the
    // same table never write to the same key (design 7.1).
    expect(columns.get(1).get("name")).toBe("email");
  });

  test("keeps scalar arrays and id-less object arrays as Y.Array", () => {
    const doc = irToYDoc(freeformDocument());
    const elements = doc.getMap<Y.Map<unknown>>(ELEMENTS_KEY);
    const group = elements.get("g-cluster") as Y.Map<unknown>;
    const members = (group.get("semantic") as Y.Map<unknown>).get(
      "memberIds",
    ) as Y.Array<unknown>;
    expect(members.toArray()).toEqual(["n-idea", "s-maybe"]);

    const stroke = elements.get("d-stroke") as Y.Map<unknown>;
    const points = (stroke.get("semantic") as Y.Map<unknown>).get(
      "points",
    ) as Y.Array<Y.Map<unknown>>;
    expect(points.length).toBe(3);
    expect(points.get(2).get("pressure")).toBeUndefined();
  });

  test("skips undefined fields rather than writing null", () => {
    const doc = new Y.Doc();
    applyIrToDoc(doc, {
      schemaVersion: 1,
      id: "d",
      title: "t",
      pages: [{ id: "p1", name: "P", kind: "freeform" }],
      elements: [
        {
          id: "e1",
          page: "p1",
          type: "node.generic",
          index: "a0",
          semantic: { label: "x", note: undefined },
          visual: { x: 1, y: undefined },
        },
      ],
    });
    const element = doc
      .getMap<Y.Map<unknown>>(ELEMENTS_KEY)
      .get("e1") as Y.Map<unknown>;
    expect(element.has("extensions")).toBe(false);
    expect((element.get("semantic") as Y.Map<unknown>).has("note")).toBe(false);
    expect((element.get("visual") as Y.Map<unknown>).has("y")).toBe(false);
  });

  test("orders pages and elements by id, whatever the Y.Map order", () => {
    const doc = new Y.Doc();
    // Insertion order is deliberately reversed; `Store.loadDocument` opens
    // `pages[0]`, so a nondeterministic order would open a random page.
    applyIrToDoc(doc, {
      schemaVersion: 1,
      id: "d",
      title: "t",
      pages: [
        { id: "p2", name: "Second", kind: "erd" },
        { id: "p1", name: "First", kind: "freeform" },
      ],
      elements: [
        {
          id: "z",
          page: "p1",
          type: "node.generic",
          index: "a1",
          semantic: {},
          visual: {},
        },
        {
          id: "a",
          page: "p1",
          type: "node.generic",
          index: "a0",
          semantic: {},
          visual: {},
        },
      ],
    });
    const ir = ydocToIr(doc);
    expect(ir.pages.map((page) => page.id)).toEqual(["p1", "p2"]);
    expect(ir.elements.map((element) => element.id)).toEqual(["a", "z"]);
  });

  test("replaces the whole document atomically", () => {
    const doc = irToYDoc(erdDocument());
    const transactions: number[] = [];
    doc.on("afterTransaction", () => {
      transactions.push(doc.getMap(ELEMENTS_KEY).size);
    });

    applyIrToDoc(doc, freeformDocument());

    expect(transactions).toEqual([4]);
    expect(doc.getMap(PAGES_KEY).size).toBe(1);
    expect(doc.getMap<unknown>(META_KEY).get("title")).toBe("Whiteboard");
  });

  test("materializes one element or page without a full pass", () => {
    const doc = irToYDoc(erdDocument());
    const value = doc.getMap<unknown>(ELEMENTS_KEY).get("t-users");
    expect(elementFromY("t-users", value)).toEqual(
      erdDocument().elements[0] as never,
    );
    expect(pageFromY("p1", doc.getMap<unknown>(PAGES_KEY).get("p1"))).toEqual({
      id: "p1",
      name: "Domain model",
      kind: "erd",
    });
  });

  test("coerces malformed remote entries instead of throwing", () => {
    const doc = new Y.Doc();
    doc.getMap<unknown>(ELEMENTS_KEY).set("broken", "not a map");
    expect(
      elementFromY("broken", doc.getMap<unknown>(ELEMENTS_KEY).get("broken")),
    ).toEqual({
      id: "broken",
      page: "",
      type: "",
      index: "",
      semantic: {},
      visual: {},
    });
    expect(ydocToIr(doc).elements).toHaveLength(1);
  });
});
