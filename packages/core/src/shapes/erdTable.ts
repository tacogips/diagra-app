// erd.table: header plus one fixed-height row per column.
//
// Height is derived from the semantic payload rather than stored, so adding
// a column resizes the table without a second edit that could disagree with
// it. Width stays user-controlled. Long names are clipped by the renderer;
// measuring text would drag DOM metrics into the core, which is exactly what
// this package must not depend on.

import type { Box } from "../geometry.ts";
import { boxContains } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";

export const ERD_TABLE_DEFAULT_WIDTH = 240;
export const ERD_TABLE_HEADER_HEIGHT = 32;
export const ERD_TABLE_ROW_HEIGHT = 24;

export function erdColumnCount(semantic: unknown): number {
  if (typeof semantic !== "object" || semantic === null) {
    return 0;
  }
  const columns = (semantic as Record<string, unknown>)["columns"];
  return Array.isArray(columns) ? columns.length : 0;
}

export function erdTableBounds(
  visual: { x?: number; y?: number; width?: number },
  semantic: unknown,
): Box {
  // Always keep one row of body height so an empty table is still a target.
  const rows = Math.max(1, erdColumnCount(semantic));
  return {
    x: visual.x ?? 0,
    y: visual.y ?? 0,
    width: visual.width ?? ERD_TABLE_DEFAULT_WIDTH,
    height: ERD_TABLE_HEADER_HEIGHT + ERD_TABLE_ROW_HEIGHT * rows,
  };
}

export const erdTableShapeUtil: ShapeUtil = {
  type: "erd.table",
  canResize: true,
  getBounds(element) {
    return erdTableBounds(element.visual, element.semantic);
  },
  hitTest(element, point) {
    return boxContains(erdTableBounds(element.visual, element.semantic), point);
  },
  resize(_element, box) {
    // Height is derived, so a resize gesture only moves and rewidths.
    return { visual: { x: box.x, y: box.y, width: box.width } };
  },
  defaultSemantic() {
    return {
      tableName: "table",
      columns: [{ id: "id", name: "id", dataType: "uuid", pk: true }],
    };
  },
  defaultVisual() {
    return { x: 0, y: 0, width: ERD_TABLE_DEFAULT_WIDTH };
  },
};
