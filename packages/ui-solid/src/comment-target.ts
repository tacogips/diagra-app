import type { Editor } from "@nodetto/core";
import { getElementTypeDefinition } from "@nodetto/ir";

/** One selected drawing element; resources and comment pins are not targets. */
export function selectedCommentTarget(editor: Editor): string | undefined {
  if (editor.selection.size !== 1) return undefined;
  const [id] = editor.selection.ids();
  const element = id ? editor.store.get(id) : undefined;
  return element &&
    element.page === editor.currentPageId &&
    element.type !== "review.comment" &&
    getElementTypeDefinition(element.type)?.category !== "resource"
    ? element.id
    : undefined;
}
