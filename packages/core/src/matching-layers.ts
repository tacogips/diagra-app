import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { layerName } from "./layer-name.ts";

export type LayerMatch = "type" | "name" | "fill" | "stroke";

function paintKey(
  element: Element,
  field: "fill" | "stroke",
): string | undefined {
  if (element.type === "group") return undefined;
  const style = element.visual.style;
  const gradient =
    field === "fill" ? style?.fillGradient : style?.strokeGradient;
  const color = (value: string): string =>
    /^#[0-9a-f]+$/i.test(value) ? value.toLowerCase() : value;
  if (gradient) {
    const geometry =
      gradient.type === "linear"
        ? [gradient.angle]
        : gradient.type === "radial"
          ? [gradient.centerX, gradient.centerY, gradient.radius]
          : gradient.type === "angular"
            ? [gradient.centerX, gradient.centerY, gradient.angle]
            : [
                gradient.centerX,
                gradient.centerY,
                gradient.radius,
                gradient.angle,
              ];
    return JSON.stringify([
      gradient.type,
      geometry,
      gradient.stops.map((stop) => [
        stop.offset,
        color(stop.color),
        stop.opacity ?? 1,
      ]),
    ]);
  }
  const solid = style?.[field];
  return solid === undefined
    ? undefined
    : JSON.stringify(["solid", color(solid)]);
}

function matchKey(element: Element, match: LayerMatch): string | undefined {
  return match === "type"
    ? element.type
    : match === "name"
      ? layerName(element)
      : paintKey(element, match);
}

/** Match one reference layer across the active page, including nested layers.
 * This is a layer operation, independent of viewport position or clipping.
 */
export function matchingLayerIds(
  editor: Editor,
  match: LayerMatch,
): ElementId[] {
  const ids = [...editor.selection.ids()];
  if (ids.length !== 1) return [];
  const source = editor.store.get(ids[0] as ElementId);
  const context = editor.createShapeContext();
  const eligible = (element: Element): boolean =>
    element.page === editor.currentPageId &&
    getElementTypeDefinition(element.type)?.category !== "resource" &&
    !context.isHidden?.(element.id) &&
    !context.isLocked?.(element.id) &&
    !context.isMaskSource?.(element.id);
  if (!source || !eligible(source)) return [];
  const value = matchKey(source, match);
  if (value === undefined) return [];
  return editor.store
    .getPageElements(editor.currentPageId)
    .filter(
      (element) => eligible(element) && matchKey(element, match) === value,
    )
    .map((element) => element.id);
}

/** Selection-only operation: no history entry, document edit, or page switch. */
export function selectMatchingLayers(
  editor: Editor,
  match: LayerMatch,
): boolean {
  const ids = matchingLayerIds(editor, match);
  if (ids.length < 2) return false;
  editor.selection.set(ids);
  return true;
}
