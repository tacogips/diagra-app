import { describe, expect, test } from "bun:test";
import type { Document, Element, Page } from "@diagra/ir";
import * as Y from "yjs";
import { syncElementToY, syncPageToY } from "./diff.ts";
import {
  elementOf,
  erdDocument,
  freeformDocument,
  umlDocument,
} from "./test-fixtures.ts";
import { ELEMENTS_KEY, fromY, irToYDoc, PAGES_KEY, pageFromY } from "./ydoc.ts";

interface Fixture {
  readonly doc: Y.Doc;
  readonly map: Y.Map<unknown>;
  readonly previous: Element;
  /** Every key touched, as `path:action`, in the order Yjs reported them. */
  readonly writes: string[];
}

/**
 * Observe one entry's subtree and report each write as `path:action`, so a
 * test can assert not just the resulting value but how much was rewritten to
 * get there.
 */
function recordWrites(map: Y.Map<unknown>): string[] {
  const writes: string[] = [];
  map.observeDeep((events) => {
    for (const event of events) {
      const prefix = event.path.join(".");
      if (event.target instanceof Y.Array) {
        for (const change of event.changes.delta) {
          if (change.insert) {
            writes.push(`${prefix}:insert(${(change.insert as []).length})`);
          }
          if (change.delete) {
            writes.push(`${prefix}:delete(${change.delete})`);
          }
        }
        continue;
      }
      for (const [key, change] of event.changes.keys) {
        writes.push(
          `${prefix === "" ? key : `${prefix}.${key}`}:${change.action}`,
        );
      }
    }
  });
  return writes;
}

function open(document: Document, id: string): Fixture {
  const doc = irToYDoc(document);
  const map = doc
    .getMap<Y.Map<unknown>>(ELEMENTS_KEY)
    .get(id) as Y.Map<unknown>;
  return {
    doc,
    map,
    previous: elementOf(document, id),
    writes: recordWrites(map),
  };
}

/** Apply one element edit the way the binding does: inside one transaction. */
function sync(fixture: Fixture, next: Element): void {
  Y.transact(fixture.doc, () => {
    syncElementToY(fixture.previous, next, fixture.map);
  });
}

function withSemantic(element: Element, semantic: unknown): Element {
  return { ...element, semantic };
}

function columns(element: Element): Record<string, unknown>[] {
  return (element.semantic as { columns: Record<string, unknown>[] }).columns;
}

