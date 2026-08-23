import { describe, expect, test } from "bun:test";
import { History } from "./history.ts";
import {
  document,
  element,
  erdFixture,
  makeEditor,
  TEST_PAGE,
} from "./test-helpers.ts";

describe("undo and redo per command type", () => {
  test("createElement", () => {
    const editor = makeEditor();
    const id = editor.createElement("shape.geo", { visual: { x: 5, y: 6 } });
    expect(editor.store.has(id)).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.store.has(id)).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.store.get(id)?.visual).toMatchObject({ x: 5, y: 6 });
  });

  test("updateVisual restores keys the merge introduced", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "n1",
          type: "node.generic",
          semantic: { label: "a" },
          visual: { x: 0, y: 0 },
        }),
      ]),
    });
    editor.apply([
      { type: "updateVisual", id: "n1", visual: { width: 300, height: 200 } },
    ]);
    expect(editor.store.get("n1")?.visual).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    editor.undo();
    expect(editor.store.get("n1")?.visual).toEqual({ x: 0, y: 0 });
    editor.redo();
    expect(editor.store.get("n1")?.visual).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
  });

  test("updateSemantic", () => {
    const editor = makeEditor({
      document: document([
        element({ id: "n1", type: "node.generic", semantic: { label: "a" } }),
      ]),
    });
    editor.apply([
      { type: "updateSemantic", id: "n1", semantic: { label: "b" } },
    ]);
    editor.undo();
    expect(editor.store.get("n1")?.semantic).toEqual({ label: "a" });
    editor.redo();
    expect(editor.store.get("n1")?.semantic).toEqual({ label: "b" });
  });

  test("reorder", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "n1",
          type: "node.generic",
          semantic: { label: "a" },
          index: "a1",
        }),
      ]),
    });
    editor.apply([{ type: "reorder", id: "n1", index: "z1" }]);
    editor.undo();
    expect(editor.store.get("n1")?.index).toBe("a1");
    editor.redo();
    expect(editor.store.get("n1")?.index).toBe("z1");
  });

  test("deleteElements", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "n1",
          type: "node.generic",
          semantic: { label: "a" },
          visual: { x: 3, y: 4 },
        }),
      ]),
    });
    editor.deleteElements(["n1"]);
    expect(editor.store.has("n1")).toBe(false);
    editor.undo();
    expect(editor.store.get("n1")?.visual).toEqual({ x: 3, y: 4 });
    editor.redo();
    expect(editor.store.has("n1")).toBe(false);
  });
});

describe("cascaded delete", () => {
  test("restores every cascaded element in one undo step", () => {
    const editor = makeEditor({ document: document(erdFixture()) });
    editor.deleteElements(["users"]);
    expect(editor.store.has("users")).toBe(false);
    expect(editor.store.has("rel")).toBe(false);

    expect(editor.undo()).toBe(true);
    expect(editor.canUndo()).toBe(false);
    expect(editor.store.get("users")?.semantic).toMatchObject({
      tableName: "users",
    });
    expect(editor.store.get("rel")?.semantic).toMatchObject({
      cardinality: "1:*",
    });
    expect(editor.store.get("rel")?.index).toBe("a3");

    editor.redo();
    expect(editor.store.has("rel")).toBe(false);
  });

  test("restores a detached group's members in the same step", () => {
    const editor = makeEditor({
      document: document([
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
      ]),
    });
    editor.deleteElements(["a"]);
    expect(editor.store.get("g")?.semantic).toEqual({ memberIds: ["b"] });
    editor.undo();
    expect(editor.store.get("g")?.semantic).toEqual({ memberIds: ["a", "b"] });
    expect(editor.store.has("a")).toBe(true);
  });

  test("restores a group that was emptied and removed", () => {
    const editor = makeEditor({
      document: document([
        element({ id: "a", type: "node.generic", semantic: { label: "a" } }),
        element({
          id: "g",
          type: "group",
          semantic: { memberIds: ["a"] },
          index: "a2",
        }),
      ]),
    });
    editor.deleteElements(["a"]);
    expect(editor.store.has("g")).toBe(false);
    editor.undo();
    expect(editor.store.get("g")?.semantic).toEqual({ memberIds: ["a"] });
  });
});

describe("batching", () => {
  test("coalesces every apply in a batch into one entry", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "n1",
          type: "node.generic",
          semantic: { label: "a" },
          visual: { x: 0, y: 0 },
        }),
      ]),
    });
    editor.beginBatch();
    for (let step = 1; step <= 10; step += 1) {
      editor.apply([
        { type: "updateVisual", id: "n1", visual: { x: step * 10 } },
      ]);
    }
    editor.endBatch();

    expect(editor.history.undoSize).toBe(1);
    expect(editor.store.get("n1")?.visual).toMatchObject({ x: 100 });
    editor.undo();
    expect(editor.store.get("n1")?.visual).toMatchObject({ x: 0 });
    editor.redo();
    expect(editor.store.get("n1")?.visual).toMatchObject({ x: 100 });
  });

  test("nested batches record once, at the outermost close", () => {
    const editor = makeEditor();
    editor.beginBatch();
    editor.createElement("shape.geo");
    editor.beginBatch();
    editor.createElement("shape.geo");
    editor.endBatch();
    expect(editor.history.undoSize).toBe(0);
    editor.endBatch();
    expect(editor.history.undoSize).toBe(1);
    editor.undo();
    expect(editor.store.size).toBe(0);
  });

  test("an empty batch records nothing", () => {
    const editor = makeEditor();
    editor.beginBatch();
    editor.endBatch();
    expect(editor.canUndo()).toBe(false);
  });

  test("a batch of no-ops records nothing", () => {
    const editor = makeEditor();
    editor.beginBatch();
    editor.apply([{ type: "deleteElements", ids: ["nope"] }]);
    editor.endBatch();
    expect(editor.canUndo()).toBe(false);
  });
});

