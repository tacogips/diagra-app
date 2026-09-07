// shape.geo: the eight primitives, drawn as inline SVG inside the shape's
// box, with an HTML label layered on top so text clipping is the browser's
// problem rather than ours.
//
// The geometry comes from the core (`geoOutline`) so the SVG exporter draws
// the same shape this does; only the markup is decided here.

import {
  type Box,
  type GeoOutline,
  geoOutline,
  resolvedCornerRadii,
  roundedRectPath,
} from "@diagra/core";
import type { Element, GeoKind, GeoShapeSemantic } from "@diagra/ir";
import { type JSX, Match, Switch } from "solid-js";
import { SvgFillGradient } from "./SvgFillGradient.tsx";
import { labelStyle, svgStyle } from "./visual.ts";

export interface GeoShapeViewProps {
  readonly element: Element;
  readonly box: Box;
}

function semanticOf(element: Element): GeoShapeSemantic {
  const semantic = element.semantic as Partial<GeoShapeSemantic> | null;
  return {
    geo: (semantic?.geo ?? "rect") as GeoKind,
    label: semantic?.label ?? "",
  };
}

/** Narrow an outline for one `Match` branch; `null` when it is not that one. */
function asKind<K extends GeoOutline["kind"]>(
  outline: GeoOutline,
  kind: K,
): Extract<GeoOutline, { kind: K }> | null {
  return outline.kind === kind
    ? (outline as Extract<GeoOutline, { kind: K }>)
    : null;
}

export function GeoShapeView(props: GeoShapeViewProps): JSX.Element {
  const semantic = () => semanticOf(props.element);
  const width = () => props.box.width;
  const height = () => props.box.height;
  const outline = () => geoOutline(semantic().geo, width(), height());
  const attrs = () => svgStyle(props.element.visual, props.element.id);

  return (
    <>
      <svg
        class="diagra-geo"
        width={width()}
        height={height()}
        viewBox={`0 0 ${width()} ${height()}`}
        preserveAspectRatio="none"
      >
        <title>{semantic().label || semantic().geo}</title>
        <SvgFillGradient
          element={props.element}
          width={width()}
          height={height()}
        />
        <Switch>
          <Match when={asKind(outline(), "ellipse")}>
            {(shape) => (
              <ellipse
                data-smart-paint="svg"
                cx={shape().cx}
                cy={shape().cy}
                rx={shape().rx}
                ry={shape().ry}
                {...attrs()}
              />
            )}
          </Match>
          <Match when={asKind(outline(), "polygon")}>
            {(shape) => (
              <polygon
                data-smart-paint="svg"
                points={shape().points}
                {...attrs()}
              />
            )}
          </Match>
          <Match when={asKind(outline(), "cylinder")}>
            {(shape) => (
              <g>
                <path data-smart-paint="svg" d={shape().path} {...attrs()} />
                <ellipse
                  data-smart-paint="svg"
                  cx={shape().cap.cx}
                  cy={shape().cap.cy}
                  rx={shape().cap.rx}
                  ry={shape().cap.ry}
                  {...attrs()}
                />
              </g>
            )}
          </Match>
          <Match when={asKind(outline(), "rect")}>
            {(shape) => (
              <path
                data-smart-paint="svg"
                data-smart-radius-path
                data-smart-width={shape().width}
                data-smart-height={shape().height}
                d={roundedRectPath(
                  {
                    x: shape().x,
                    y: shape().y,
                    width: shape().width,
                    height: shape().height,
                  },
                  resolvedCornerRadii(props.element.visual.style, shape().rx),
                )}
                {...attrs()}
              />
            )}
          </Match>
        </Switch>
      </svg>
      <div
        class="diagra-label"
        data-smart-text
        style={labelStyle(props.element.visual)}
      >
        {semantic().label}
      </div>
    </>
  );
}
