// ShapeUtil: per-element-type geometry and behaviour.
//
// The registry is the seam between the type-agnostic engine (selection,
// hit testing, resize) and the knowledge of what a given element looks like.
// Nothing here renders: a ShapeUtil answers questions in page space and the
// renderer draws whatever it likes from the same element.

import type { Element, ElementId, Visual } from "@diagra/ir";
import type { Box, Vec } from "./geometry.ts";

/** Read-only view of the rest of the document, for shapes that need it. */
export interface ShapeContext {
  /** Current camera zoom; hit tolerances divide by it to stay screen-sized. */
  readonly zoom: number;
  resolve(id: ElementId): Element | undefined;
  /** Bounds of another element, resolved through the same registry. */
  boundsOf(id: ElementId): Box | null;
}

export interface ShapeUtil {
  readonly type: string;
  /** Whether the selection overlay offers resize handles. */
  readonly canResize: boolean;
  /**
   * Page-space bounds, or `null` when the element has no geometry of its own
   * (a connector whose endpoints are missing, for instance).
   */
  getBounds(element: Element, context: ShapeContext): Box | null;
  hitTest(element: Element, point: Vec, context: ShapeContext): boolean;
  /** Connection points, defaulting to the bounds' edge midpoints. */
  getPorts?(element: Element, context: ShapeContext): readonly Vec[];
  /** Visual patch that makes the element occupy `box`. */
  resize?(element: Element, box: Box): { readonly visual: Partial<Visual> };
  defaultSemantic(): unknown;
  defaultVisual(): Visual;
}

export class ShapeUtilRegistry {
  private readonly utils = new Map<string, ShapeUtil>();

  constructor(private fallback: ShapeUtil) {}

  register(util: ShapeUtil): this {
    this.utils.set(util.type, util);
    return this;
  }

  /** Replace the util used for element types nothing is registered for. */
  setFallback(util: ShapeUtil): this {
    this.fallback = util;
    return this;
  }

  get(type: string): ShapeUtil | undefined {
    return this.utils.get(type);
  }

  /**
   * Never throws: an unknown element type is a forward-compatibility case,
   * not an error, so it gets generic box behaviour instead.
   */
  getOrFallback(type: string): ShapeUtil {
    return this.utils.get(type) ?? this.fallback;
  }

  types(): readonly string[] {
    return [...this.utils.keys()];
  }
}
