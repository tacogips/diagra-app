import { expect, test } from "bun:test";
import {
  componentInstancesOnPage,
  selectComponentInstances,
} from "./component-selection.ts";
import { makeEditor } from "./test-helpers.ts";

function fixture() {
  const editor = makeEditor();
  const source = editor.createElement("frame", {
    semantic: { name: "Button", component: true },
    visual: { x: 0, y: 0, width: 100, height: 40 },
  });
  editor.createComponentInstance(source, { x: 200, y: 0 });
  const page = editor.createPage({ name: "Mobile" });
  const a = editor.createComponentInstance(source, { x: 0, y: 0 })!;
  const b = editor.createComponentInstance(source, { x: 200, y: 0 })!;
  editor.selection.set([]);
  return { editor, source, page, a, b };
}

test("instance selection is page-scoped, read-only and leaves history and camera intact", () => {
  const { editor, source, page, a, b } = fixture();
  const before = editor.getSnapshot();
  editor.camera.set({ x: 51, y: -23, z: 0.75 });
  const camera = editor.camera.get();
  expect(componentInstancesOnPage(editor).get(source)).toEqual([a, b]);
  expect(editor.selection.size).toBe(0);
  expect(selectComponentInstances(editor, source)).toBe(true);
  expect([...editor.selection.ids()]).toEqual([a, b]);
  expect(editor.currentPageId).toBe(page);
  expect(editor.camera.get()).toEqual(camera);
  expect(editor.getSnapshot()).toEqual(before);
  expect(selectComponentInstances(editor, source)).toBe(false);
  editor.undo();
  expect(editor.store.get(b)).toBeUndefined();
});

test("instance selection skips nested hidden and locked roots and revalidates changes", () => {
  const { editor, source, a, b } = fixture();
  const group = editor.createElement("group", { semantic: { memberIds: [b] } });
  for (const visual of [{ locked: true }, { locked: false, hidden: true }]) {
    editor.apply([{ type: "updateVisual", id: group, visual }]);
    expect(componentInstancesOnPage(editor).get(source)).toEqual([a]);
  }
  editor.apply([{ type: "updateVisual", id: a, visual: { locked: true } }]);
  editor.selection.set([group]);
  expect(selectComponentInstances(editor, source)).toBe(false);
  expect([...editor.selection.ids()]).toEqual([group]);
});

test("instance counts separate definitions and reject missing or detached references", () => {
  const { editor, source, a, b } = fixture();
  const other = editor.createElement("frame", {
    semantic: { name: "Button", component: true },
  });
  const otherInstance = editor.createComponentInstance(other, { x: 500, y: 0 });
  expect(componentInstancesOnPage(editor).get(source)).toEqual([a, b]);
  expect(componentInstancesOnPage(editor).get(other)).toEqual([otherInstance!]);
  expect(selectComponentInstances(editor, "missing")).toBe(false);
  editor.apply([
    {
      type: "updateSemantic",
      id: source,
      semantic: { name: "Ordinary frame" },
    },
  ]);
  expect(componentInstancesOnPage(editor).has(source)).toBe(false);
});
