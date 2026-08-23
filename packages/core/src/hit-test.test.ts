import { describe, expect, test } from "bun:test";
import { createShapeContext, hitTestPoint } from "./hit-test.ts";
import { createDefaultRegistry } from "./shapes/index.ts";
import { Store } from "./store.ts";
import { document, element, TEST_PAGE } from "./test-helpers.ts";

const registry = createDefaultRegistry();

function pick(
  store: Store,
  point: { x: number; y: number },
  zoom = 1,
): string | null {
  return hitTestPoint(store, registry, TEST_PAGE.id, point, { zoom });
}

describe("geo shapes", () => {
  const store = new Store(
    document([
      element({
        id: "rect",
        type: "shape.geo",
        semantic: { geo: "rect" },
        visual: { x: 0, y: 0, width: 100, height: 100 },
      }),
      element({
        id: "ellipse",
        type: "shape.geo",
        semantic: { geo: "ellipse" },
        index: "a2",
        visual: { x: 200, y: 0, width: 100, height: 100 },
      }),
      element({
        id: "diamond",
        type: "shape.geo",
        semantic: { geo: "diamond" },
        index: "a3",
        visual: { x: 400, y: 0, width: 100, height: 100 },
      }),
    ]),
  );

  test("a rectangle picks anywhere in its box", () => {
    expect(pick(store, { x: 1, y: 1 })).toBe("rect");
    expect(pick(store, { x: 99, y: 99 })).toBe("rect");
    expect(pick(store, { x: 101, y: 50 })).toBeNull();
  });

  test("an ellipse rejects its corners", () => {
    expect(pick(store, { x: 250, y: 50 })).toBe("ellipse");
    expect(pick(store, { x: 202, y: 2 })).toBeNull();
  });

  test("a diamond rejects its corners", () => {
    expect(pick(store, { x: 450, y: 50 })).toBe("diamond");
    expect(pick(store, { x: 405, y: 5 })).toBeNull();
  });

  test("falls back to the default box when no size is stored", () => {
    const sized = new Store(
      document([
        element({
          id: "g",
          type: "shape.geo",
          semantic: { geo: "rect" },
          visual: { x: 0, y: 0 },
        }),
      ]),
    );
    expect(pick(sized, { x: 159, y: 99 })).toBe("g");
    expect(pick(sized, { x: 161, y: 99 })).toBeNull();
  });
});

describe("derived-height shapes", () => {
  test("an erd.table grows a row per column", () => {
    const store = new Store(
      document([
        element({
          id: "t",
          type: "erd.table",
          semantic: {
            tableName: "t",
            columns: [
              { id: "a", name: "a", dataType: "int" },
              { id: "b", name: "b", dataType: "int" },
            ],
          },
          visual: { x: 0, y: 0 },
        }),
      ]),
    );
    // 32 header + 2 * 24 rows = 80
    expect(pick(store, { x: 10, y: 79 })).toBe("t");
    expect(pick(store, { x: 10, y: 81 })).toBeNull();
  });

  test("a uml.class stacks its three compartments", () => {
    const store = new Store(
      document([
        element({
          id: "c",
          type: "uml.class",
          semantic: {
            name: "C",
            attributes: [{ id: "a", name: "a" }],
            methods: [
              { id: "m", name: "m" },
              { id: "n", name: "n" },
            ],
          },
          visual: { x: 0, y: 0 },
        }),
      ]),
    );
    // 32 name + 22 attribute + 44 methods = 98
    expect(pick(store, { x: 10, y: 97 })).toBe("c");
    expect(pick(store, { x: 10, y: 99 })).toBeNull();
  });
});

