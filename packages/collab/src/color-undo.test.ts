import { expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import { captureColors, type ColorUndo } from "./color-undo.ts";

test("merged color edits retain the oldest literal and latest binding", () => {
  const editor = new Editor();
  const original = editor.buildElement("shape.geo", {
    visual: { style: { fill: "#111111" } },
  });
  const changed = { ...original, visual: { style: { fill: "#222222" } } };
  const bound = {
    ...changed,
    visual: { style: { fill: "#333333" }, colorTokens: { fill: "brand" } },
  };
  const records = new Map<string, ColorUndo>();
  captureColors(records, original, changed);
  captureColors(records, changed, bound);
  expect([...records.values()]).toEqual([
    {
      id: original.id,
      field: "fill",
      beforeToken: undefined,
      beforeValue: "#111111",
      afterToken: "brand",
    },
  ]);
});
