// The two writes every Inspector section makes, with the no-op guard.
//
// A rejected command (an empty table name, say) is not an error the user
// caused on purpose; it is swallowed here and the control that made it
// resets to the document's value.

import { CommandError, type Editor } from "@diagra/core";
import type { ElementId, Visual } from "@diagra/ir";

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** One `updateSemantic` carrying the whole payload. False when unchanged or rejected. */
export function writeSemantic(
  editor: Editor,
  id: ElementId,
  semantic: unknown,
): boolean {
  const element = editor.store.get(id);
  if (!element || same(element.semantic, semantic)) {
    return false;
  }
  try {
    editor.apply([{ type: "updateSemantic", id, semantic }]);
    return true;
  } catch (error) {
    if (error instanceof CommandError) {
      return false;
    }
    throw error;
  }
}

/** One `updateVisual` merge. False when nothing would change or it is rejected. */
export function writeVisual(
  editor: Editor,
  id: ElementId,
  visual: Partial<Visual>,
): boolean {
  const element = editor.store.get(id);
  if (!element || same({ ...element.visual, ...visual }, element.visual)) {
    return false;
  }
  try {
    editor.apply([{ type: "updateVisual", id, visual }]);
    return true;
  } catch (error) {
    if (error instanceof CommandError) {
      return false;
    }
    throw error;
  }
}
