import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
  type GroupSemantic,
} from "@diagra/ir";
import { maskPolygon } from "./clipping.ts";
import type { Editor } from "./editor.ts";
import { memberIdsOf } from "./group.ts";

export function canBeMask(
  editor: Editor,
  element: Element | undefined,
): boolean {
  if (
    !element ||
    element.type === "group" ||
    getElementTypeDefinition(element.type)?.category === "edge" ||
    getElementTypeDefinition(element.type)?.category === "resource"
  )
    return false;
  return maskPolygon(element, editor.createShapeContext()) !== null;
}

export function groupMaskCandidates(
  editor: Editor,
  groupId: ElementId,
): readonly Element[] {
  const group = editor.store.get(groupId);
  if (group?.type !== "group") return [];
  return memberIdsOf(group)
    .map((id) => editor.store.get(id))
    .filter((element): element is Element => canBeMask(editor, element));
}

export function setGroupMask(
  editor: Editor,
  groupId: ElementId,
  maskId: ElementId | null,
): boolean {
  const group = editor.store.get(groupId);
  if (
    group?.type !== "group" ||
    editor.createShapeContext().isLocked?.(groupId)
  )
    return false;
  const semantic = group.semantic as GroupSemantic;
  if (maskId) {
    const mask = editor.store.get(maskId);
    if (
      !memberIdsOf(group).includes(maskId) ||
      mask?.page !== group.page ||
      !canBeMask(editor, mask)
    )
      return false;
  }
  if ((semantic.maskId ?? null) === maskId) return false;
  const { maskId: _mask, booleanOperation: _operation, ...rest } = semantic;
  editor.apply([
    {
      type: "updateSemantic",
      id: groupId,
      semantic: maskId ? { ...rest, maskId } : rest,
    },
  ]);
  return true;
}
