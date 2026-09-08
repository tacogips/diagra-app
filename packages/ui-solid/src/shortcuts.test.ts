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
  test("matching layer actions require one source and another eligible match", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const a = rect(editor, 0, 0);
    editor.selection.set([a]);
    expect(enabled(editor, "selectSameType")).toBe(false);
    const b = rect(editor, 200, 0);
    expect(enabled(editor, "selectSameType")).toBe(true);
    expect(enabled(editor, "selectSameName")).toBe(true);
    expect(runAction(getAction("selectSameType"), makeContext(editor))).toBe(
      true,
    );
    expect([...editor.selection.ids()]).toEqual([a, b]);
    expect(enabled(editor, "selectSameName")).toBe(false);
    editor.selection.set([a]);
    editor.apply([{ type: "updateVisual", id: b, visual: { locked: true } }]);
    expect(enabled(editor, "selectSameType")).toBe(false);
    expect(runAction(getAction("selectSameName"), makeContext(editor))).toBe(
      false,
    );
    expect([...editor.selection.ids()]).toEqual([a]);
  });

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
    expect(enabled(editor, "frameSelection")).toBe(true);
    for (const id of ["cut", "copy", "duplicate", "delete"] as const) {
      expect(enabled(editor, id)).toBe(true);
    }
    expect(enabled(editor, "zoomSelection")).toBe(true);
  });

  test("frame selection action fits one or more sibling layers", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const a = rect(editor, 0, 0);
    const b = rect(editor, 200, 0);
    // Creation order, not selection order, defines the base and operands.
    editor.selection.set([b, a]);
    const context = makeContext(editor);
    expect(runAction(getAction("frameSelection"), context)).toBe(true);
    const [frame] = editor.selection.ids();
    expect(editor.store.get(frame as ElementId)?.type).toBe("frame");
    expect(enabled(editor, "frameSelection")).toBe(true);
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

  test("Boolean actions create an editable operation group from shape outlines", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const a = rect(editor, 0, 0);
    const b = rect(editor, 50, 0);
    editor.selection.set([a, b]);
    expect(enabled(editor, "booleanSubtract")).toBe(true);
    expect(runAction(getAction("booleanSubtract"), makeContext(editor))).toBe(
      true,
    );
    const group = editor.store.get([...editor.selection.ids()][0] ?? "");
    expect(group?.type).toBe("group");
    expect(group?.semantic).toEqual({
      memberIds: [a, b],
      booleanOperation: "subtract",
    });
    expect(enabled(editor, "booleanUnion")).toBe(false);
    expect(enabled(editor, "flattenBoolean")).toBe(true);
    expect(runAction(getAction("flattenBoolean"), makeContext(editor))).toBe(
      true,
    );
    expect(editor.store.get([...editor.selection.ids()][0] ?? "")?.type).toBe(
      "draw.path",
    );
    expect(enabled(editor, "flattenBoolean")).toBe(false);
  });

  test("Boolean actions accept solid and dashed open strokes", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const shape = rect(editor, 40, -20);
    const stroke = editor.createElement("draw.freehand", {
      semantic: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      visual: { style: { strokeWidth: 16, strokeCap: "round" } },
    });
    editor.selection.set([stroke, shape]);
    expect(enabled(editor, "booleanUnion")).toBe(true);
    const dashed = editor.createElement("draw.freehand", {
      semantic: {
        points: [
          { x: 0, y: 30 },
          { x: 100, y: 30 },
        ],
      },
      visual: { style: { strokeWidth: 16, dash: "dashed" } },
    });
    editor.selection.set([dashed, shape]);
    expect(enabled(editor, "booleanUnion")).toBe(true);
  });

  test("Boolean flatten is disabled for an empty geometric result", () => {
    const editor = new Editor({ registry: createDefaultRegistry() });
    const a = rect(editor, 0, 0);
    const b = rect(editor, 0, 0);
    editor.selection.set([a, b]);
    editor.booleanSelection("subtract");
    expect(enabled(editor, "flattenBoolean")).toBe(false);
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
