import { expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import { editRegionAt } from "./interaction.ts";
import { textEditorRotation } from "./text-editor-rotation.ts";

test("rotated database double-click coordinates identify title and rows", () => {
  const editor = new Editor();
  const table = editor.buildElement("erd.table", {
    semantic: {
      tableName: "users",
      columns: [
        { id: "id", name: "id", dataType: "int" },
        { id: "name", name: "name", dataType: "text" },
      ],
    },
    visual: { x: 100, y: 100, width: 200, rotation: 90 },
  });
  const box = { x: 100, y: 100, width: 200, height: 80 };
  expect(editRegionAt(table, box, { x: 230, y: 140 })).toBe("title");
  expect(editRegionAt(table, box, { x: 200, y: 140 })).toEqual({ row: 0 });
  expect(editRegionAt(table, box, { x: 176, y: 140 })).toEqual({ row: 1 });
});

test("inset text editor uses its owning layer center as rotation origin", () => {
  const editor = new Editor();
  const layer = editor.buildElement("text.note", { visual: { rotation: 45 } });
  expect(
    textEditorRotation(
      layer,
      { x: 100, y: 100, width: 200, height: 80 },
      { x: 104, y: 106 },
    ),
  ).toEqual({ transform: "rotate(45deg)", "transform-origin": "96px 34px" });
});

test("unrotated, missing and connector text editors have no rotation transform", () => {
  const editor = new Editor();
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const placement = { x: 4, y: 4 };
  expect(
    textEditorRotation(editor.buildElement("text.note"), box, placement),
  ).toEqual({});
  expect(textEditorRotation(undefined, box, placement)).toEqual({});
  expect(
    textEditorRotation(
      editor.buildElement("text.note", { visual: { rotation: 90 } }),
      null,
      placement,
    ),
  ).toEqual({});
  expect(
    textEditorRotation(
      editor.buildElement("edge.generic", {
        semantic: { from: "a", to: "b" },
        visual: { rotation: 90 },
      }),
      box,
      placement,
    ),
  ).toEqual({});
});
