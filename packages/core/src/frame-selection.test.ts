import { describe, expect, test } from "bun:test";
import type { FrameSemantic, GroupSemantic } from "@diagra/ir";
import { frameParents } from "./frame-tree.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

function shape(id: string, index: string, x: number, rotation = 0) {
  return element({
    id,
    type: "shape.geo",
    index,
    semantic: { geo: "rect" },
    visual: {
      x,
      y: 0,
      width: 100,
      height: 50,
      ...(rotation ? { rotation } : {}),
    },
  });
}

describe("frame selection", () => {
  test("fits oriented geometry, stays below contents, and undoes atomically", () => {
    const editor = makeEditor({
      document: document([
        shape("rotated", "a2", 0, 90),
        shape("plain", "a3", 200),
      ]),
    });
    editor.selection.set(["rotated", "plain"]);
    const before = editor.getSnapshot();

    const id = editor.frameSelection();
    expect(id).toBe("el-1");
    if (!id) throw new Error("expected frame");
    expect(editor.store.get(id)).toMatchObject({
      type: "frame",
      semantic: { name: "Frame", memberIds: ["rotated", "plain"] },
      visual: { x: 25, y: -25, width: 275, height: 100 },
    });
    expect(
      editor.store.getPageElements(editor.currentPageId).map((item) => item.id),
    ).toEqual([id, "rotated", "plain"]);
    expect([...editor.selection.ids()]).toEqual([id]);
    const parents = frameParents(
      editor.store,
      editor.currentPageId,
      editor.createShapeContext(),
    );
    expect(parents.get("rotated")).toBe(id);
    expect(parents.get("plain")).toBe(id);
    const framed = editor.getSnapshot();
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()).toEqual(before);
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()).toEqual(framed);
  });

  test("wraps one layer and reduces a selected frame descendant", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "inner",
          type: "frame",
          index: "a1",
          semantic: { name: "Inner", memberIds: ["child"] },
          visual: { x: 10, y: 20, width: 100, height: 80 },
        }),
        shape("child", "a2", 20),
      ]),
    });
    editor.selection.set(["inner", "child"]);
    const id = editor.frameSelection();
    expect(id).not.toBeNull();
    if (!id) throw new Error("expected frame");
    expect((editor.store.get(id)?.semantic as FrameSemantic).memberIds).toEqual(
      ["inner"],
    );
  });

  test("replaces siblings inside explicit and legacy frame parents", () => {
    for (const explicit of [false, true]) {
      const editor = makeEditor({
        document: document([
          element({
            id: "outer",
            type: "frame",
            index: "a1",
            semantic: {
              name: "Outer",
              ...(explicit ? { memberIds: ["a", "b"] } : {}),
            },
            visual: { x: 0, y: 0, width: 400, height: 200 },
          }),
          shape("a", "a2", 20),
          shape("b", "a3", 160),
        ]),
      });
      editor.selection.set(["a", "b"]);
      const id = editor.frameSelection();
      expect(id).not.toBeNull();
      if (!id) throw new Error("expected frame");
      expect(
        (editor.store.get("outer")?.semantic as FrameSemantic).memberIds,
      ).toEqual([id]);
      const parents = frameParents(
        editor.store,
        editor.currentPageId,
        editor.createShapeContext(),
      );
      expect(parents.get(id)).toBe("outer");
      expect(parents.get("a")).toBe(id);
      expect(parents.get("b")).toBe(id);
    }
  });

  test("replaces selected members without disturbing a group sibling", () => {
    const editor = makeEditor({
      document: document([
        shape("a", "a1", 0),
        shape("b", "a2", 120),
        shape("c", "a3", 240),
        element({
          id: "group",
          type: "group",
          index: "a4",
          semantic: { memberIds: ["a", "b", "c"] },
        }),
      ]),
    });
    editor.selection.set(["a", "b"]);
    const id = editor.frameSelection();
    expect(id).not.toBeNull();
    if (!id) throw new Error("expected frame");
    expect(
      (editor.store.get("group")?.semantic as GroupSemantic).memberIds,
    ).toEqual([id, "c"]);
  });

  test("rejects mixed parents, missing geometry, and locked parents", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "parent",
          type: "frame",
          index: "a1",
          semantic: { name: "Parent", memberIds: ["inside"] },
          visual: { x: 0, y: 0, width: 150, height: 100 },
        }),
        shape("inside", "a2", 10),
        shape("outside", "a3", 300),
        element({
          id: "resource",
          type: "design.token",
          index: "a4",
          semantic: { name: "Space", kind: "number", value: 8 },
        }),
      ]),
    });
    const before = editor.getSnapshot();
    editor.selection.set(["inside", "outside"]);
    expect(editor.canFrameSelection()).toBe(false);
    expect(editor.frameSelection()).toBeNull();
    editor.selection.set(["resource"]);
    expect(editor.frameSelection()).toBeNull();
    editor.apply([
      { type: "updateVisual", id: "parent", visual: { locked: true } },
    ]);
    const locked = editor.getSnapshot();
    editor.selection.set(["inside"]);
    expect(editor.frameSelection()).toBeNull();
    expect(editor.getSnapshot()).toEqual(locked);
    expect(before.elements).toHaveLength(4);
  });

  test("renumbers hostile z-order keys while preserving visual stacking", () => {
    const editor = makeEditor({
      document: document([
        shape("a", "foreign one", 0),
        shape("b", "foreign two", 120),
      ]),
    });
    editor.selection.set(["a", "b"]);
    const id = editor.frameSelection();
    expect(id).not.toBeNull();
    if (!id) throw new Error("expected frame");
    expect(
      editor.store.getPageElements(editor.currentPageId).map((item) => item.id),
    ).toEqual([id, "a", "b"]);
  });
});
