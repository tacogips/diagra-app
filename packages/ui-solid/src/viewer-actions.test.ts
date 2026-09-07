import { expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import {
  EDITOR_ACTIONS,
  getAction,
  runAction,
  type ActionContext,
} from "./shortcuts.ts";
import { canUseTool, TOOLS } from "./tools.ts";

test("viewer actions disable authoring but retain copy, selection, zoom and export", () => {
  const editor = new Editor();
  const id = editor.createElement("shape.geo", {
    semantic: { geo: "rect", label: "Button" },
    visual: { x: 0, y: 0, width: 100, height: 40, style: { fill: "#123456" } },
  });
  editor.selection.set([id]);
  editor.copySelection();
  let exports = 0;
  let edits = 0;
  const context: ActionContext = {
    editor,
    viewport: { width: 800, height: 600 },
    requestEdit: () => {
      edits++;
    },
    exportSvg: () => {
      exports++;
    },
  };
  editor.setReadOnly(true);
  const before = editor.getSnapshot();
  const allowed = new Set([
    "copy",
    "copyStyle",
    "selectAll",
    "selectSameType",
    "selectSameName",
    "selectSameFill",
    "selectSameStroke",
    "zoomIn",
    "zoomOut",
    "zoomReset",
    "zoomFit",
    "zoomSelection",
    "exportSvg",
  ]);
  for (const action of EDITOR_ACTIONS) {
    if (allowed.has(action.id)) continue;
    expect(action.enabled(context)).toBe(false);
    expect(runAction(action, context)).toBe(false);
  }
  for (const id of [
    "copy",
    "copyStyle",
    "selectAll",
    "zoomIn",
    "exportSvg",
  ] as const)
    expect(runAction(getAction(id), context)).toBe(true);
  expect(exports).toBe(1);
  expect(edits).toBe(0);
  expect(editor.getSnapshot()).toEqual(before);
  editor.setReadOnly(false);
  expect(getAction("duplicate").enabled(context)).toBe(true);
  expect(getAction("editText").enabled(context)).toBe(true);
});

test("viewer tool policy allows only select and hand", () => {
  for (const tool of TOOLS) {
    expect(canUseTool(tool, false)).toBe(true);
    expect(canUseTool(tool, true)).toBe(tool === "select" || tool === "hand");
  }
});
