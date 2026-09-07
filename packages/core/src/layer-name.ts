import type { Element } from "@diagra/ir";
import type { Editor } from "./editor.ts";

export function layerName(element: Element): string {
  if (element.visual.layerName?.trim()) return element.visual.layerName;
  const data = element.semantic as Record<string, unknown> | null;
  for (const field of ["name", "label", "tableName", "text"]) {
    const value = data?.[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return element.type === "frame" ? "Artboard" : element.type;
}

/** Empty input restores the semantic/type label without touching content. */
export function renameLayer(editor: Editor, id: string, name: string): boolean {
  const element = editor.store.get(id);
  if (!element || editor.createShapeContext().isLocked?.(id)) return false;
  const value = name.trim();
  if ((element.visual.layerName ?? "") === value) return false;
  const { layerName: _name, ...rest } = element.visual;
  editor.apply([
    {
      type: "replaceVisual",
      id,
      visual: value ? { ...rest, layerName: value } : rest,
    },
  ]);
  return true;
}
