import { expect, test } from "bun:test";
import { CommandError } from "./commands.ts";
import { makeEditor } from "./test-helpers.ts";

test("direct width and height edits preserve a stored aspect ratio", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: {
      x: 10,
      y: 20,
      width: 120,
      height: 60,
      aspectRatio: 2,
      numberTokens: { width: "width-token", height: "height-token" },
    },
  });
  editor.apply([{ type: "createElement", element: shape }]);

  editor.resizeElement(shape.id, { x: 10, y: 20, width: 200, height: 60 });
  expect(editor.store.get(shape.id)?.visual).toMatchObject({
    width: 200,
    height: 100,
    aspectRatio: 2,
  });
  expect(editor.store.get(shape.id)?.visual.numberTokens).toBeUndefined();

  editor.resizeElement(shape.id, { x: 10, y: 20, width: 200, height: 150 });
  expect(editor.getBounds(shape.id)).toEqual({
    x: 10,
    y: 20,
    width: 300,
    height: 150,
  });
});

test("command validation rejects invalid and infeasible aspect ratios", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo");
  editor.apply([{ type: "createElement", element: shape }]);
  expect(() =>
    editor.apply([
      { type: "updateVisual", id: shape.id, visual: { aspectRatio: 0 } },
    ]),
  ).toThrow(CommandError);
  expect(() =>
    editor.apply([
      {
        type: "updateVisual",
        id: shape.id,
        visual: { aspectRatio: 2, minWidth: 300, maxHeight: 100 },
      },
    ]),
  ).toThrow(CommandError);
});
