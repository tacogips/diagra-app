import type { ElementId, FrameSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";

/** Editable instance roots on the active page, indexed by exact definition.
 * Nested and off-canvas instances participate, but hidden/locked trees do not.
 */
export function componentInstancesOnPage(
  editor: Editor,
): ReadonlyMap<ElementId, readonly ElementId[]> {
  const result = new Map<ElementId, ElementId[]>();
  const context = editor.createShapeContext();
  for (const element of editor.store.getPageElements(editor.currentPageId)) {
    if (
      element.type !== "frame" ||
      context.isHidden?.(element.id) ||
      context.isLocked?.(element.id)
    )
      continue;
    const sourceId = (element.semantic as FrameSemantic).instanceOf;
    if (!sourceId) continue;
    const source = editor.store.get(sourceId);
    if (
      source?.type !== "frame" ||
      (source.semantic as FrameSemantic).component !== true
    )
      continue;
    const ids = result.get(sourceId) ?? [];
    ids.push(element.id);
    result.set(sourceId, ids);
  }
  return result;
}

/** Revalidate before selecting; keep the current selection when no instances exist. */
export function selectComponentInstances(
  editor: Editor,
  sourceId: ElementId,
): boolean {
  const ids = componentInstancesOnPage(editor).get(sourceId) ?? [];
  if (
    !ids.length ||
    (editor.selection.size === ids.length &&
      ids.every((id) => editor.selection.has(id)))
  )
    return false;
  editor.selection.set(ids);
  return true;
}
