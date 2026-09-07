import { type Box, boxCenter } from "@diagra/core";
import { type Element, getElementTypeDefinition } from "@diagra/ir";

/** An inset editor must pivot about its owning layer, not its own center. */
export function textEditorRotation(
  element: Element | undefined,
  box: Box | null,
  placement: { x: number; y: number },
): { transform?: string; "transform-origin"?: string } {
  if (
    !element?.visual.rotation ||
    !box ||
    getElementTypeDefinition(element.type)?.category === "edge" ||
    element.type === "group"
  )
    return {};
  const center = boxCenter(box);
  return {
    transform: `rotate(${element.visual.rotation}deg)`,
    "transform-origin": `${center.x - placement.x}px ${center.y - placement.y}px`,
  };
}
