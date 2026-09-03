// DOM-free tests for the action table's enabled rules.
//
// The rules are what the menus and toolbars show as greyed out, so they are
// pinned here against a real Editor rather than a mock: an action must be
// enabled exactly when running it would change something.

import { describe, expect, test } from "bun:test";
import { createDefaultRegistry, Editor } from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import {
  type ActionContext,
  type ActionId,
  actionTitle,
  EDITOR_ACTIONS,
  getAction,
  runAction,
} from "./shortcuts.ts";

function makeContext(editor: Editor): ActionContext & {
  readonly edited: ElementId[];
  readonly exports: number[];
} {
  const edited: ElementId[] = [];
  const exports: number[] = [];
  return {
    editor,
    viewport: { width: 800, height: 600 },
    requestEdit: (id) => {
      edited.push(id);
    },
    exportSvg: () => {
      exports.push(1);
    },
    edited,
    exports,
  };
}

function rect(editor: Editor, x: number, y: number): ElementId {
  return editor.createElement("shape.geo", {
    visual: { x, y, width: 100, height: 60 },
    semantic: { geo: "rect", label: "" },
  });
}

function enabled(editor: Editor, id: ActionId): boolean {
  return getAction(id).enabled(makeContext(editor));
}

describe("action table", () => {
  test("every id resolves and titles carry the shortcut", () => {
    for (const action of EDITOR_ACTIONS) {
      expect(getAction(action.id)).toBe(action);
      if (action.shortcut) {
        expect(actionTitle(action)).toBe(
          `${action.label} (${action.shortcut})`,
        );
      } else {
        expect(actionTitle(action)).toBe(action.label);
      }
    }
    expect(() => getAction("nope" as ActionId)).toThrow();
  });

  test("selection-bound actions follow the selection", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    for (const id of ["cut", "copy", "duplicate", "delete"] as const) {
      expect(enabled(editor, id)).toBe(false);
    }
    expect(enabled(editor, "selectAll")).toBe(false);
    expect(enabled(editor, "zoomFit")).toBe(false);
    expect(enabled(editor, "exportSvg")).toBe(false);

    const a = rect(editor, 0, 0);
    expect(enabled(editor, "selectAll")).toBe(true);
    expect(enabled(editor, "zoomFit")).toBe(true);
    expect(enabled(editor, "exportSvg")).toBe(true);
    expect(enabled(editor, "delete")).toBe(false);

    editor.selection.set([a]);
    for (const id of ["cut", "copy", "duplicate", "delete"] as const) {
      expect(enabled(editor, id)).toBe(true);
    }
    expect(enabled(editor, "zoomSelection")).toBe(true);
  });

  test("paste needs a clipboard payload", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const a = rect(editor, 0, 0);
    expect(enabled(editor, "paste")).toBe(false);
    editor.selection.set([a]);
    expect(runAction(getAction("copy"), makeContext(editor))).toBe(true);
    expect(enabled(editor, "paste")).toBe(true);
  });

  test("align needs two units, distribute three, ungroup a group", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const a = rect(editor, 0, 0);
    const b = rect(editor, 200, 50);
    const c = rect(editor, 400, 100);

    editor.selection.set([a]);
    expect(enabled(editor, "alignLeft")).toBe(false);
    expect(enabled(editor, "group")).toBe(false);
    expect(enabled(editor, "matchWidth")).toBe(false);

    editor.selection.set([a, b]);
    expect(enabled(editor, "alignLeft")).toBe(true);
    expect(enabled(editor, "matchWidth")).toBe(true);
    expect(enabled(editor, "group")).toBe(true);
    expect(enabled(editor, "distributeHorizontal")).toBe(false);
    expect(enabled(editor, "ungroup")).toBe(false);

    editor.selection.set([a, b, c]);
    expect(enabled(editor, "distributeHorizontal")).toBe(true);

    editor.selection.set([a, b]);
    expect(runAction(getAction("group"), makeContext(editor))).toBe(true);
    expect(enabled(editor, "ungroup")).toBe(true);
    // A single group is one unit: nothing to align it against.
    expect(enabled(editor, "alignLeft")).toBe(false);
    expect(enabled(editor, "group")).toBe(false);
  });

  test("edit text needs exactly one editable element", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const a = rect(editor, 0, 0);
    const b = rect(editor, 200, 0);
    expect(enabled(editor, "editText")).toBe(false);
    editor.selection.set([a, b]);
    expect(enabled(editor, "editText")).toBe(false);
    editor.selection.set([a]);
    expect(enabled(editor, "editText")).toBe(true);

    const context = makeContext(editor);
    expect(runAction(getAction("editText"), context)).toBe(true);
    expect(context.edited).toEqual([a]);
  });

  test("zoom actions track the camera", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    expect(enabled(editor, "zoomReset")).toBe(false);
    expect(enabled(editor, "zoomIn")).toBe(true);
    expect(enabled(editor, "zoomOut")).toBe(true);

    const context = makeContext(editor);
    runAction(getAction("zoomIn"), context);
    expect(editor.camera.get().z).toBe(1.25);
    expect(enabled(editor, "zoomReset")).toBe(true);

    editor.camera.zoomTo(8, { x: 0, y: 0 });
    expect(enabled(editor, "zoomIn")).toBe(false);
    editor.camera.zoomTo(0.1, { x: 0, y: 0 });
    expect(enabled(editor, "zoomOut")).toBe(false);
  });

  test("a disabled action does not run", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const context = makeContext(editor);
    expect(runAction(getAction("exportSvg"), context)).toBe(false);
    expect(context.exports).toEqual([]);
    rect(editor, 0, 0);
    expect(runAction(getAction("exportSvg"), context)).toBe(true);
    expect(context.exports).toEqual([1]);
  });
});
