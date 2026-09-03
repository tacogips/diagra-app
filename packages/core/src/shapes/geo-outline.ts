// The drawn outline of a `shape.geo`, as data.
//
// The renderer and the SVG exporter have to agree on where a hexagon's
// corners are, so the arithmetic lives here rather than in either of them.
// Coordinates are local to the shape's box, inset by one unit so a 1.5-wide
// stroke is not clipped by the box edge; an unknown kind falls back to the
// rectangle, matching the registry's forward-compatibility rule.

import type { GeoKind } from "@diagra/ir";

export type GeoOutline =
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
    }
  | {
      readonly kind: "ellipse";
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
    }
  | { readonly kind: "polygon"; readonly points: string }
  | {
      readonly kind: "cylinder";
      readonly path: string;
      readonly cap: {
        readonly cx: number;
        readonly cy: number;
        readonly rx: number;
        readonly ry: number;
      };
    };

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

/** Height of a cylinder's elliptical rim, capped so tall ones stay round. */
function cylinderRim(height: number): number {
  return Math.min(height * 0.15, 18);
}

function cylinderPath(width: number, height: number): string {
  const rim = cylinderRim(height);
  const right = width - 1;
  return [
    `M 1 ${rim}`,
    `A ${width / 2 - 1} ${rim} 0 0 1 ${right} ${rim}`,
    `L ${right} ${height - rim}`,
    `A ${width / 2 - 1} ${rim} 0 0 1 1 ${height - rim}`,
    "Z",
  ].join(" ");
}

function rectOutline(width: number, height: number): GeoOutline {
  return {
    kind: "rect",
    x: 1,
    y: 1,
    width: Math.max(0, width - 2),
    height: Math.max(0, height - 2),
    rx: 4,
  };
}

export function geoOutline(
  kind: GeoKind | string,
  width: number,
  height: number,
): GeoOutline {
  switch (kind) {
    case "ellipse":
      return {
        kind: "ellipse",
        cx: width / 2,
        cy: height / 2,
        rx: Math.max(0, width / 2 - 1),
        ry: Math.max(0, height / 2 - 1),
      };
    case "diamond":
      return {
        kind: "polygon",
        points: polygonPoints([
          [width / 2, 1],
          [width - 1, height / 2],
          [width / 2, height - 1],
          [1, height / 2],
        ]),
      };
    case "triangle":
      return {
        kind: "polygon",
        points: polygonPoints([
          [width / 2, 1],
          [width - 1, height - 1],
          [1, height - 1],
        ]),
      };
    case "hexagon":
      return {
        kind: "polygon",
        points: polygonPoints([
          [width * 0.25, 1],
          [width * 0.75, 1],
          [width - 1, height / 2],
          [width * 0.75, height - 1],
          [width * 0.25, height - 1],
          [1, height / 2],
        ]),
      };
    case "parallelogram":
      return {
        kind: "polygon",
        points: polygonPoints([
          [width * 0.25, 1],
          [width - 1, 1],
          [width * 0.75, height - 1],
          [1, height - 1],
        ]),
      };
    case "cylinder":
      return {
        kind: "cylinder",
        path: cylinderPath(width, height),
        cap: {
          cx: width / 2,
          cy: cylinderRim(height),
          rx: Math.max(0, width / 2 - 1),
          ry: cylinderRim(height),
        },
      };
    case "star":
      return { kind: "polygon", points: starPoints(width, height) };
    default:
      return rectOutline(width, height);
  }
}
