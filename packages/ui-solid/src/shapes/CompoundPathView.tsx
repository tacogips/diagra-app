import {
  compoundPathGeometry,
  gradientId,
  strokeGradientId,
} from "@diagra/core";
import type { Element, PathSemantic } from "@diagra/ir";
import { type JSX, Show } from "solid-js";
import { SvgFillGradient } from "./SvgFillGradient.tsx";
import { svgStyle } from "./visual.ts";

export function CompoundPathView(props: { element: Element }): JSX.Element {
  return (
    <Show when={compoundPathGeometry(props.element)}>
      {(geometry) => (
        <svg width="100%" height="100%" style={{ overflow: "visible" }}>
          <title>
            {(props.element.semantic as PathSemantic).name ?? "Vector path"}
          </title>
          <SvgFillGradient
            element={props.element}
            width={geometry().box.width}
            height={geometry().box.height}
          />
          <path
            data-smart-paint="svg"
            d={geometry().path}
            fill={
              props.element.visual.style?.fillGradient
                ? `url(#${gradientId(props.element.id)})`
                : (props.element.visual.style?.fill ?? "#1d2a2e")
            }
            stroke={
              props.element.visual.style?.strokeGradient
                ? `url(#${strokeGradientId(props.element.id)})`
                : (props.element.visual.style?.stroke ?? "none")
            }
            fill-rule={(props.element.semantic as PathSemantic).fillRule}
            {...svgStyle(props.element.visual, props.element.id)}
          />
        </svg>
      )}
    </Show>
  );
}
