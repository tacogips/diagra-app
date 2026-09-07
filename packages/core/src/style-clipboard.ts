import { getElementTypeDefinition, type VisualStyle } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import type { Command } from "./commands.ts";
import { leafElements } from "./group.ts";
import { STYLE_NUMBER_FIELDS, CORNER_NUMBER_FIELDS } from "./number-tokens.ts";

const clipboard = new WeakMap<Editor, VisualStyle>();
const styleNumbers = new Set<string>([
  ...STYLE_NUMBER_FIELDS,
  ...CORNER_NUMBER_FIELDS,
]);

export function canCopySelectionStyle(editor: Editor): boolean {
  const ids = [...editor.selection.ids()];
  const source = ids.length === 1 ? editor.store.get(ids[0] ?? "") : undefined;
  return (
    source !== undefined &&
    getElementTypeDefinition(source.type)?.category !== "resource"
  );
}

export function copySelectionStyle(editor: Editor): boolean {
  if (!canCopySelectionStyle(editor)) return false;
  const id = [...editor.selection.ids()][0];
  const style = id ? editor.store.get(id)?.visual.style : undefined;
  clipboard.set(editor, structuredClone(style ?? {}));
  return true;
}

export function canPasteSelectionStyle(editor: Editor): boolean {
  return stylePasteCommands(editor).length > 0;
}

function stylePasteCommands(editor: Editor): Command[] {
  const style = clipboard.get(editor);
  if (!style) return [];
  const context = editor.createShapeContext();
  const commands: Command[] = [];
  for (const element of leafElements(editor.store, editor.selection.ids())) {
    if (
      context.isLocked?.(element.id) ||
      getElementTypeDefinition(element.type)?.category === "resource"
    )
      continue;
    const {
      style: _style,
      colorTokens: _colors,
      textStyle: _typography,
      numberTokens,
      ...rest
    } = element.visual;
    const links = Object.fromEntries(
      Object.entries(numberTokens ?? {}).filter(
        ([field]) => !styleNumbers.has(field),
      ),
    );
    const visual = {
      ...rest,
      ...(Object.keys(style).length ? { style: structuredClone(style) } : {}),
      ...(Object.keys(links).length ? { numberTokens: links } : {}),
    };
    if (JSON.stringify(visual) !== JSON.stringify(element.visual))
      commands.push({ type: "replaceVisual", id: element.id, visual });
  }
  return commands;
}

/** Literal appearance paste; content, geometry and layout bindings remain intact. */
export function pasteSelectionStyle(editor: Editor): boolean {
  const commands = stylePasteCommands(editor);
  if (!commands.length) return false;
  editor.apply(commands);
  return true;
}
