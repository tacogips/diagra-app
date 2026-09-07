import type { Editor } from "./editor.ts";
import { layerName } from "./layer-name.ts";
import { layerRows } from "./layer-tree.ts";

export interface LayerRenameOptions {
  readonly pattern: string;
  readonly start?: number;
  readonly digits?: number;
  /** Case-sensitive literal replacement within the existing name, before templating. */
  readonly find?: string;
  readonly replace?: string;
}

/** Preview explicit selections in expanded layer-panel order; never expand a selected container. */
export function previewLayerNames(editor: Editor, options: LayerRenameOptions) {
  const { pattern, start = 1, digits = 1, find = "", replace = "" } = options;
  if (
    pattern.length > 256 ||
    find.length > 256 ||
    replace.length > 256 ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > 999999 ||
    !Number.isInteger(digits) ||
    digits < 1 ||
    digits > 6
  )
    throw new Error(
      "Use pattern/find/replace fields up to 256 characters, a start from 0–999999 and 1–6 digits.",
    );
  const context = editor.createShapeContext();
  return layerRows(editor)
    .filter(
      ({ element }) =>
        editor.selection.has(element.id) && !context.isLocked?.(element.id),
    )
    .map(({ element }, index) => {
      const previous = layerName(element);
      const sourceName =
        find && pattern.includes("{name}")
          ? previous.split(find).join(replace)
          : previous;
      const name = pattern
        .replace(/\{(name|type|n)\}/g, (_, key: string) =>
          key === "name"
            ? sourceName
            : key === "type"
              ? element.type
              : String(start + index).padStart(digits, "0"),
        )
        .trim();
      if (name.length > 1024)
        throw new Error("A generated layer name exceeds 1024 characters.");
      const stored = element.visual.layerName ?? "";
      const { layerName: _storedName, ...unnamedVisual } = element.visual;
      return {
        id: element.id,
        previous,
        name,
        displayName: name || layerName({ ...element, visual: unnamedVisual }),
        changed: name !== stored && !(stored === "" && name === previous),
      };
    });
}

/** Revalidate at commit time and rename in one transaction, preserving all other fields. */
export function renameSelectedLayers(
  editor: Editor,
  options: LayerRenameOptions,
): number {
  const rows = previewLayerNames(editor, options).filter((row) => row.changed);
  const commands = rows.flatMap((row) => {
    const element = editor.store.get(row.id);
    if (!element) return [];
    const { layerName: _name, ...visual } = element.visual;
    return [
      {
        type: "replaceVisual" as const,
        id: row.id,
        visual: row.name ? { ...visual, layerName: row.name } : visual,
      },
    ];
  });
  if (commands.length) editor.apply(commands);
  return commands.length;
}
