import type { FillGradient, GradientStop } from "@diagra/ir";

function fmt(value: number): string {
  return String(Number(value.toFixed(4)));
}

function cssStop(stop: GradientStop): string {
  const color =
    stop.opacity === undefined || stop.opacity === 1
      ? stop.color
      : `${stop.color}${Math.round(stop.opacity * 255)
          .toString(16)
          .padStart(2, "0")}`;
  return `${color} ${fmt(stop.offset * 100)}%`;
}

export interface GradientPatch {
  readonly points: string;
  readonly color: string;
  readonly opacity: number;
}

function channel(color: string, at: number): number {
  return Number.parseInt(color.slice(at, at + 2), 16);
}

/** Sample the portable stop ramp. Callers use this for non-native SVG paints. */
export function sampleGradient(
  stops: readonly GradientStop[],
  offset: number,
): { readonly color: string; readonly opacity: number } {
  const right = stops.findIndex((stop) => stop.offset >= offset);
  if (right < 0) {
    const stop = stops.at(-1);
    return { color: stop?.color ?? "#000000", opacity: stop?.opacity ?? 1 };
  }
  if (right === 0) {
    const stop = stops[0];
    return { color: stop?.color ?? "#000000", opacity: stop?.opacity ?? 1 };
  }
  const before = stops[right - 1] as GradientStop;
  const after = stops[right] as GradientStop;
  const span = after.offset - before.offset;
  const amount = span <= Number.EPSILON ? 1 : (offset - before.offset) / span;
  const hex = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");
  return {
    color: `#${hex(channel(before.color, 1) + (channel(after.color, 1) - channel(before.color, 1)) * amount)}${hex(channel(before.color, 3) + (channel(after.color, 3) - channel(before.color, 3)) * amount)}${hex(channel(before.color, 5) + (channel(after.color, 5) - channel(before.color, 5)) * amount)}`,
    opacity:
      (before.opacity ?? 1) +
      ((after.opacity ?? 1) - (before.opacity ?? 1)) * amount,
  };
}

function polarPoint(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
): readonly [number, number] {
  const radians = (angle * Math.PI) / 180;
  return [
    centerX + Math.sin(radians) * radius,
    centerY - Math.cos(radians) * radius,
  ];
}

/** Deterministic triangular approximation usable as an SVG paint pattern. */
export function angularGradientPatches(
  gradient: Extract<FillGradient, { readonly type: "angular" }>,
  width: number,
  height: number,
  x = 0,
  y = 0,
  segments = 120,
): readonly GradientPatch[] {
  const centerX = x + gradient.centerX * width;
  const centerY = y + gradient.centerY * height;
  const radius =
    Math.max(
      Math.hypot(centerX - x, centerY - y),
      Math.hypot(centerX - (x + width), centerY - y),
      Math.hypot(centerX - x, centerY - (y + height)),
      Math.hypot(centerX - (x + width), centerY - (y + height)),
      1,
    ) * 1.01;
  return Array.from({ length: segments }, (_, index) => {
    const from = index / segments;
    const to = (index + 1) / segments;
    const first = polarPoint(
      centerX,
      centerY,
      radius,
      gradient.angle + from * 360,
    );
    const second = polarPoint(
      centerX,
      centerY,
      radius,
      gradient.angle + to * 360,
    );
    return {
      points: `${fmt(centerX)},${fmt(centerY)} ${fmt(first[0])},${fmt(first[1])} ${fmt(second[0])},${fmt(second[1])}`,
      ...sampleGradient(gradient.stops, (from + to) / 2),
    };
  });
}

/** Nested polygons approximating a rotated diamond distance field. */
export function diamondGradientPatches(
  gradient: Extract<FillGradient, { readonly type: "diamond" }>,
  width: number,
  height: number,
  x = 0,
  y = 0,
  segments = 80,
): readonly GradientPatch[] {
  const centerX = x + gradient.centerX * width;
  const centerY = y + gradient.centerY * height;
  const base = Math.max(Math.abs(width), Math.abs(height), 1);
  const rotate = (px: number, py: number): readonly [number, number] => {
    const radians = (gradient.angle * Math.PI) / 180;
    const sine = Math.sin(radians);
    const cosine = Math.cos(radians);
    return [
      centerX + px * cosine - py * sine,
      centerY + px * sine + py * cosine,
    ];
  };
  return Array.from({ length: segments }, (_, index) => {
    const offset = (segments - index) / segments;
    const radius = gradient.radius * base * offset;
    const points = [
      rotate(0, -radius),
      rotate(radius, 0),
      rotate(0, radius),
      rotate(-radius, 0),
    ];
    return {
      points: points.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join(" "),
      ...sampleGradient(gradient.stops, offset),
    };
  });
}

function diamondDataImage(
  gradient: Extract<FillGradient, { readonly type: "diamond" }>,
): string {
  const outside = sampleGradient(gradient.stops, 1);
  const polygons = diamondGradientPatches(gradient, 100, 100)
    .map(
      (patch) =>
        `<polygon points="${patch.points}" fill="${patch.color}" fill-opacity="${fmt(patch.opacity)}"/>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="${outside.color}" fill-opacity="${fmt(outside.opacity)}"/>${polygons}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Validated gradients contain only numeric geometry and six-digit hex colors. */
export function gradientCss(gradient: FillGradient): string {
  const stops = gradient.stops.map(cssStop).join(", ");
  switch (gradient.type) {
    case "linear":
      return `linear-gradient(${fmt(gradient.angle)}deg, ${stops})`;
    case "radial":
      return `radial-gradient(circle ${fmt(gradient.radius * 100)}% at ${fmt(gradient.centerX * 100)}% ${fmt(gradient.centerY * 100)}%, ${stops})`;
    case "angular":
      return `conic-gradient(from ${fmt(gradient.angle)}deg at ${fmt(gradient.centerX * 100)}% ${fmt(gradient.centerY * 100)}%, ${stops})`;
    case "diamond":
      return diamondDataImage(gradient);
  }
}

/** Collision-free XML/CSS identifier derived from an arbitrary element ID. */
export function gradientId(id: string): string {
  return `diagra-gradient-${Array.from(id, (char) => char.codePointAt(0)?.toString(16)).join("-")}`;
}

export function strokeGradientId(id: string): string {
  return `${gradientId(id)}-stroke`;
}

/** Object-bounding-box endpoints matching a CSS angle for the given aspect ratio. */
export function linearGradientVector(
  angle: number,
  width: number,
  height: number,
) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const safeWidth = Math.max(Math.abs(width), Number.EPSILON);
  const safeHeight = Math.max(Math.abs(height), Number.EPSILON);
  const half = (Math.abs(safeWidth * dx) + Math.abs(safeHeight * dy)) / 2;
  const x = (dx * half) / safeWidth;
  const y = (dy * half) / safeHeight;
  const clean = (value: number) => Number(value.toFixed(12));
  return {
    x1: clean(0.5 - x),
    y1: clean(0.5 - y),
    x2: clean(0.5 + x),
    y2: clean(0.5 + y),
  };
}
