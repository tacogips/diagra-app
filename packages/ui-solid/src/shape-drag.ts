import { creationFor, TOOLS, type ToolKind } from "./tools.ts";
export const SHAPE_DRAG_TYPE = "application/x-nodetto-shape";
/** Never trust arbitrary drag payloads to select a tool or create an element. */
export function draggedShapeTool(value: string): ToolKind | undefined {
  return TOOLS.find((tool) => tool === value && creationFor(tool) !== null);
}
