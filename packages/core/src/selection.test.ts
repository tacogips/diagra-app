import { describe, expect, test } from "bun:test";
import { getSelectionBounds } from "./selection.ts";
import { document, element, erdFixture, makeEditor } from "./test-helpers.ts";

function twoBoxes() {
  return document([
    element({
      id: "a",
      type: "shape.geo",
      semantic: { geo: "rect" },
      visual: { x: 0, y: 0, width: 100, height: 50 },
    }),
    element({
      id: "b",
      type: "shape.geo",
      semantic: { geo: "rect" },
      index: "a2",
      visual: { x: 200, y: 100, width: 50, height: 50 },
    }),
  ]);
}

describe("selection set", () => {
  test("set, toggle and clear", () => {
    const editor = makeEditor({ document: twoBoxes() });
    editor.selection.set(["a"]);
    expect([...editor.selection.ids()]).toEqual(["a"]);
    editor.selection.toggle("b");
    expect([...editor.selection.ids()].sort()).toEqual(["a", "b"]);
    editor.selection.toggle("a");
    expect([...editor.selection.ids()]).toEqual(["b"]);
    editor.selection.clear();
    expect(editor.selection.size).toBe(0);
  });

  test("notifies subscribers and stops after unsubscribe", () => {
    const editor = makeEditor({ document: twoBoxes() });
    const seen: number[] = [];
    const unsubscribe = editor.selection.subscribe((ids) =>
      seen.push(ids.size),
    );
    editor.selection.set(["a"]);
    editor.selection.add("b");
    unsubscribe();
    editor.selection.clear();
    expect(seen).toEqual([1, 2]);
  });

  test("adding an already selected id does not re-notify", () => {
    const editor = makeEditor({ document: twoBoxes() });
    editor.selection.set(["a"]);
    let notifications = 0;
    editor.selection.subscribe(() => {
      notifications += 1;
    });
    editor.selection.add("a");
    expect(notifications).toBe(0);
  });
});

describe("pruning", () => {
  test("a deleted element leaves the selection", () => {
    const editor = makeEditor({ document: twoBoxes() });
    editor.selection.set(["a", "b"]);
    editor.deleteElements(["a"]);
    expect([...editor.selection.ids()]).toEqual(["b"]);
  });

  test("a cascaded delete prunes the cascaded ids too", () => {
    const editor = makeEditor({ document: document(erdFixture()) });
    editor.selection.set(["users", "rel"]);
    editor.deleteElements(["users"]);
    expect(editor.selection.size).toBe(0);
  });

  test("unrelated changes leave the selection alone", () => {
    const editor = makeEditor({ document: twoBoxes() });
    editor.selection.set(["a"]);
    let notifications = 0;
    editor.selection.subscribe(() => {
      notifications += 1;
    });
    editor.apply([{ type: "updateVisual", id: "b", visual: { x: 1 } }]);
    expect(notifications).toBe(0);
    expect(editor.selection.size).toBe(1);
  });
});

describe("selection bounds", () => {
  test("is null when nothing is selected", () => {
    const editor = makeEditor({ document: twoBoxes() });
    expect(editor.getSelectionBounds()).toBeNull();
  });

  test("unions the selected elements", () => {
    const editor = makeEditor({ document: twoBoxes() });
    editor.selection.set(["a", "b"]);
    expect(editor.getSelectionBounds()).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 150,
    });
  });

  test("uses derived bounds for shapes that compute their height", () => {
    const editor = makeEditor({ document: document(erdFixture()) });
    editor.selection.set(["users"]);
    // header 32 + one column row 24
    expect(editor.getSelectionBounds()).toEqual({
      x: 0,
      y: 0,
      width: 240,
      height: 56,
    });
  });

  test("skips selected elements that have no geometry", () => {
    const editor = makeEditor({
      document: document([
        ...erdFixture(),
        element({
          id: "dangling",
          type: "edge.generic",
          semantic: { from: "missing", to: "gone" },
          index: "a9",
        }),
      ]),
    });
    editor.selection.set(["dangling"]);
    expect(
      getSelectionBounds(
        editor.selection,
        editor.store,
        editor.registry,
        editor.createShapeContext(),
      ),
    ).toBeNull();
  });
});
