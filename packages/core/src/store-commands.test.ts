import { describe, expect, test } from "bun:test";
import { applyCommands, type Command, CommandError } from "./commands.ts";
import { Store, type StoreDiff } from "./store.ts";
import { document, element, erdFixture, TEST_PAGE } from "./test-helpers.ts";

function storeWith(elements: readonly ReturnType<typeof element>[]): Store {
  return new Store(document(elements));
}

function collectDiffs(store: Store): StoreDiff[] {
  const diffs: StoreDiff[] = [];
  store.subscribe((diff) => diffs.push(diff));
  return diffs;
}

describe("store", () => {
  test("orders page elements by fractional index, then id", () => {
    const store = storeWith([
      element({
        id: "c",
        type: "node.generic",
        semantic: { label: "c" },
        index: "a3",
      }),
      element({
        id: "a",
        type: "node.generic",
        semantic: { label: "a" },
        index: "a1",
      }),
      element({
        id: "b",
        type: "node.generic",
        semantic: { label: "b" },
        index: "a2",
      }),
      element({
        id: "b2",
        type: "node.generic",
        semantic: { label: "b2" },
        index: "a2",
      }),
    ]);
    expect(store.getPageElements(TEST_PAGE.id).map((el) => el.id)).toEqual([
      "a",
      "b",
      "b2",
      "c",
    ]);
  });

  test("loadDocument replaces everything and announces one diff", () => {
    const store = storeWith([
      element({ id: "old", type: "node.generic", semantic: { label: "x" } }),
    ]);
    const diffs = collectDiffs(store);
    store.loadDocument(
      document([
        element({ id: "new", type: "node.generic", semantic: { label: "y" } }),
      ]),
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.added).toEqual(["new"]);
    expect(diffs[0]?.removed).toEqual(["old"]);
    expect(diffs[0]?.pagesChanged).toBe(true);
    expect(store.has("old")).toBe(false);
  });
});

describe("applyCommands", () => {
  test("creates, updates, reorders and deletes", () => {
    const store = storeWith([]);
    const created = element({
      id: "n1",
      type: "node.generic",
      semantic: { label: "hello" },
      visual: { x: 10, y: 20 },
    });
    applyCommands(store, [{ type: "createElement", element: created }]);
    expect(store.get("n1")?.semantic).toEqual({ label: "hello" });

    applyCommands(store, [
      { type: "updateVisual", id: "n1", visual: { x: 99 } },
    ]);
    expect(store.get("n1")?.visual).toEqual({ x: 99, y: 20 });

    applyCommands(store, [
      { type: "updateSemantic", id: "n1", semantic: { label: "bye" } },
    ]);
    expect(store.get("n1")?.semantic).toEqual({ label: "bye" });

    applyCommands(store, [{ type: "reorder", id: "n1", index: "z9" }]);
    expect(store.get("n1")?.index).toBe("z9");

    applyCommands(store, [{ type: "deleteElements", ids: ["n1"] }]);
    expect(store.has("n1")).toBe(false);
  });

  test("updateVisual ignores undefined and merges shallowly", () => {
    const store = storeWith([
      element({
        id: "n1",
        type: "node.generic",
        semantic: { label: "a" },
        visual: { x: 1, y: 2, width: 30 },
      }),
    ]);
    applyCommands(store, [
      { type: "updateVisual", id: "n1", visual: { x: 5, y: undefined } },
    ]);
    expect(store.get("n1")?.visual).toEqual({ x: 5, y: 2, width: 30 });
  });

  test("replaceVisual drops keys the patch does not carry", () => {
    const store = storeWith([
      element({
        id: "n1",
        type: "node.generic",
        semantic: { label: "a" },
        visual: { x: 1, y: 2, width: 30 },
      }),
    ]);
    applyCommands(store, [
      { type: "replaceVisual", id: "n1", visual: { x: 7, y: 8 } },
    ]);
    expect(store.get("n1")?.visual).toEqual({ x: 7, y: 8 });
  });

  test("emits exactly one diff per apply, however many commands", () => {
    const store = storeWith([
      element({ id: "n1", type: "node.generic", semantic: { label: "a" } }),
    ]);
    const diffs = collectDiffs(store);
    applyCommands(store, [
      { type: "updateVisual", id: "n1", visual: { x: 1 } },
      {
        type: "createElement",
        element: element({
          id: "n2",
          type: "node.generic",
          semantic: { label: "b" },
          index: "a2",
        }),
      },
      { type: "updateVisual", id: "n1", visual: { y: 2 } },
    ]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.added).toEqual(["n2"]);
    expect(diffs[0]?.updated).toEqual(["n1"]);
    expect(diffs[0]?.removed).toEqual([]);
  });

  test("a create followed by its delete in one batch nets to nothing", () => {
    const store = storeWith([]);
    const diffs = collectDiffs(store);
    applyCommands(store, [
      {
        type: "createElement",
        element: element({
          id: "tmp",
          type: "node.generic",
          semantic: { label: "t" },
        }),
      },
      { type: "deleteElements", ids: ["tmp"] },
    ]);
    expect(diffs).toHaveLength(0);
    expect(store.has("tmp")).toBe(false);
  });

  test("deleting a missing element is a no-op, not an error", () => {
    const store = storeWith([]);
    const diffs = collectDiffs(store);
    const result = applyCommands(store, [
      { type: "deleteElements", ids: ["nope"] },
    ]);
    expect(diffs).toHaveLength(0);
    expect(result.undo).toEqual([]);
  });
});

