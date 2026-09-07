import type { Element, TextResizeMode, Visual } from "@diagra/ir";
import { applyCommands, type Command } from "./commands.ts";
import { createShapeContext } from "./hit-test.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import { textNoteText } from "./shapes/textNote.ts";
import type { Store } from "./store.ts";
import { clampLayoutSize } from "./size-limits.ts";

/** Deterministic defaults shared by canvas CSS, SVG export and derived sizing. */
export const TEXT_NOTE_FONT_SIZE = 13;
export const TEXT_NOTE_LINE_HEIGHT = 1.2;
export const TEXT_NOTE_PADDING_X = 8;
export const TEXT_NOTE_PADDING_Y = 6;
export const AVERAGE_GLYPH_WIDTH = 0.55;
export const MAX_AUTO_TEXT_SIZE = 1_000_000;

const graphemeSegmenter = new Intl.Segmenter("und", {
  granularity: "grapheme",
});
function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

function safeSize(value: number): number {
  return Math.min(
    MAX_AUTO_TEXT_SIZE,
    Math.max(1, Number.isFinite(value) ? value : MAX_AUTO_TEXT_SIZE),
  );
}

export function textOwnsAxis(
  element: Element,
  axis: "width" | "height",
): boolean {
  return (
    element.type === "text.note" &&
    (element.visual.textResize === "auto-width" ||
      (element.visual.textResize === "auto-height" && axis === "height"))
  );
}

function glyphAdvance(fontSize: number, letterSpacing: number): number {
  return Math.max(0.1, fontSize * AVERAGE_GLYPH_WIDTH + letterSpacing);
}

/**
 * Greedy, deterministic wrapping. It deliberately estimates font metrics so
 * cloud collaborators with different installed fonts retain equal geometry.
 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  letterSpacing = 0,
): readonly string[] {
  const maxChars = Math.max(
    1,
    Math.floor(maxWidth / glyphAdvance(fontSize, letterSpacing)),
  );
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    let lineLength = 0;
    for (const token of paragraph.split(/( +)/)) {
      if (!token) continue;
      const clusters = graphemes(token);
      // Prefer whole words; whitespace itself is retained even at line edges.
      if (
        !token.startsWith(" ") &&
        lineLength > 0 &&
        lineLength + clusters.length > maxChars
      ) {
        lines.push(line);
        line = "";
        lineLength = 0;
      }
      for (const cluster of clusters) {
        if (lineLength >= maxChars) {
          lines.push(line);
          line = "";
          lineLength = 0;
        }
        line += cluster;
        lineLength += 1;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function measureTextNote(
  element: Element,
  mode: Exclude<TextResizeMode, "fixed">,
): { readonly width: number; readonly height: number } {
  const text = textNoteText(element.semantic);
  const style = element.visual.style;
  const fontSize = Math.max(0.1, style?.fontSize ?? TEXT_NOTE_FONT_SIZE);
  const lineHeight = fontSize * (style?.lineHeight ?? TEXT_NOTE_LINE_HEIGHT);
  const letterSpacing = style?.letterSpacing ?? 0;
  if (mode === "auto-width") {
    const explicitLines = text.split(/\r?\n/);
    const characters = explicitLines.reduce(
      (longest, line) => Math.max(longest, graphemes(line).length),
      0,
    );
    return {
      width: safeSize(
        characters * glyphAdvance(fontSize, letterSpacing) +
          TEXT_NOTE_PADDING_X * 2,
      ),
      height: safeSize(
        Math.max(1, explicitLines.length) * lineHeight +
          TEXT_NOTE_PADDING_Y * 2,
      ),
    };
  }
  const width = Math.max(1, element.visual.width ?? 200);
  const lines = wrapTextLines(
    text,
    Math.max(1, width - TEXT_NOTE_PADDING_X * 2),
    fontSize,
    letterSpacing,
  );
  return {
    width,
    height: safeSize(
      Math.max(1, lines.length) * lineHeight + TEXT_NOTE_PADDING_Y * 2,
    ),
  };
}

/** Materialize auto-sized text geometry before/after deterministic layout. */
export function planTextResize(
  store: Store,
  registry: ShapeUtilRegistry,
): Command[] {
  const candidates = store
    .getSnapshot()
    .elements.filter(
      (element) =>
        element.type === "text.note" &&
        (element.visual.textResize === "auto-width" ||
          element.visual.textResize === "auto-height"),
    );
  if (!candidates.length) return [];
  const context = createShapeContext(store, registry, 1);
  const commands: Command[] = [];
  for (const element of candidates) {
    if (context.isLocked?.(element.id)) continue;
    const mode = element.visual.textResize as Exclude<TextResizeMode, "fixed">;
    const measured = measureTextNote(element, mode);
    const { numberTokens: oldLinks, ...rest } = element.visual;
    const links = Object.fromEntries(
      Object.entries(oldLinks ?? {}).filter(
        ([field]) =>
          field !== "height" && !(mode === "auto-width" && field === "width"),
      ),
    );
    const visual: Visual = {
      ...rest,
      width:
        mode === "auto-width"
          ? clampLayoutSize(element.visual, "width", measured.width)
          : measured.width,
      height: clampLayoutSize(element.visual, "height", measured.height),
      ...(Object.keys(links).length ? { numberTokens: links } : {}),
    };
    if (JSON.stringify(visual) !== JSON.stringify(element.visual))
      commands.push({ type: "replaceVisual", id: element.id, visual });
  }
  if (commands.length) applyCommands(store, commands);
  return commands;
}
