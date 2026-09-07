import type { Element, ElementId, FrameSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";

export interface ResponsiveFamilyMember {
  readonly element: Element;
  readonly rootId: ElementId;
  readonly name: string;
  readonly platform?: FrameSemantic["platform"];
  readonly width: number;
}

export interface ResponsiveFamily {
  readonly sourceRootId: ElementId;
  readonly members: readonly ResponsiveFamilyMember[];
  readonly notes: readonly string[];
}

function frameSource(editor: Editor, frame: Element): Element {
  let current = frame;
  const seen = new Set<ElementId>();
  while (current.type === "frame" && !seen.has(current.id)) {
    seen.add(current.id);
    const sourceId = (current.semantic as FrameSemantic).responsiveSource;
    if (!sourceId) break;
    const source = editor.store.get(sourceId);
    if (!source || source.type !== "frame" || source.page !== frame.page) break;
    current = source;
  }
  return current;
}

function viewportWidth(editor: Editor, frame: Element): number | undefined {
  const width = frame.visual.width ?? editor.getBounds(frame.id)?.width;
  return width !== undefined && Number.isFinite(width) && width > 0
    ? width
    : undefined;
}

/** Resolve a same-page responsive family from any of its artboards. */
export function collectResponsiveFamily(
  editor: Editor,
  rootId: ElementId,
): ResponsiveFamily | null {
  const selected = editor.store.get(rootId);
  if (!selected || selected.type !== "frame") return null;
  const source = frameSource(editor, selected);
  const notes: string[] = [];
  const byWidth = new Map<number, ResponsiveFamilyMember>();
  const candidates = editor.store
    .getPageElements(selected.page)
    .filter(
      (element) =>
        element.type === "frame" &&
        frameSource(editor, element).id === source.id,
    )
    .sort((a, b) => {
      const widthA = viewportWidth(editor, a) ?? Number.POSITIVE_INFINITY;
      const widthB = viewportWidth(editor, b) ?? Number.POSITIVE_INFINITY;
      return widthA - widthB || a.id.localeCompare(b.id);
    });
  for (const frame of candidates) {
    const width = viewportWidth(editor, frame);
    if (width === undefined) {
      notes.push(`${frame.id}: invalid artboard geometry was omitted.`);
      continue;
    }
    if (byWidth.has(width)) {
      notes.push(
        `${frame.id}: duplicate ${width}px breakpoint was omitted; viewport widths must be unique.`,
      );
      continue;
    }
    const semantic = frame.semantic as FrameSemantic;
    byWidth.set(width, {
      element: frame,
      rootId: frame.id,
      name: semantic.name,
      ...(semantic.platform ? { platform: semantic.platform } : {}),
      width,
    });
  }
  const members = [...byWidth.values()].sort(
    (a, b) => a.width - b.width || a.rootId.localeCompare(b.rootId),
  );
  return members.length ? { sourceRootId: source.id, members, notes } : null;
}
