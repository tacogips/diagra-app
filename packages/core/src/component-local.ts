import type { Element, ElementId, FrameSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { frameParents } from "./frame-tree.ts";
import { groupOf } from "./group.ts";

/** Local additions are not in the source/instance binding table. */
export function localComponentLayers(
  editor: Editor,
  instance: Element,
  oldIds: readonly ElementId[],
  reused: ReadonlySet<ElementId>,
) {
  const bound = new Set(
    (instance.semantic as FrameSemantic).instanceBindings?.flatMap((binding) =>
      binding.target ? [binding.target] : [],
    ),
  );
  bound.add(instance.id);
  const local = new Set(oldIds.filter((id) => !bound.has(id)));
  const attachments = new Map<ElementId, ElementId[]>();
  const parents = frameParents(
    editor.store,
    instance.page,
    editor.createShapeContext(),
  );
  for (const id of local) {
    const previous = groupOf(editor.store, id)?.id ?? parents.get(id);
    // A retained local container already carries its own child memberships.
    if (previous && local.has(previous)) continue;
    const parent = previous && reused.has(previous) ? previous : instance.id;
    attachments.set(parent, [...(attachments.get(parent) ?? []), id]);
  }
  return {
    local,
    attach(element: Element): Element {
      const extras = attachments.get(element.id);
      if (
        !extras?.length ||
        (element.type !== "frame" && element.type !== "group")
      )
        return element;
      const semantic = element.semantic as FrameSemantic;
      return {
        ...element,
        semantic: {
          ...semantic,
          memberIds: [...new Set([...(semantic.memberIds ?? []), ...extras])],
        },
      };
    },
  };
}
