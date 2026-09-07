// node.generic: a labelled box. Plain DOM, because a rounded rectangle with
// centred text is something CSS already does well.

import { cornerRadiiCss, resolvedCornerRadii } from "@diagra/core";
import type { Element, GenericNodeSemantic } from "@diagra/ir";
import type { JSX } from "solid-js";
import { fillPaintStyle, labelStyle, strokeBorderStyle } from "./visual.ts";

export interface NodeViewProps {
  readonly element: Element;
}

export function NodeView(props: NodeViewProps): JSX.Element {
  const label = () =>
    (props.element.semantic as Partial<GenericNodeSemantic> | null)?.label ??
    "";
  return (
    <div
      class="diagra-node"
      data-smart-paint="box"
      data-smart-text
      style={{
        ...labelStyle(props.element.visual),
        ...fillPaintStyle(props.element.visual),
        "border-width":
          props.element.visual.style?.strokeWidth === undefined
            ? undefined
            : `${props.element.visual.style.strokeWidth}px`,
        "border-radius": cornerRadiiCss(
          resolvedCornerRadii(props.element.visual.style, 8),
        ),
        "border-style":
          props.element.visual.style?.dash === "dashed"
            ? "dashed"
            : props.element.visual.style?.dash === "dotted"
              ? "dotted"
              : "solid",
        ...strokeBorderStyle(props.element.visual),
      }}
    >
      <span class="diagra-node-label">{label()}</span>
    </div>
  );
}