describe("delete cascade and detach", () => {
  test("deleting a table takes its relation with it", () => {
    const store = storeWith(erdFixture());
    applyCommands(store, [{ type: "deleteElements", ids: ["users"] }]);
    expect(store.has("users")).toBe(false);
    expect(store.has("rel")).toBe(false);
    expect(store.has("orders")).toBe(true);
  });

  test("deleting a node takes its generic edge with it", () => {
    const store = storeWith([
      element({ id: "a", type: "node.generic", semantic: { label: "a" } }),
      element({
        id: "b",
        type: "node.generic",
        semantic: { label: "b" },
        index: "a2",
      }),
      element({
        id: "e",
        type: "edge.generic",
        semantic: { from: "a", to: "b" },
        index: "a3",
      }),
    ]);
    applyCommands(store, [{ type: "deleteElements", ids: ["b"] }]);
    expect(store.has("e")).toBe(false);
    expect(store.has("a")).toBe(true);
  });

  test("cascades transitively through a chain of edges", () => {
    const store = storeWith([
      element({ id: "a", type: "node.generic", semantic: { label: "a" } }),
      element({
        id: "b",
        type: "node.generic",
        semantic: { label: "b" },
        index: "a2",
      }),
      element({
        id: "e1",
        type: "edge.generic",
        semantic: { from: "a", to: "b" },
        index: "a3",
      }),
      element({
        id: "e2",
        type: "edge.generic",
        semantic: { from: "e1", to: "b" },
        index: "a4",
      }),
    ]);
    applyCommands(store, [{ type: "deleteElements", ids: ["a"] }]);
    expect(store.has("e1")).toBe(false);
    expect(store.has("e2")).toBe(false);
    expect(store.has("b")).toBe(true);
  });

  test("a group detaches a deleted member instead of dying with it", () => {
    const store = storeWith([
      element({ id: "a", type: "node.generic", semantic: { label: "a" } }),
      element({
        id: "b",
        type: "node.generic",
        semantic: { label: "b" },
        index: "a2",
      }),
      element({
        id: "g",
        type: "group",
        semantic: { memberIds: ["a", "b"] },
        index: "a3",
      }),
    ]);
    applyCommands(store, [{ type: "deleteElements", ids: ["a"] }]);
    expect(store.get("g")?.semantic).toEqual({ memberIds: ["b"] });
  });

  test("a group that loses its last member is removed", () => {
    const store = storeWith([
      element({ id: "a", type: "node.generic", semantic: { label: "a" } }),
      element({
        id: "g",
        type: "group",
        semantic: { memberIds: ["a"] },
        index: "a2",
      }),
    ]);
    applyCommands(store, [{ type: "deleteElements", ids: ["a"] }]);
    expect(store.has("g")).toBe(false);
  });

  test("reports the cascade in a single diff", () => {
    const store = storeWith(erdFixture());
    const diffs = collectDiffs(store);
    applyCommands(store, [{ type: "deleteElements", ids: ["users"] }]);
    expect(diffs).toHaveLength(1);
    expect([...(diffs[0]?.removed ?? [])].sort()).toEqual(["rel", "users"]);
  });
});

describe("atomicity", () => {
  function expectUnchanged(run: () => void, store: Store): CommandError {
    const before = store.getSnapshot();
    const diffs = collectDiffs(store);
    let caught: unknown;
    try {
      run();
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(CommandError);
    expect(store.getSnapshot()).toEqual(before);
    expect(diffs).toHaveLength(0);
    return caught as CommandError;
  }

  test("rejects an invalid semantic payload and keeps the store intact", () => {
    const store = storeWith([
      element({ id: "n1", type: "node.generic", semantic: { label: "a" } }),
    ]);
    const failure = expectUnchanged(() => {
      applyCommands(store, [
        { type: "updateVisual", id: "n1", visual: { x: 5 } },
        { type: "updateSemantic", id: "n1", semantic: { label: 42 } },
      ]);
    }, store);
    expect(failure.issues.some((issue) => issue.code === "type.string")).toBe(
      true,
    );
  });

  test("rejects an update to an unknown id", () => {
    const store = storeWith([]);
    const failure = expectUnchanged(() => {
      applyCommands(store, [
        { type: "updateVisual", id: "ghost", visual: { x: 1 } },
      ]);
    }, store);
    expect(failure.issues[0]?.code).toBe("reference.missing");
  });

  test("rejects a duplicate create", () => {
    const store = storeWith([
      element({ id: "n1", type: "node.generic", semantic: { label: "a" } }),
    ]);
    const failure = expectUnchanged(() => {
      applyCommands(store, [
        {
          type: "createElement",
          element: element({
            id: "n1",
            type: "node.generic",
            semantic: { label: "dupe" },
          }),
        },
      ]);
    }, store);
    expect(failure.issues[0]?.code).toBe("id.duplicate");
  });

  test("rejects a create on an unknown page", () => {
    const store = storeWith([]);
    const failure = expectUnchanged(() => {
      applyCommands(store, [
        {
          type: "createElement",
          element: element({
            id: "n1",
            type: "node.generic",
            semantic: { label: "a" },
            page: "no-such-page",
          }),
        },
      ]);
    }, store);
    expect(failure.issues[0]?.code).toBe("reference.missingPage");
  });

  test("rejects an empty reorder index", () => {
    const store = storeWith([
      element({ id: "n1", type: "node.generic", semantic: { label: "a" } }),
    ]);
    expectUnchanged(() => {
      applyCommands(store, [{ type: "reorder", id: "n1", index: "" }]);
    }, store);
  });

  test("accepts an unknown element type without validating its payload", () => {
    const store = storeWith([]);
    const commands: Command[] = [
      {
        type: "createElement",
        element: element({
          id: "future",
          type: "future.widget",
          semantic: { anything: [1, 2, 3] },
        }),
      },
    ];
    applyCommands(store, commands);
    expect(store.get("future")?.semantic).toEqual({ anything: [1, 2, 3] });
  });
});