describe("connectors", () => {
  const store = new Store(
    document([
      element({
        id: "a",
        type: "node.generic",
        semantic: { label: "a" },
        visual: { x: 0, y: 0, width: 100, height: 100 },
      }),
      element({
        id: "b",
        type: "node.generic",
        semantic: { label: "b" },
        index: "a2",
        visual: { x: 300, y: 0, width: 100, height: 100 },
      }),
      element({
        id: "e",
        type: "edge.generic",
        semantic: { from: "a", to: "b" },
        index: "a3",
      }),
    ]),
  );

  test("picks along the segment between the two boundaries", () => {
    expect(pick(store, { x: 200, y: 50 })).toBe("e");
  });

  test("the tolerance shrinks in page space as zoom grows", () => {
    // 8 screen px is 8 page units at zoom 1 but only 1 at zoom 8.
    expect(pick(store, { x: 200, y: 54 }, 1)).toBe("e");
    expect(pick(store, { x: 200, y: 54 }, 8)).toBeNull();
    expect(pick(store, { x: 200, y: 50.5 }, 8)).toBe("e");
  });

  test("a connector with a missing endpoint is unpickable", () => {
    const dangling = new Store(
      document([
        element({
          id: "e",
          type: "edge.generic",
          semantic: { from: "gone", to: "missing" },
        }),
      ]),
    );
    expect(pick(dangling, { x: 0, y: 0 })).toBeNull();
  });

  test("a reference cycle terminates instead of recursing", () => {
    const cyclic = new Store(
      document([
        element({
          id: "e1",
          type: "edge.generic",
          semantic: { from: "e2", to: "e2" },
        }),
        element({
          id: "e2",
          type: "edge.generic",
          semantic: { from: "e1", to: "e1" },
          index: "a2",
        }),
      ]),
    );
    expect(pick(cyclic, { x: 0, y: 0 })).toBeNull();
  });
});

describe("z-order", () => {
  test("the topmost element wins", () => {
    const store = new Store(
      document([
        element({
          id: "under",
          type: "shape.geo",
          semantic: { geo: "rect" },
          index: "a1",
          visual: { x: 0, y: 0, width: 100, height: 100 },
        }),
        element({
          id: "over",
          type: "shape.geo",
          semantic: { geo: "rect" },
          index: "a2",
          visual: { x: 50, y: 50, width: 100, height: 100 },
        }),
      ]),
    );
    expect(pick(store, { x: 75, y: 75 })).toBe("over");
    expect(pick(store, { x: 25, y: 25 })).toBe("under");
  });

  test("only the requested page is considered", () => {
    const store = new Store({
      schemaVersion: 1,
      id: "doc",
      title: "t",
      pages: [
        TEST_PAGE,
        { id: "page-2", name: "Page 2", kind: "freeform" as const },
      ],
      elements: [
        element({
          id: "other",
          type: "shape.geo",
          semantic: { geo: "rect" },
          page: "page-2",
          visual: { x: 0, y: 0, width: 100, height: 100 },
        }),
      ],
    });
    expect(pick(store, { x: 50, y: 50 })).toBeNull();
    expect(
      hitTestPoint(store, registry, "page-2", { x: 50, y: 50 }, { zoom: 1 }),
    ).toBe("other");
  });
});

describe("unknown element types", () => {
  test("stay pickable when they carry coordinates", () => {
    const store = new Store(
      document([
        element({
          id: "future",
          type: "future.widget",
          semantic: {},
          visual: { x: 10, y: 10 },
        }),
      ]),
    );
    expect(pick(store, { x: 20, y: 20 })).toBe("future");
  });

  test("are skipped when they carry none", () => {
    const store = new Store(
      document([
        element({ id: "future", type: "future.widget", semantic: {} }),
      ]),
    );
    expect(pick(store, { x: 0, y: 0 })).toBeNull();
  });
});

describe("shape context", () => {
  test("memoizes bounds per context", () => {
    const store = new Store(
      document([
        element({
          id: "a",
          type: "shape.geo",
          semantic: { geo: "rect" },
          visual: { x: 5, y: 5, width: 10, height: 10 },
        }),
      ]),
    );
    const context = createShapeContext(store, registry, 1);
    expect(context.boundsOf("a")).toEqual(context.boundsOf("a"));
    expect(context.boundsOf("missing")).toBeNull();
    expect(context.resolve("a")?.id).toBe("a");
  });
});
