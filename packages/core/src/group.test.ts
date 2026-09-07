import { describe, expect, test } from "bun:test";
import type { Editor } from "./editor.ts";
import {
  expandGroups,
  groupOf,
  outermostGroupOf,
  resolveSelectionTarget,
  selectionUnits,
  topLevelIds,
} from "./group.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

function box(id: string, x: number, index: string) {
  return element({
    id,
    type: "shape.geo",
    index,
    semantic: { geo: "rect" },
    visual: { x, y: 0, width: 100, height: 50 },
  });
}

/** a, b grouped as g1; g1 and c grouped as g2; d loose. */
function nestedEditor(): Editor {
  return makeEditor({
    document: document([
      box("a", 0, "a1"),
      box("b", 200, "a2"),
      element({
        id: "g1",
        type: "group",
        index: "a3",
        semantic: { memberIds: ["a", "b"] },
      }),
      box("c", 400, "a4"),
      element({
        id: "g2",
        type: "group",
        index: "a5",
        semantic: { memberIds: ["g1", "c"] },
      }),
      box("d", 600, "a6"),
    ]),
  });
}

describe("group lookups", () => {
  test("duplicating a grouped layer retains its immediate group and mask", () => {
    const editor = nestedEditor();
    editor.apply([
      {
        type: "updateSemantic",
        id: "g1",
        semantic: { memberIds: ["a", "b"], maskId: "a" },
      },
    ]);
    editor.selection.set(["b"]);
    const before = editor.getSnapshot();
    const [copy] = editor.duplicateSelection();
    if (!copy) throw new Error("missing duplicate");
    expect(groupOf(editor.store, copy)?.id).toBe("g1");
    expect(editor.store.get("g1")?.semantic).toEqual({
      memberIds: ["a", "b", copy],
      maskId: "a",
    });
    expect(editor.store.get("g2")?.semantic).toEqual({
      memberIds: ["g1", "c"],
    });
    const after = editor.getSnapshot();
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
    editor.redo();
    expect(editor.getSnapshot()).toEqual(after);
  });

  test("duplicating inside a locked group does not create detached copies", () => {
    const editor = nestedEditor();
    editor.apply([
      { type: "updateVisual", id: "g1", visual: { locked: true } },
    ]);
    editor.selection.set(["a"]);
    const before = editor.getSnapshot();
    expect(editor.duplicateSelection()).toEqual([]);
    expect(editor.getSnapshot()).toEqual(before);
  });

  test("walk up and down the membership tree", () => {
    const editor = nestedEditor();
    expect(groupOf(editor.store, "a")?.id).toBe("g1");
    expect(outermostGroupOf(editor.store, "a")).toBe("g2");
    expect(outermostGroupOf(editor.store, "d")).toBe("d");
    expect(expandGroups(editor.store, ["g2"])).toEqual([
      "g2",
      "g1",
      "a",
      "b",
      "c",
    ]);
    expect(topLevelIds(editor.store, "page-1")).toEqual(["g2", "d"]);
  });

  test("survive a membership cycle", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "x",
          type: "group",
          index: "a1",
          semantic: { memberIds: ["y"] },
        }),
        element({
          id: "y",
          type: "group",
          index: "a2",
          semantic: { memberIds: ["x"] },
        }),
      ]),
    });
    expect(expandGroups(editor.store, ["x"])).toEqual(["x", "y"]);
    expect(typeof outermostGroupOf(editor.store, "x")).toBe("string");
  });

  test("selection units drop members whose group is selected", () => {
    const editor = nestedEditor();
    expect(selectionUnits(editor.store, ["a", "g1", "d"])).toEqual(["g1", "d"]);
  });
});

describe("resolveSelectionTarget", () => {
  test("selects the outermost group first, then drills one level per click", () => {
    const editor = nestedEditor();
    const store = editor.store;
    expect(resolveSelectionTarget(store, "a", new Set())).toBe("g2");
    expect(resolveSelectionTarget(store, "a", new Set(["g2"]))).toBe("g1");
    expect(resolveSelectionTarget(store, "a", new Set(["g1"]))).toBe("a");
    expect(resolveSelectionTarget(store, "a", new Set(["a"]))).toBe("a");
    expect(resolveSelectionTarget(store, "d", new Set(["g2"]))).toBe("d");
  });
});

describe("Editor grouping", () => {
  test("groups the selection, selects the group, and ungroups back", () => {
    const editor = makeEditor({
      document: document([box("a", 0, "a1"), box("b", 200, "a2")]),
    });
    editor.selection.set(["a", "b"]);
    const id = editor.groupSelection();
    expect(id).not.toBeNull();
    expect([...editor.selection.ids()]).toEqual([id as string]);
    const group = editor.store.get(id as string);
    expect(group?.semantic).toEqual({ memberIds: ["a", "b"] });
    // Bounds are the members' union.
    expect(editor.getBounds(id as string)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 50,
    });

    expect(editor.ungroupSelection()).toBe(true);
    expect(editor.store.has(id as string)).toBe(false);
    expect([...editor.selection.ids()].sort()).toEqual(["a", "b"]);

    editor.undo();
    expect(editor.store.has(id as string)).toBe(true);
  });

  test("refuses a single element", () => {
    const editor = makeEditor({ document: document([box("a", 0, "a1")]) });
    editor.selection.set(["a"]);
    expect(editor.groupSelection()).toBeNull();
    expect(editor.canUndo()).toBe(false);
  });

  test("moves, deletes and copies members through the group", () => {
    const editor = nestedEditor();
    editor.selection.set(["g2"]);
    expect(
      editor
        .movableSelection()
        .map((m) => m.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    expect(editor.nudgeSelection(10, 0)).toBe(true);
    expect(editor.store.get("a")?.visual.x).toBe(10);
    expect(editor.store.get("d")?.visual.x).toBe(600);

    expect(editor.copySelection()).toBe(true);
    const pasted = editor.paste();
    expect(pasted).toHaveLength(5);
    // Only the outer copy is selected, not every member.
    expect(editor.selection.size).toBe(1);

    editor.selection.set(["g2"]);
    editor.deleteSelection();
    for (const id of ["g2", "g1", "a", "b", "c"]) {
      expect(editor.store.has(id)).toBe(false);
    }
    expect(editor.store.has("d")).toBe(true);
  });

  test("selectAll picks top-level elements only", () => {
    const editor = nestedEditor();
    editor.selectAll();
    expect([...editor.selection.ids()].sort()).toEqual(["d", "g2"]);
  });
});
