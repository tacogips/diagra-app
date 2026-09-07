import { freehandGeometry, gradientId, strokeGradientId } from "@diagra/core";
import type { Element } from "@diagra/ir";
import { type JSX, Show } from "solid-js";
import { SvgFillGradient } from "./SvgFillGradient.tsx";
import { svgStyle } from "./visual.ts";
export function FreehandView(props: { element: Element }): JSX.Element {
  const fillPaint = () =>
    props.element.visual.style?.fillGradient
      ? `url(#${gradientId(props.element.id)})`
      : (props.element.visual.style?.fill ?? "none");
  const strokePaint = () =>
    props.element.visual.style?.strokeGradient
      ? `url(#${strokeGradientId(props.element.id)})`
      : (props.element.visual.style?.stroke ?? "#1d2a2e");
  return (
    <Show when={freehandGeometry(props.element)}>
      {(geometry) => (
        <svg width="100%" height="100%" style={{ overflow: "visible" }}>
          <title>Freehand stroke</title>
          <SvgFillGradient
            element={props.element}
            width={geometry().box.width}
            height={geometry().box.height}
          />
          <Show
            when={geometry().pressureOutline}
            fallback={
              <path
                data-smart-paint="svg"
                d={geometry().path}
                fill="none"
                stroke="#1d2a2e"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                {...svgStyle(props.element.visual, props.element.id)}
              />
            }
          >
            {(outline) => (
              <>
                <Show
                  when={
                    (props.element.semantic as { closed?: boolean }).closed ===
                      true && fillPaint() !== "none"
                  }
                >
                  <path
                    data-smart-paint="svg"
                    d={geometry().path}
                    fill={fillPaint()}
                    stroke="none"
                  />
                </Show>
                <path
                  data-smart-pressure
                  d={outline().path}
                  fill={strokePaint()}
                  fill-rule="evenodd"
                  stroke="none"
                />
              </>
            )}
          </Show>
        </svg>
      )}
    </Show>
  );
}
