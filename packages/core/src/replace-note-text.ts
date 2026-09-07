import type { TextNoteSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { replaceMarkedTextRanges, textNoteMarks } from "./rich-text.ts";
import { textNoteText } from "./shapes/textNote.ts";
import { layerName } from "./layer-name.ts";

/** Literal, case-sensitive replacement on explicitly selected current-page notes. */
export function previewNoteTextReplacement(
  editor: Editor,
  find: string,
  replacement: string,
) {
  if (find.length > 256 || replacement.length > 256)
    throw new Error("Find and replacement are limited to 256 characters.");
  if (!find || find === replacement) return [];
  const context = editor.createShapeContext();
  return editor.store
    .getPageElements(editor.currentPageId)
    .flatMap((element) => {
      if (
        element.type !== "text.note" ||
        !editor.selection.has(element.id) ||
        context.isLocked?.(element.id)
      )
        return [];
      const semantic = element.semantic as TextNoteSemantic;
      const previous = textNoteText(semantic);
      if (!previous.includes(find)) return [];
      const positions: number[] = [];
      for (
        let at = previous.indexOf(find);
        at !== -1;
        at = previous.indexOf(find, at + find.length)
      ) {
        positions.push(at);
        if (positions.length > 1000)
          throw new Error("A note may replace at most 1,000 matches at once.");
      }
      if (
        previous.length +
          positions.length * (replacement.length - find.length) >
        100000
      )
        throw new Error(
          "Replacement text is limited to 100,000 characters per note.",
        );
      const { text, marks } = replaceMarkedTextRanges(
        previous,
        textNoteMarks(semantic),
        positions.map((start) => ({ start, end: start + find.length })),
        replacement,
      );
      const { marks: _marks, ...rest } = semantic;
      return [
        {
          id: element.id,
          name: layerName(element),
          previous,
          text,
          matches: positions.length,
          semantic: { ...rest, text, ...(marks.length ? { marks } : {}) },
        },
      ];
    });
}

export function replaceSelectedNoteText(
  editor: Editor,
  find: string,
  replacement: string,
): number {
  const rows = previewNoteTextReplacement(editor, find, replacement);
  if (rows.length)
    editor.apply(
      rows.map((row) => ({
        type: "updateSemantic",
        id: row.id,
        semantic: row.semantic,
      })),
    );
  return rows.length;
}