describe("syncElementToY", () => {
  test("writes nothing when nothing changed", () => {
    const fixture = open(erdDocument(), "t-users");
    sync(fixture, { ...fixture.previous });
    expect(fixture.writes).toEqual([]);
  });

  test("a move writes exactly the two visual coordinates", () => {
    const fixture = open(erdDocument(), "t-users");
    sync(fixture, {
      ...fixture.previous,
      visual: { ...fixture.previous.visual, x: 640, y: 220 },
    });
    expect(fixture.writes).toEqual(["visual.x:update", "visual.y:update"]);
    expect(fromY(fixture.map.get("visual"))).toEqual({
      x: 640,
      y: 220,
      width: 280,
    });
  });

  test("introducing a visual key is one add, removing one is one delete", () => {
    const fixture = open(erdDocument(), "e-rel-1");
    sync(fixture, { ...fixture.previous, visual: { rotation: 15 } });
    expect(fixture.writes).toEqual(["visual.rotation:add"]);

    const second = open(erdDocument(), "t-users");
    sync(second, { ...second.previous, visual: { x: 100, y: 100 } });
    expect(second.writes).toEqual(["visual.width:delete"]);
  });

  test("renaming a column writes one key inside that column", () => {
    const fixture = open(erdDocument(), "t-users");
    const next = columns(fixture.previous).map((column, index) =>
      index === 1 ? { ...column, name: "email_address" } : column,
    );
    sync(
      fixture,
      withSemantic(fixture.previous, { tableName: "users", columns: next }),
    );

    expect(fixture.writes).toEqual(["semantic.columns.1.name:update"]);
    // The sibling column's map was not rewritten, so a concurrent edit to it
    // survives (design 7.1).
    expect(fromY(fixture.map.get("semantic"))).toEqual({
      tableName: "users",
      columns: [
        { id: "c-id", name: "id", dataType: "uuid", pk: true },
        {
          id: "c-email",
          name: "email_address",
          dataType: "text",
          nullable: false,
        },
      ],
    });
  });

  test("adding and removing a column touches only that item", () => {
    const added = open(erdDocument(), "t-users");
    sync(
      added,
      withSemantic(added.previous, {
        tableName: "users",
        columns: [
          ...columns(added.previous),
          { id: "c-name", name: "name", dataType: "text" },
        ],
      }),
    );
    expect(added.writes).toEqual(["semantic.columns:insert(1)"]);

    const removed = open(erdDocument(), "t-users");
    sync(
      removed,
      withSemantic(removed.previous, {
        tableName: "users",
        columns: [columns(removed.previous)[0] as Record<string, unknown>],
      }),
    );
    expect(removed.writes).toEqual(["semantic.columns:delete(1)"]);
  });

  test("reordering columns moves one item rather than rewriting the list", () => {
    const fixture = open(erdDocument(), "t-users");
    const [first, second] = columns(fixture.previous);
    sync(
      fixture,
      withSemantic(fixture.previous, {
        tableName: "users",
        columns: [second, first],
      }),
    );
    expect(fixture.writes).toEqual([
      "semantic.columns:insert(1)",
      "semantic.columns:delete(1)",
    ]);
    expect(
      (
        fromY(fixture.map.get("semantic")) as { columns: { id: string }[] }
      ).columns.map((column) => column.id),
    ).toEqual(["c-email", "c-id"]);
  });

  test("renaming an id-carrying item in a second array is still one write", () => {
    const fixture = open(umlDocument(), "c-order");
    const semantic = fixture.previous.semantic as {
      readonly attributes: readonly Record<string, unknown>[];
      readonly methods: readonly Record<string, unknown>[];
    };
    sync(
      fixture,
      withSemantic(fixture.previous, {
        ...semantic,
        methods: [{ ...(semantic.methods[0] as object), name: "recompute" }],
      }),
    );
    expect(fixture.writes).toEqual(["semantic.methods.0.name:update"]);
  });

  test("id-less and scalar arrays are replaced as one field write", () => {
    const stroke = open(freeformDocument(), "d-stroke");
    sync(
      stroke,
      withSemantic(stroke.previous, {
        points: [
          { x: 10, y: 10, pressure: 0.5 },
          { x: 40, y: 40 },
        ],
      }),
    );
    expect(stroke.writes).toEqual(["semantic.points:update"]);

    const group = open(freeformDocument(), "g-cluster");
    sync(group, withSemantic(group.previous, { memberIds: ["n-idea"] }));
    expect(group.writes).toEqual(["semantic.memberIds:update"]);
    expect(fromY(group.map.get("semantic"))).toEqual({
      memberIds: ["n-idea"],
    });
  });

  test("page moves and reorders write one top-level key each", () => {
    const moved = open(erdDocument(), "t-users");
    sync(moved, { ...moved.previous, page: "p2" });
    expect(moved.writes).toEqual(["page:update"]);

    const reordered = open(erdDocument(), "t-users");
    sync(reordered, { ...reordered.previous, index: "a9" });
    expect(reordered.writes).toEqual(["index:update"]);
  });

  test("replaces a whole nested object when the Y side is not a map", () => {
    const fixture = open(erdDocument(), "t-users");
    fixture.map.set("semantic", "corrupted");
    fixture.writes.length = 0;
    sync(fixture, withSemantic(fixture.previous, { tableName: "users" }));
    expect(fixture.writes).toEqual(["semantic:update"]);
    expect(fromY(fixture.map.get("semantic"))).toEqual({ tableName: "users" });
  });

  test("never creates Y.Text", () => {
    const fixture = open(erdDocument(), "t-users");
    sync(
      fixture,
      withSemantic(fixture.previous, {
        tableName: "customers",
        columns: columns(fixture.previous),
      }),
    );
    const semantic = fixture.map.get("semantic") as Y.Map<unknown>;
    expect(semantic.get("tableName")).toBe("customers");
    expect(semantic.get("tableName")).not.toBeInstanceOf(Y.Text);
  });

  test("writes a key the shadow believed was already there", () => {
    // Drift: something removed the key without the shadow noticing. The next
    // local edit must repair it rather than trust the cache.
    const fixture = open(erdDocument(), "t-users");
    (fixture.map.get("visual") as Y.Map<unknown>).delete("x");
    fixture.writes.length = 0;
    sync(fixture, { ...fixture.previous });
    expect(fixture.writes).toEqual(["visual.x:add"]);
  });
});

