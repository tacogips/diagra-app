import type { Editor } from "@diagra/core";
import type { ElementId, FrameSemantic } from "@diagra/ir";

/** An inert image source, never markup injected into the application DOM. */
export function componentPreviewSource(
  editor: Editor,
  id: ElementId,
): string | null {
  const element = editor.store.get(id);
  if (
    element?.type !== "frame" ||
    !(element.semantic as FrameSemantic).component
  )
    return null;
  const svg = editor.exportArtboardSvg(id);
  return svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    : null;
}
