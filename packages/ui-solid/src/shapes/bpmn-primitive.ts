import type { NotationPrimitive } from "@nodetto/core";

export type BpmnSvgTag = "rect" | "circle" | "path" | "polygon" | "text";

export type BpmnSvgAttributes = Record<string, string | number | undefined>;

export interface BpmnSvgPrimitive {
  readonly tag: BpmnSvgTag;
  readonly attrs: BpmnSvgAttributes;
}

export function primitiveAttributes(
  primitive: NotationPrimitive,
): BpmnSvgPrimitive {
  const attrs: BpmnSvgAttributes = {
    class: `bpmn-${primitive.role}`,
    stroke: primitive.stroke,
    fill: primitive.fill,
    "stroke-width": primitive.strokeWidth,
    "stroke-dasharray": primitive.dash,
  };

  switch (primitive.kind) {
    case "rect":
      return {
        tag: "rect",
        attrs: {
          ...attrs,
          x: primitive.x,
          y: primitive.y,
          width: primitive.width,
          height: primitive.height,
          rx: primitive.rx,
        },
      };
    case "circle":
      return {
        tag: "circle",
        attrs: {
          ...attrs,
          cx: primitive.cx,
          cy: primitive.cy,
          r: primitive.r,
        },
      };
    case "path":
      return { tag: "path", attrs: { ...attrs, d: primitive.d } };
    case "polygon":
      return {
        tag: "polygon",
        attrs: {
          ...attrs,
          points: primitive.points
            .map((point) => `${point.x},${point.y}`)
            .join(" "),
        },
      };
    case "text":
      return {
        tag: "text",
        attrs: {
          ...attrs,
          x: primitive.x,
          y: primitive.y,
          "text-anchor": primitive.anchor,
          "font-size": primitive.fontSize,
          transform:
            primitive.rotate === undefined
              ? undefined
              : `rotate(${primitive.rotate} ${primitive.x} ${primitive.y})`,
        },
      };
  }
}