interface PageFixture {
  readonly doc: Y.Doc;
  readonly map: Y.Map<unknown>;
  readonly previous: Page;
  readonly writes: string[];
}

function openPage(document: Document, id: string): PageFixture {
  const doc = irToYDoc(document);
  const map = doc.getMap<Y.Map<unknown>>(PAGES_KEY).get(id) as Y.Map<unknown>;
  const previous = document.pages.find((page) => page.id === id);
  if (!previous) {
    throw new Error(`fixture ${document.id} has no page ${id}`);
  }
  return { doc, map, previous, writes: recordWrites(map) };
}

function syncPage(fixture: PageFixture, next: Page): void {
  Y.transact(fixture.doc, () => {
    syncPageToY(fixture.previous, next, fixture.map);
  });
}

describe("syncPageToY", () => {
  test("writes nothing when nothing changed", () => {
    const fixture = openPage(freeformDocument(), "p1");
    syncPage(fixture, { ...fixture.previous });
    expect(fixture.writes).toEqual([]);
  });

  test("a rename writes only the name and keeps the extension bag", () => {
    const fixture = openPage(freeformDocument(), "p1");
    syncPage(fixture, { ...fixture.previous, name: "Board" });
    expect(fixture.writes).toEqual(["name:update"]);
    expect(pageFromY("p1", fixture.map)).toEqual({
      id: "p1",
      name: "Board",
      kind: "freeform",
      extensions: { lock: true },
    });
  });

  test("a kind change is one key and lands where pageFromY reads it", () => {
    const fixture = openPage(erdDocument(), "p1");
    syncPage(fixture, { ...fixture.previous, kind: "freeform" });
    expect(fixture.writes).toEqual(["kind:update"]);
    expect(pageFromY("p1", fixture.map).kind).toBe("freeform");
  });

  test("extensions come and go as one key, edited in place when nested", () => {
    const fixture = openPage(freeformDocument(), "p1");
    syncPage(fixture, { ...fixture.previous, extensions: { lock: false } });
    expect(fixture.writes).toEqual(["extensions.lock:update"]);

    const dropped = openPage(freeformDocument(), "p1");
    const { extensions: _extensions, ...bare } = dropped.previous;
    syncPage(dropped, bare);
    expect(dropped.writes).toEqual(["extensions:delete"]);
    expect(pageFromY("p1", dropped.map)).toEqual(bare);

    const added = openPage(erdDocument(), "p1");
    syncPage(added, { ...added.previous, extensions: { lock: true } });
    expect(added.writes).toEqual(["extensions:add"]);
  });

  test("leaves keys it does not know about alone", () => {
    const fixture = openPage(erdDocument(), "p1");
    fixture.map.set("future", 1);
    fixture.writes.length = 0;
    syncPage(fixture, { ...fixture.previous, name: "Entities" });
    expect(fixture.writes).toEqual(["name:update"]);
    expect(fixture.map.get("future")).toBe(1);
  });
});
