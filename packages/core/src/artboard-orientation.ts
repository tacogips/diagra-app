import type { FrameSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { frameParents } from "./frame-tree.ts";

/** Explain why an exact orientation swap cannot retain the authored size rules. */
export function artboardOrientationIssue(
  editor: Editor,
  id: string,
): string | null {
  const element = editor.store.get(id);
  if (element?.type !== "frame") return "Select an artboard.";
  const context = editor.createShapeContext();
  if (context.isLocked?.(id)) return "Unlock the artboard first.";
  const parentId = frameParents(editor.store, element.page, context).get(id);
  const parent = parentId ? editor.store.get(parentId) : undefined;
  const parentLayout = (parent?.semantic as FrameSemantic | undefined)?.layout;
  if (
    parentLayout &&
    (parentLayout.align === "stretch" ||
      (element.visual.layoutGrow ?? 0) > 0) &&
    element.visual.layoutPosition !== "absolute"
  )
    return "Disable fill/stretch sizing or use absolute positioning before changing orientation.";
  const layout = (element.semantic as FrameSemantic).layout;
  if (
    layout &&
    ((layout.widthSizing ?? layout.sizing) === "hug" ||
      (layout.heightSizing ?? layout.sizing) === "hug")
  )
    return "Set both artboard dimensions to fixed before changing orientation.";
  const box = editor.getBounds(id);
  if (!box || box.width === box.height) return "This artboard is square.";
  const visual = element.visual;
  if (
    box.height < (visual.minWidth ?? 1) ||
    box.height > (visual.maxWidth ?? Number.POSITIVE_INFINITY) ||
    box.width < (visual.minHeight ?? 1) ||
    box.width > (visual.maxHeight ?? Number.POSITIVE_INFINITY)
  )
    return "The swapped dimensions exceed the artboard's size limits.";
  return null;
}

/** Swap axes as one edit; the editor reflows responsive and auto-layout children. */
export function swapArtboardOrientation(editor: Editor, id: string): boolean {
  if (artboardOrientationIssue(editor, id)) return false;
  const element = editor.store.get(id);
  const box = editor.getBounds(id);
  if (!element || !box) return false;
  const { numberTokens, ...visual } = element.visual;
  const links = Object.fromEntries(
    Object.entries(numberTokens ?? {}).filter(
      ([field]) => field !== "width" && field !== "height",
    ),
  );
  editor.apply([
    {
      type: "replaceVisual",
      id,
      visual: {
        ...visual,
        width: box.height,
        height: box.width,
        ...(visual.aspectRatio === undefined
          ? {}
          : { aspectRatio: box.height / box.width }),
        ...(Object.keys(links).length ? { numberTokens: links } : {}),
      },
    },
  ]);
  return true;
}
