// uml.class: name compartment, attribute compartment, method compartment.
//
// Same rule as erd.table: height is derived from the payload, width is
// user-controlled, and empty compartments still reserve one row so the three
// bands of the classic UML box remain visible.

import { type Box, boxContains } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";

export const UML_CLASS_DEFAULT_WIDTH = 200;
export const UML_CLASS_NAME_HEIGHT = 32;
export const UML_CLASS_STEREOTYPE_HEIGHT = 16;
export const UML_CLASS_ROW_HEIGHT = 22;

function listLength(semantic: unknown, field: string): number {
  if (typeof semantic !== "object" || semantic === null) {
    return 0;
  }
  const value = (semantic as Record<string, unknown>)[field];
  return Array.isArray(value) ? value.length : 0;
}

function hasStereotype(semantic: unknown): boolean {
  if (typeof semantic !== "object" || semantic === null) {
    return false;
  }
  const value = (semantic as Record<string, unknown>)["stereotype"];
  return typeof value === "string" && value.length > 0;
}

/** Height of the name compartment, including a stereotype line if present. */
export function umlNameHeight(semantic: unknown): number {
  return (
    UML_CLASS_NAME_HEIGHT +
    (hasStereotype(semantic) ? UML_CLASS_STEREOTYPE_HEIGHT : 0)
  );
}

export function umlAttributesHeight(semantic: unknown): number {
  return UML_CLASS_ROW_HEIGHT * Math.max(1, listLength(semantic, "attributes"));
}

export function umlMethodsHeight(semantic: unknown): number {
  return UML_CLASS_ROW_HEIGHT * Math.max(1, listLength(semantic, "methods"));
}

export function umlClassBounds(
  visual: { x?: number; y?: number; width?: number },
  semantic: unknown,
): Box {
  return {
    x: visual.x ?? 0,
    y: visual.y ?? 0,
    width: visual.width ?? UML_CLASS_DEFAULT_WIDTH,
    height:
      umlNameHeight(semantic) +
      umlAttributesHeight(semantic) +
      umlMethodsHeight(semantic),
  };
}

export const umlClassShapeUtil: ShapeUtil = {
  type: "uml.class",
  canResize: true,
  getBounds(element) {
    return umlClassBounds(element.visual, element.semantic);
  },
  hitTest(element, point) {
    return boxContains(umlClassBounds(element.visual, element.semantic), point);
  },
  resize(_element, box) {
    return { visual: { x: box.x, y: box.y, width: box.width } };
  },
  defaultSemantic() {
    return { name: "Class", attributes: [], methods: [] };
  },
  defaultVisual() {
    return { x: 0, y: 0, width: UML_CLASS_DEFAULT_WIDTH };
  },
};
