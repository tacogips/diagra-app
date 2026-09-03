import { describe, expect, test } from "bun:test";
import type { Editor } from "./editor.ts";
import { document, element, makeEditor } from "./test-helpers.ts";

function box(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
  index = id,
) {
  return element({
    id,
    type: "shape.geo",
    index,
    semantic: { geo: "rect" },
    visual: { x, y, width, height },
  });
}

function threeBoxes(): Editor {
  const editor = makeEditor({
    document: document([
      box("a", 0, 0, 100, 50, "a1"),
      box("b", 250, 100, 50, 80, "a2"),
      box("c", 600, 20, 100, 20, "a3"),
    ]),
  });
  editor.selection.set(["a", "b", "c"]);
  return editor;
}

const x = (editor: Editor, id: string) => editor.store.get(id)?.visual.x;
const y = (editor: Editor, id: string) => editor.store.get(id)?.visual.y;

describe("alignSelection", () => {
  test("left, right and centre along x", () => {
    let editor = threeBoxes();
    expect(editor.alignSelection("left")).toBe(true);
    expect([x(editor, "a"), x(editor, "b"), x(editor, "c")]).toEqual([0, 0, 0]);

    editor = threeBoxes();
    editor.alignSelection("right");
    expect([x(editor, "a"), x(editor, "b"), x(editor, "c")]).toEqual([
      600, 650, 600,
    ]);

    editor = threeBoxes();
    editor.alignSelection("hcenter");
    // Extent 0..700, centre 350.
    expect([x(editor, "a"), x(editor, "b"), x(editor, "c")]).toEqual([
      300, 325, 300,
    ]);
  });

  test("top, bottom and middle along y", () => {
    let editor = threeBoxes();
    editor.alignSelection("top");
    expect([y(editor, "a"), y(editor, "b"), y(editor, "c")]).toEqual([0, 0, 0]);

    editor = threeBoxes();
    editor.alignSelection("bottom");
    // Extent 0..180.
    expect([y(editor, "a"), y(editor, "b"), y(editor, "c")]).toEqual([
      130, 100, 160,
    ]);

    editor = threeBoxes();
    editor.alignSelection("vcenter");
    expect([y(editor, "a"), y(editor, "b"), y(editor, "c")]).toEqual([
      65, 50, 80,
    ]);
  });

  test("is one undo step and a no-op below two units", () => {
    const editor = threeBoxes();
    editor.alignSelection("left");
    editor.undo();
    expect(x(editor, "b")).toBe(250);
    editor.selection.set(["a"]);
    expect(editor.alignSelection("left")).toBe(false);
  });

  test("treats a group as one unit", () => {
    const editor = makeEditor({
      document: document([
        box("a", 0, 0, 100, 50, "a1"),
        box("b", 200, 0, 100, 50, "a2"),
        element({
          id: "g",
          type: "group",
          index: "a3",
          semantic: { memberIds: ["a", "b"] },
        }),
        box("c", 1000, 300, 100, 50, "a4"),
      ]),
    });
    editor.selection.set(["g", "c"]);
    editor.alignSelection("right");
    // Group spans 0..300; right edge of extent is 1100, so it shifts by 800.
    expect(x(editor, "a")).toBe(800);
    expect(x(editor, "b")).toBe(1000);
    expect(x(editor, "c")).toBe(1000);
  });
});

describe("distributeSelection", () => {
  test("spaces the middle units evenly, keeping the ends", () => {
    const editor = threeBoxes();
    expect(editor.distributeSelection("horizontal")).toBe(true);
    // Span 0..700, sizes 100+50+100 = 250, gap = 450 / 2 = 225.
    expect(x(editor, "a")).toBe(0);
    expect(x(editor, "b")).toBe(325);
    expect(x(editor, "c")).toBe(600);
  });

  test("needs three units", () => {
    const editor = threeBoxes();
    editor.selection.set(["a", "b"]);
    expect(editor.distributeSelection("vertical")).toBe(false);
  });
});

describe("matchSelectionSize", () => {
  test("gives the others the first element's size", () => {
    const editor = threeBoxes();
    expect(editor.matchSelectionSize("both")).toBe(true);
    expect(editor.store.get("b")?.visual).toMatchObject({
      width: 100,
      height: 50,
    });
    expect(editor.store.get("c")?.visual).toMatchObject({
      width: 100,
      height: 50,
    });
  });

  test("width only leaves heights alone", () => {
    const editor = threeBoxes();
    editor.matchSelectionSize("width");
    expect(editor.store.get("b")?.visual).toMatchObject({
      width: 100,
      height: 80,
    });
  });
});
