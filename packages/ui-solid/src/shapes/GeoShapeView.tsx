// shape.geo: the eight primitives, drawn as inline SVG inside the shape's
// box, with an HTML label layered on top so text clipping is the browser's
// problem rather than ours.

import type { Box } from "@diagra/core";
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

function polygonPoints(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

function starPoints(width: number, height: number): string {
  const cx = width / 2;
  const cy = height / 2;
  const outerX = cx - 1;
  const outerY = cy - 1;
  const points: [number, number][] = [];
  for (let i = 0; i < 10; i += 1) {
    // Start at the top point and alternate outer/inner radius.
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const scale = i % 2 === 0 ? 1 : 0.4;
    points.push([
      cx + Math.cos(angle) * outerX * scale,
      cy + Math.sin(angle) * outerY * scale,
    ]);
  }
  return polygonPoints(points);
}

function cylinderPath(width: number, height: number): string {
  const rim = Math.min(height * 0.15, 18);
  const right = width - 1;
  return [
    `M 1 ${rim}`,
    `A ${width / 2 - 1} ${rim} 0 0 1 ${right} ${rim}`,
    `L ${right} ${height - rim}`,
    `A ${width / 2 - 1} ${rim} 0 0 1 1 ${height - rim}`,
    "Z",
  ].join(" ");
}

export function GeoShapeView(props: GeoShapeViewProps): JSX.Element {
  const semantic = () => semanticOf(props.element);
  const width = () => props.box.width;
  const height = () => props.box.height;
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
        <Switch
          fallback={
            <rect
              x="1"
              y="1"
              width={Math.max(0, width() - 2)}
              height={Math.max(0, height() - 2)}
              rx="4"
              {...attrs()}
            />
          }
        >
          <Match when={semantic().geo === "ellipse"}>
            <ellipse
              cx={width() / 2}
              cy={height() / 2}
              rx={Math.max(0, width() / 2 - 1)}
              ry={Math.max(0, height() / 2 - 1)}
              {...attrs()}
            />
          </Match>
          <Match when={semantic().geo === "diamond"}>
            <polygon
              points={polygonPoints([
                [width() / 2, 1],
                [width() - 1, height() / 2],
                [width() / 2, height() - 1],
                [1, height() / 2],
              ])}
              {...attrs()}
            />
          </Match>
          <Match when={semantic().geo === "triangle"}>
            <polygon
              points={polygonPoints([
                [width() / 2, 1],
                [width() - 1, height() - 1],
                [1, height() - 1],
              ])}
              {...attrs()}
            />
          </Match>
          <Match when={semantic().geo === "hexagon"}>
            <polygon
              points={polygonPoints([
                [width() * 0.25, 1],
                [width() * 0.75, 1],
                [width() - 1, height() / 2],
                [width() * 0.75, height() - 1],
                [width() * 0.25, height() - 1],
                [1, height() / 2],
              ])}
              {...attrs()}
            />
          </Match>
          <Match when={semantic().geo === "parallelogram"}>
            <polygon
              points={polygonPoints([
                [width() * 0.25, 1],
                [width() - 1, 1],
                [width() * 0.75, height() - 1],
                [1, height() - 1],
              ])}
              {...attrs()}
            />
          </Match>
          <Match when={semantic().geo === "cylinder"}>
            <g>
              <path d={cylinderPath(width(), height())} {...attrs()} />
              <ellipse
                cx={width() / 2}
                cy={Math.min(height() * 0.15, 18)}
                rx={Math.max(0, width() / 2 - 1)}
                ry={Math.min(height() * 0.15, 18)}
                {...attrs()}
              />
            </g>
          </Match>
          <Match when={semantic().geo === "star"}>
            <polygon points={starPoints(width(), height())} {...attrs()} />
          </Match>
        </Switch>
      </svg>
      <div class="diagra-label" style={labelStyle(props.element.visual)}>
        {semantic().label}
      </div>
    </>
  );
}
