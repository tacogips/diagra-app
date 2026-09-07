import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { frameParents } from "./frame-tree.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

function fixture() {
  return makeEditor({
    document: document([
      element({
        id: "outer",
        type: "frame",
        index: "a1",
        semantic: { name: "Outer" },
        visual: { x: 0, y: 0, width: 500, height: 800 },
      }),
      element({
        id: "inner",
        type: "frame",
        index: "a2",
        semantic: { name: "Inner" },
        visual: { x: 20, y: 30, width: 300, height: 400 },
      }),
      element({
        id: "one",
        type: "node.generic",
        index: "a3",
        semantic: { label: "One" },
        visual: { x: 50, y: 60, width: 100, height: 30 },
      }),
      element({
        id: "two",
        type: "node.generic",
        index: "a4",
        semantic: { label: "Two" },
        visual: { x: 50, y: 110, width: 100, height: 30 },
      }),
    ]),
  });
}
test("duplicate remains next to its source in auto layout with one undo step", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "inner",
      semantic: {
        name: "Inner",
        memberIds: ["one", "two"],
        layout: {
          direction: "vertical",
          gap: 10,
          padding: 20,
          sizing: "fixed",
          align: "start",
        },
      },
    },
  ]);
  const before = editor.getSnapshot();
  editor.selection.set(["one"]);
  const [copy] = editor.duplicateSelection();
  if (!copy) throw new Error("missing copy");
  expect(
    (editor.store.get("inner")?.semantic as FrameSemantic).memberIds,
  ).toEqual(["one", copy, "two"]);
  expect(editor.getBounds(copy)?.y).toBe(90);
  expect(editor.getBounds("two")?.y).toBe(130);
  const after = editor.getSnapshot();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.redo();
  expect(editor.getSnapshot()).toEqual(after);
});
test("duplicate pins legacy parent membership without moving original layers", () => {
  const editor = fixture();
  editor.selection.set(["one", "two"]);
  const copies = editor.duplicateSelection();
  expect(
    (editor.store.get("inner")?.semantic as FrameSemantic).memberIds,
  ).toEqual(["one", copies[0], "two", copies[1]]);
  expect(editor.getBounds("one")?.y).toBe(60);
  expect(editor.getBounds("two")?.y).toBe(110);
  for (const copy of copies)
    expect(
      frameParents(
        editor.store,
        editor.currentPageId,
        editor.createShapeContext(),
      ).get(copy),
    ).toBe("inner");
});

test("duplicate rejects locked parent and read-only edits without creating orphan copies", () => {
  const editor = fixture();
  editor.apply([
    { type: "updateVisual", id: "inner", visual: { locked: true } },
  ]);
  editor.selection.set(["one"]);
  const before = editor.getSnapshot();
  expect(editor.duplicateSelection()).toEqual([]);
  expect(editor.getSnapshot()).toEqual(before);
  editor.setReadOnly(true);
  editor.selection.set(["outer"]);
  expect(editor.duplicateSelection()).toEqual([]);
  expect(editor.getSnapshot()).toEqual(before);
});

test("duplicating a nested frame attaches only the copied root to its original parent", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "inner",
      semantic: { name: "Inner", memberIds: ["one", "two"] },
    },
  ]);
  editor.selection.set(["inner"]);
  const copies = editor.duplicateSelection();
  const copiedFrame = copies.find(
    (id) => editor.store.get(id)?.type === "frame",
  );
  if (!copiedFrame) throw new Error("missing frame");
  expect(
    (editor.store.get("outer")?.semantic as FrameSemantic).memberIds,
  ).toEqual(["inner", copiedFrame]);
  const children =
    (editor.store.get(copiedFrame)?.semantic as FrameSemantic).memberIds ?? [];
  expect(children).toHaveLength(2);
  const parents = frameParents(
    editor.store,
    editor.currentPageId,
    editor.createShapeContext(),
  );
  for (const child of children) expect(parents.get(child)).toBe(copiedFrame);
});

test("detaching nested content pins legacy membership without changing coordinates", () => {
  const editor = fixture();
  const before = editor.getSnapshot();
  expect(editor.reparentElement("one", null)).toBe(true);
  expect(
    frameParents(
      editor.store,
      editor.currentPageId,
      editor.createShapeContext(),
    ).has("one"),
  ).toBe(false);
  expect(editor.getBounds("one")?.x).toBe(50);
  expect(
    (editor.store.get("inner")?.semantic as FrameSemantic).memberIds,
  ).toEqual(["two"]);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});
test("reparent to auto layout and change order reflows in one undo step", () => {
  const editor = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id: "inner",
      semantic: {
        name: "Inner",
        memberIds: ["two"],
        layout: {
          direction: "vertical",
          gap: 10,
          padding: 20,
          sizing: "fixed",
          align: "start",
        },
      },
    },
  ]);
  expect(editor.reparentElement("one", "inner")).toBe(true);
  expect(editor.getBounds("one")?.y).toBe(90);
  expect(editor.reorderFrameMember("one", -1)).toBe(true);
  expect(editor.getBounds("one")?.y).toBe(50);
  expect(editor.getBounds("two")?.y).toBe(90);
  editor.undo();
  expect(editor.getBounds("one")?.y).toBe(90);
});
test("cycles, self-parenting, missing parents and locked changes are rejected", () => {
  const editor = fixture();
  expect(editor.reparentElement("outer", "inner")).toBe(false);
  expect(editor.reparentElement("inner", "inner")).toBe(false);
  expect(editor.reparentElement("one", "missing")).toBe(false);
  editor.apply([
    { type: "updateVisual", id: "inner", visual: { locked: true } },
  ]);
  expect(editor.reparentElement("one", "outer")).toBe(false);
});
test("group members stay together when the group is reparented", () => {
  const editor = fixture();
  editor.selection.set(["one", "two"]);
  editor.groupSelection();
  const group = [...editor.selection.ids()][0];
  if (!group) throw new Error("expected group");
  expect(editor.reparentElement("one", null)).toBe(false);
  expect(editor.reparentElement(group, null)).toBe(true);
  const parents = frameParents(
    editor.store,
    editor.currentPageId,
    editor.createShapeContext(),
  );
  expect(parents.has("one")).toBe(false);
  expect(parents.has("two")).toBe(false);
  expect(editor.store.has("one")).toBe(true);
  expect(editor.store.has("two")).toBe(true);
});
