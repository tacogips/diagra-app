import { getElementTypeDefinition } from "@nodetto/ir";
import type {
  ElementId,
  FrameSemantic,
  GenericEdgeSemantic,
  PrototypeAction,
} from "@nodetto/ir";
import type { Editor } from "./editor.ts";
import { frameParents } from "./frame-tree.ts";

/** Dropping a transition on a part resolves to its containing screen. */
export function screenFrame(editor: Editor, id: ElementId): ElementId | null {
  const element = editor.store.get(id);
  if (
    !element ||
    ["edge", "resource"].includes(
      getElementTypeDefinition(element.type)?.category ?? "",
    ) ||
    element.type === "review.comment"
  )
    return null;
  const parents = frameParents(
    editor.store,
    element.page,
    editor.createShapeContext(),
  );
  let current: string | undefined = id;
  let fallback: string | null = null;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const candidate = editor.store.get(current);
    if (candidate?.type === "frame") {
      fallback = current;
      const semantic = candidate.semantic as FrameSemantic;
      if (semantic.screenKind || semantic.platform) return current;
    }
    current = parents.get(current);
  }
  return fallback;
}

/** A semantic interaction, consumed by prototype preview rather than painted in a page. */
export function connectScreenTransition(
  editor: Editor,
  from: ElementId,
  target: ElementId,
  action?: PrototypeAction,
): ElementId | null {
  const source = editor.store.get(from);
  const to = screenFrame(editor, target);
  const destination = to ? editor.store.get(to) : undefined;
  const sourceFrame = screenFrame(editor, from);
  const context = editor.createShapeContext();
  if (
    !source ||
    !destination ||
    !sourceFrame ||
    from === to ||
    source.page !== destination.page ||
    context.isLocked?.(from) ||
    context.isLocked?.(destination.id)
  )
    return null;
  const kind = (destination.semantic as FrameSemantic).screenKind ?? "screen";
  const resolvedAction =
    action ?? (kind === "screen" ? "navigate" : "open-overlay");
  const semantic: GenericEdgeSemantic = {
    from,
    to: destination.id,
    prototype: true,
    prototypeAction: resolvedAction,
    prototypeTrigger: "click",
    prototypeTransition: kind === "bottom-sheet" ? "slide-up" : "fade",
    prototypeDuration: 250,
    routing: "orthogonal",
    arrowheads: { start: "dot", end: "arrow" },
    ...(resolvedAction === "open-overlay"
      ? ({
          prototypeOverlayPosition:
            kind === "bottom-sheet" ? "bottom-center" : "center",
          prototypeOverlayBackdrop: kind !== "popover",
          prototypeOverlayDismiss: true,
        } as const)
      : {}),
  };
  return editor.createElement("edge.generic", {
    page: source.page,
    semantic,
    visual: { style: { stroke: "#7c3aed", strokeWidth: 2 } },
  });
}
