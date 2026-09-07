import type { Element, ElementId, FrameSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { frameParents } from "./frame-tree.ts";
import { groupOf, memberIdsOf } from "./group.ts";

const OMITTED_INTERFACE_TYPES = new Set([
  "design.token",
  "review.comment",
  "design.text-style",
  "edge.generic",
  "erd.relation",
  "uml.association",
  "sequence.message",
]);

export interface InterfaceTree {
  readonly root: Element;
  readonly included: readonly Element[];
  readonly includedIds: ReadonlySet<ElementId>;
  readonly omitted: readonly Element[];
  readonly parents: ReadonlyMap<ElementId, ElementId>;
  readonly childrenOf: (parent: Element) => readonly Element[];
}

/** Shared visible artboard hierarchy for web and native code generation. */
export function collectInterfaceTree(
  editor: Editor,
  rootId: ElementId,
): InterfaceTree | null {
  const root = editor.store.get(rootId);
  if (root?.type !== "frame") return null;
  const context = editor.createShapeContext();
  const pageElements = editor.store.getPageElements(root.page);
  const frameParent = frameParents(editor.store, root.page, context);
  const parents = new Map<ElementId, ElementId>();
  for (const element of pageElements) {
    if (element.id === root.id) continue;
    const group = groupOf(editor.store, element.id);
    const parent = group?.id ?? frameParent.get(element.id);
    if (parent) parents.set(element.id, parent);
  }
  const children = new Map<ElementId, Element[]>();
  for (const element of pageElements) {
    const parent = parents.get(element.id);
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(element);
    children.set(parent, list);
  }
  const childrenOf = (parent: Element): readonly Element[] => {
    const available = children.get(parent.id) ?? [];
    const order =
      parent.type === "frame"
        ? (parent.semantic as FrameSemantic).memberIds
        : memberIdsOf(parent);
    if (!order) return available;
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...available].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  };
  const included: Element[] = [];
  const includedIds = new Set<ElementId>();
  const omitted: Element[] = [];
  const seen = new Set<ElementId>();
  const visit = (element: Element): void => {
    if (seen.has(element.id)) return;
    seen.add(element.id);
    if (context.isHidden?.(element.id)) return;
    if (
      OMITTED_INTERFACE_TYPES.has(element.type) ||
      context.isMaskSource?.(element.id)
    ) {
      omitted.push(element);
      return;
    }
    included.push(element);
    includedIds.add(element.id);
    for (const child of childrenOf(element)) visit(child);
  };
  visit(root);
  return { root, included, includedIds, omitted, parents, childrenOf };
}
