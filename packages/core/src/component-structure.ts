import type { Element, ElementId, FrameSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { compareFractional } from "./fractional.ts";
import { expandContainers, frameParents } from "./frame-tree.ts";
import { memberIdsOf } from "./group.ts";

function explicitMembers(element: Element): readonly ElementId[] | null {
  if (element.type === "group") return memberIdsOf(element);
  if (element.type !== "frame") return null;
  const members = (element.semantic as FrameSemantic).memberIds;
  return Array.isArray(members) ? members : null;
}

function sameIds(left: readonly ElementId[], right: readonly ElementId[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/**
 * Check only source-owned structure. Unbound instance-local layers are ignored.
 * `null` means the tracking data is unsafe to reconcile automatically.
 */
export function componentStructureMatches(
  editor: Editor,
  instanceId: ElementId,
): boolean | null {
  const instance = editor.store.get(instanceId);
  const semantic =
    instance?.type === "frame"
      ? (instance.semantic as FrameSemantic)
      : undefined;
  const source = semantic?.instanceOf
    ? editor.store.get(semantic.instanceOf)
    : undefined;
  if (
    !instance ||
    !semantic?.instanceBindings?.length ||
    source?.type !== "frame" ||
    !(source.semantic as FrameSemantic).component
  )
    return null;
  const context = editor.createShapeContext();
  const sourceIds = expandContainers(editor.store, [source.id], context);
  const targetIds = new Set(
    expandContainers(editor.store, [instance.id], context),
  );
  if (sourceIds.includes(instance.id) || targetIds.has(source.id)) return null;

  const mapping = new Map<ElementId, ElementId>();
  const reverse = new Set<ElementId>();
  for (const binding of semantic.instanceBindings) {
    if (!binding.source || !binding.target) return false;
    const original = editor.store.get(binding.source);
    const target = editor.store.get(binding.target);
    if (!original || !target) return false;
    if (
      !sourceIds.includes(original.id) ||
      !targetIds.has(target.id) ||
      original.type !== target.type
    )
      return false;
    if (mapping.has(original.id) || reverse.has(target.id)) return null;
    try {
      const baseline = JSON.parse(binding.baseline);
      if (!baseline || typeof baseline !== "object") return null;
    } catch {
      return null;
    }
    mapping.set(original.id, target.id);
    reverse.add(target.id);
  }
  if (
    mapping.size !== sourceIds.length ||
    mapping.get(source.id) !== instance.id
  )
    return false;

  const sourceParents = frameParents(editor.store, source.page, context);
  const targetParents = frameParents(editor.store, instance.page, context);
  for (const sourceId of sourceIds) {
    const targetId = mapping.get(sourceId);
    if (!targetId) return false;
    const sourceParent = sourceParents.get(sourceId);
    const targetParent = targetParents.get(targetId);
    const expectedParent = sourceParent ? mapping.get(sourceParent) : undefined;
    const currentParent =
      targetParent && reverse.has(targetParent) ? targetParent : undefined;
    if (expectedParent !== currentParent) return false;
    const original = editor.store.get(sourceId);
    const target = editor.store.get(targetId);
    if (!original || !target) return false;
    const members = explicitMembers(original);
    if (members) {
      const expected = members.flatMap((id) => {
        const mapped = mapping.get(id);
        return mapped ? [mapped] : [];
      });
      const current = (explicitMembers(target) ?? []).filter((id) =>
        reverse.has(id),
      );
      if (!sameIds(expected, current)) return false;
    }
  }

  const sourceOrder = [...sourceIds].sort((left, right) =>
    compareFractional(
      editor.store.get(left)?.index ?? "",
      editor.store.get(right)?.index ?? "",
    ),
  );
  const targetOrder = [...mapping.values()].sort((left, right) =>
    compareFractional(
      editor.store.get(left)?.index ?? "",
      editor.store.get(right)?.index ?? "",
    ),
  );
  return sameIds(
    sourceOrder.map((id) => mapping.get(id) ?? ""),
    targetOrder,
  );
}
