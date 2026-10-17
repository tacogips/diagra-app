import { boxContains } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";
export const uiControlShapeUtil: ShapeUtil = {
  type: "ui.control",
  canResize: true,
  getBounds: (element) => ({
    x: element.visual.x ?? 0,
    y: element.visual.y ?? 0,
    width: element.visual.width ?? 180,
    height: element.visual.height ?? 44,
  }),
  hitTest(element, point, context) {
    const box = this.getBounds(element, context);
    return Boolean(box && boxContains(box, point));
  },
  resize: (_element, box) => ({ visual: { ...box } }),
  defaultSemantic: () => ({ control: "button", label: "Button" }),
  defaultVisual: () => ({ x: 0, y: 0, width: 180, height: 44 }),
};
