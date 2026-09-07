import type { Editor } from "@diagra/core";

/** Guard a textarea draft without treating unrelated peer edits as conflicts. */
export function textEditDraft(editor: Editor, id: string) {
  const element = editor.store.get(id);
  const value = editor.getText(id);
  if (!element || value === null) return undefined;
  const openRevision = editor.documentOpenRevision;
  return {
    value,
    commit(text: string): "saved" | "unchanged" | "unavailable" {
      // Merely focusing and leaving a field must never revert newer text.
      if (text === value) return "unchanged";
      const current = editor.store.get(id);
      if (
        editor.readOnly ||
        editor.documentOpenRevision !== openRevision ||
        !current ||
        current.type !== element.type ||
        current.page !== element.page ||
        editor.createShapeContext().isLocked?.(id)
      )
        return "unavailable";
      const latest = editor.getText(id);
      if (text === latest) return "unchanged";
      if (latest !== value) return "unavailable";
      return editor.setText(id, text) ? "saved" : "unchanged";
    },
  };
}
