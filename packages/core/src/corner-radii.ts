import type { CornerRadii, VisualStyle } from "@diagra/ir";
import type { Box, Vec } from "./geometry.ts";

export function resolvedCornerRadii(
  style: VisualStyle | undefined,
  fallback = 0,
): CornerRadii {
  const radius = Math.max(0, style?.cornerRadius ?? fallback);
  return (
    style?.cornerRadii ?? {
      topLeft: radius,
      topRight: radius,
      bottomRight: radius,
      bottomLeft: radius,
    }
  );
}

/** Apply the same proportional overlap reduction used by CSS border radii. */
export function normalizedCornerRadii(
  box: Pick<Box, "width" | "height">,
  radii: CornerRadii,
): CornerRadii {
  const source = {
    topLeft: Math.max(0, radii.topLeft),
    topRight: Math.max(0, radii.topRight),
    bottomRight: Math.max(0, radii.bottomRight),
    bottomLeft: Math.max(0, radii.bottomLeft),
  };
  const ratios = [
    source.topLeft + source.topRight
      ? box.width / (source.topLeft + source.topRight)
      : 1,
    source.bottomLeft + source.bottomRight
      ? box.width / (source.bottomLeft + source.bottomRight)
      : 1,
    source.topLeft + source.bottomLeft
      ? box.height / (source.topLeft + source.bottomLeft)
      : 1,
    source.topRight + source.bottomRight
      ? box.height / (source.topRight + source.bottomRight)
      : 1,
  ];
  const scale = Math.max(0, Math.min(1, ...ratios));
  return {
    topLeft: source.topLeft * scale,
    topRight: source.topRight * scale,
    bottomRight: source.bottomRight * scale,
    bottomLeft: source.bottomLeft * scale,
  };
}

export function cornerRadiiCss(radii: CornerRadii): string {
  return `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`;
}

export function roundedRectPath(box: Box, input: CornerRadii): string {
  const r = normalizedCornerRadii(box, input);
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return [
    `M ${box.x + r.topLeft} ${box.y}`,
    `H ${right - r.topRight}`,
    `Q ${right} ${box.y} ${right} ${box.y + r.topRight}`,
    `V ${bottom - r.bottomRight}`,
    `Q ${right} ${bottom} ${right - r.bottomRight} ${bottom}`,
    `H ${box.x + r.bottomLeft}`,
    `Q ${box.x} ${bottom} ${box.x} ${bottom - r.bottomLeft}`,
    `V ${box.y + r.topLeft}`,
    `Q ${box.x} ${box.y} ${box.x + r.topLeft} ${box.y}`,
    "Z",
  ].join(" ");
}

/** Clockwise polygon approximation shared by clipping and mask geometry. */
export function roundedRectPolygon(
  box: Box,
  input: CornerRadii,
  segmentsPerCorner = 8,
): readonly Vec[] {
  const r = normalizedCornerRadii(box, input);
  const corners = [
    {
      cx: box.x + r.topLeft,
      cy: box.y + r.topLeft,
      radius: r.topLeft,
      from: Math.PI,
      to: Math.PI * 1.5,
    },
    {
      cx: box.x + box.width - r.topRight,
      cy: box.y + r.topRight,
      radius: r.topRight,
      from: Math.PI * 1.5,
      to: Math.PI * 2,
    },
    {
      cx: box.x + box.width - r.bottomRight,
      cy: box.y + box.height - r.bottomRight,
      radius: r.bottomRight,
      from: 0,
      to: Math.PI / 2,
    },
    {
      cx: box.x + r.bottomLeft,
      cy: box.y + box.height - r.bottomLeft,
      radius: r.bottomLeft,
      from: Math.PI / 2,
      to: Math.PI,
    },
  ];
  const points: Vec[] = [];
  const segments = Math.max(1, Math.floor(segmentsPerCorner));
  for (const corner of corners) {
    for (let at = 0; at <= segments; at += 1) {
      const angle = corner.from + ((corner.to - corner.from) * at) / segments;
      const point = {
        x: corner.cx + Math.cos(angle) * corner.radius,
        y: corner.cy + Math.sin(angle) * corner.radius,
      };
      const previous = points.at(-1);
      if (!previous || previous.x !== point.x || previous.y !== point.y)
        points.push(point);
    }
  }
  return points;
}

export function unevenRoundedBoxContains(
  box: Box,
  point: Vec,
  input: CornerRadii,
): boolean {
  if (
    point.x < box.x ||
    point.x > box.x + box.width ||
    point.y < box.y ||
    point.y > box.y + box.height
  )
    return false;
  const r = normalizedCornerRadii(box, input);
  const corners = [
    {
      radius: r.topLeft,
      cx: box.x + r.topLeft,
      cy: box.y + r.topLeft,
      left: true,
      top: true,
    },
    {
      radius: r.topRight,
      cx: box.x + box.width - r.topRight,
      cy: box.y + r.topRight,
      left: false,
      top: true,
    },
    {
      radius: r.bottomRight,
      cx: box.x + box.width - r.bottomRight,
      cy: box.y + box.height - r.bottomRight,
      left: false,
      top: false,
    },
    {
      radius: r.bottomLeft,
      cx: box.x + r.bottomLeft,
      cy: box.y + box.height - r.bottomLeft,
      left: true,
      top: false,
    },
  ];
  for (const corner of corners) {
    const inHorizontal = corner.left
      ? point.x < corner.cx
      : point.x > corner.cx;
    const inVertical = corner.top ? point.y < corner.cy : point.y > corner.cy;
    if (inHorizontal && inVertical)
      return (
        (point.x - corner.cx) ** 2 + (point.y - corner.cy) ** 2 <=
        corner.radius ** 2
      );
  }
  return true;
}
