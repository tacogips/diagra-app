import { type Editor, layerName, renameLayer } from "@diagra/core";

/** A transient draft that cannot overwrite a concurrent rename or another document. */
export function layerRenameDraft(editor: Editor, id: string) {
  const element = editor.store.get(id);
  if (!element || editor.createShapeContext().isLocked?.(id)) return undefined;
  const openRevision = editor.documentOpenRevision;
  const value = layerName(element);
  return {
    value,
    commit(name: string): "saved" | "unchanged" | "unavailable" {
      const current = editor.store.get(id);
      if (
        editor.readOnly ||
        editor.documentOpenRevision !== openRevision ||
        !current ||
        current.page !== element.page ||
        current.visual.layerName !== element.visual.layerName ||
        layerName(current) !== value ||
        editor.createShapeContext().isLocked?.(id)
      )
        return "unavailable";
      if (name === value) return "unchanged";
      return renameLayer(editor, id, name) ? "saved" : "unchanged";
    },
  };
}