describe("aborting a batch", () => {
  test("reverts every apply in it and records no entry", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "n1",
          type: "node.generic",
          semantic: { label: "a" },
          visual: { x: 0, y: 0 },
        }),
      ]),
    });
    editor.beginBatch();
    for (let step = 1; step <= 10; step += 1) {
      editor.apply([
        { type: "updateVisual", id: "n1", visual: { x: step * 10 } },
      ]);
    }
    expect(editor.store.get("n1")?.visual).toMatchObject({ x: 100 });

    editor.abortBatch();

    expect(editor.store.get("n1")?.visual).toEqual({ x: 0, y: 0 });
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(editor.history.batching).toBe(false);
  });

  test("undoes creations made inside it", () => {
    const editor = makeEditor();
    editor.beginBatch();
    const id = editor.createElement("shape.geo");
    expect(editor.store.has(id)).toBe(true);
    editor.abortBatch();
    expect(editor.store.has(id)).toBe(false);
    expect(editor.canUndo()).toBe(false);
  });

  test("leaves earlier history untouched", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "n1",
          type: "node.generic",
          semantic: { label: "a" },
          visual: { x: 0, y: 0 },
        }),
      ]),
    });
    editor.apply([{ type: "updateVisual", id: "n1", visual: { x: 5 } }]);
    editor.beginBatch();
    editor.apply([{ type: "updateVisual", id: "n1", visual: { x: 999 } }]);
    editor.abortBatch();

    expect(editor.store.get("n1")?.visual).toMatchObject({ x: 5 });
    expect(editor.history.undoSize).toBe(1);
    editor.undo();
    expect(editor.store.get("n1")?.visual).toMatchObject({ x: 0 });
  });

  test("an empty batch aborts cleanly", () => {
    const editor = makeEditor();
    editor.beginBatch();
    editor.abortBatch();
    expect(editor.history.batching).toBe(false);
    expect(editor.canUndo()).toBe(false);
  });

  test("aborting with no batch open is a no-op", () => {
    const editor = makeEditor();
    editor.createElement("shape.geo");
    editor.abortBatch();
    expect(editor.history.undoSize).toBe(1);
    expect(editor.store.size).toBe(1);
  });

  test("only the outermost close decides, as with endBatch", () => {
    const editor = makeEditor();
    editor.beginBatch();
    const kept = editor.createElement("shape.geo");
    editor.beginBatch();
    editor.createElement("shape.geo");
    // The inner abort closes its level; the outer batch still owns the entry.
    editor.abortBatch();
    expect(editor.store.size).toBe(2);
    editor.endBatch();
    expect(editor.history.undoSize).toBe(1);
    editor.undo();
    expect(editor.store.has(kept)).toBe(false);
    expect(editor.store.size).toBe(0);
  });
});

describe("stack behaviour", () => {
  test("a new edit clears the redo branch", () => {
    const editor = makeEditor();
    const first = editor.createElement("shape.geo");
    editor.undo();
    expect(editor.canRedo()).toBe(true);
    editor.createElement("node.generic");
    expect(editor.canRedo()).toBe(false);
    expect(editor.store.has(first)).toBe(false);
  });

  test("history: ignore leaves the stacks alone", () => {
    const editor = makeEditor();
    editor.createElement("shape.geo", {}, { history: "ignore" });
    expect(editor.canUndo()).toBe(false);
    expect(editor.store.size).toBe(1);
  });

  test("undo and redo on empty stacks report false", () => {
    const editor = makeEditor();
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
  });

  test("a command batch that changes nothing costs no undo step", () => {
    const editor = makeEditor();
    editor.createElement("shape.geo");
    editor.apply([{ type: "deleteElements", ids: ["never-existed"] }]);
    expect(editor.history.undoSize).toBe(1);
    expect(editor.undo()).toBe(true);
    expect(editor.store.size).toBe(0);
    expect(editor.canUndo()).toBe(false);
  });

  test("drops the oldest entry past the limit", () => {
    const runs: number[] = [];
    const history = new History(() => {
      runs.push(1);
    }, 3);
    for (let i = 0; i < 5; i += 1) {
      history.push({
        undo: [{ type: "deleteElements", ids: [`n${i}`] }],
        redo: [{ type: "deleteElements", ids: [`n${i}`] }],
      });
    }
    expect(history.undoSize).toBe(3);
    history.undo();
    expect(runs).toHaveLength(1);
  });

  test("clear drops both stacks", () => {
    const editor = makeEditor();
    editor.createElement("shape.geo");
    editor.history.clear();
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
  });
});

describe("editor integration", () => {
  test("undo of a create prunes the selection", () => {
    const editor = makeEditor();
    const id = editor.createElement("shape.geo");
    editor.selection.set([id]);
    editor.undo();
    expect(editor.selection.size).toBe(0);
  });

  test("elements land on top of the z-order in creation order", () => {
    const editor = makeEditor();
    const first = editor.createElement("shape.geo");
    const second = editor.createElement("shape.geo");
    expect(
      editor.store.getPageElements(TEST_PAGE.id).map((el) => el.id),
    ).toEqual([first, second]);
  });
});
