import type { Editor } from "@diagra/core";
import type { PageId } from "@diagra/ir";

/** Keep a page-name draft from overwriting a concurrent rename or document. */
export function pageRenameDraft(editor: Editor, id: PageId) {
  const page = editor.store.getPage(id);
  if (!page) return undefined;
  const openRevision = editor.documentOpenRevision;
  return {
    value: page.name,
    commit(value: string): "saved" | "unchanged" | "unavailable" {
      const current = editor.store.getPage(id);
      if (
        editor.readOnly ||
        editor.documentOpenRevision !== openRevision ||
        !current ||
        current.name !== page.name
      )
        return "unavailable";
      const name = value.trim();
      if (!name || name === current.name) return "unchanged";
      return editor.renamePage(id, name) ? "saved" : "unchanged";
    },
  };
}
