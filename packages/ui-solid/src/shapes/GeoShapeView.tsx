// shape.geo: the eight primitives, drawn as inline SVG inside the shape's
// box, with an HTML label layered on top so text clipping is the browser's
// problem rather than ours.
//
// The geometry comes from the core (`geoOutline`) so the SVG exporter draws
// the same shape this does; only the markup is decided here.

import { type Box, type GeoOutline, geoOutline } from "@diagra/core";
import type { Element, GeoKind, GeoShapeSemantic } from "@diagra/ir";
import { type JSX, Match, Switch } from "solid-js";
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
  const attrs = () => svgStyle(props.element.visual);

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
        <Switch>
          <Match when={asKind(outline(), "ellipse")}>
            {(shape) => (
              <ellipse
                cx={shape().cx}
                cy={shape().cy}
                rx={shape().rx}
                ry={shape().ry}
                {...attrs()}
              />
            )}
          </Match>
          <Match when={asKind(outline(), "polygon")}>
            {(shape) => <polygon points={shape().points} {...attrs()} />}
          </Match>
          <Match when={asKind(outline(), "cylinder")}>
            {(shape) => (
              <g>
                <path d={shape().path} {...attrs()} />
                <ellipse
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
              <rect
                x={shape().x}
                y={shape().y}
                width={shape().width}
                height={shape().height}
                rx={shape().rx}
                {...attrs()}
              />
            )}
          </Match>
        </Switch>
      </svg>
      <div class="diagra-label" style={labelStyle(props.element.visual)}>
        {semantic().label}
      </div>
    </>
  );
}
