import type {
  BooleanOperation,
  Element,
  ElementId,
  FreehandSemantic,
  GeoShapeSemantic,
  GroupSemantic,
  PathSemantic,
} from "@diagra/ir";
import { getElementTypeDefinition } from "@diagra/ir";
import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import { boxPolygon, polygonBounds } from "./clipping.ts";
import type { Command } from "./commands.ts";
import type { Editor } from "./editor.ts";
import type { Rng } from "./fractional.ts";
import { type Box, boxCenter, rotatePoint, unionBoxes } from "./geometry.ts";
import {
  expandGroups,
  type GroupPlan,
  memberIdsOf,
  planGroup,
} from "./group.ts";
import type { ShapeContext } from "./shape-util.ts";
import { elementOutlinePolygon } from "./shapes/outline.ts";
import { remapReferences } from "./references.ts";
import type { Store } from "./store.ts";
import { compoundPathGeometry } from "./shapes/compound-path.ts";
import { freehandGeometry } from "./shapes/freehand.ts";
import { flattenStroke } from "./stroke-path.ts";
import { dashPolyline, resolvedStrokeDashArray } from "./stroke-dash.ts";

export type BooleanPolygon = readonly {
  readonly x: number;
  readonly y: number;
}[];
export type BooleanMultiPolygon = readonly (readonly BooleanPolygon[])[];

export interface BooleanGeometry {
  readonly operation: BooleanOperation;
  /** One canonical multipolygon per ordered member. */
  readonly operands: readonly BooleanMultiPolygon[];
  /** First exterior ring per operand, retained for simple-shape consumers. */
  readonly polygons: readonly BooleanPolygon[];
  readonly bounds: Box;
}

export interface FlattenBooleanPlan {
  readonly id: ElementId;
  readonly commands: readonly Command[];
}

function number(value: number): string {
  return String(Number(value.toFixed(4)));
}

function path(
  polygon: readonly { readonly x: number; readonly y: number }[],
): string {
  return `${polygon
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${number(point.x)} ${number(point.y)}`,
    )
    .join(" ")} Z`;
}

/** Polygonal paint silhouette supported by the non-destructive mask renderer. */
export function booleanSourcePolygon(
  element: Element | undefined,
  context: ShapeContext,
): readonly { readonly x: number; readonly y: number }[] | null {
  const category = element
    ? getElementTypeDefinition(element.type)?.category
    : undefined;
  if (
    !element ||
    element.type === "group" ||
    category === "edge" ||
    category === "resource" ||
    (element.type === "draw.freehand" &&
      (element.semantic as FreehandSemantic).closed !== true)
  )
    return null;
  if (element.type === "draw.path") {
    const contours = (element.semantic as PathSemantic).contours;
    if (contours.length !== 1) return null;
  }
  const box = context.boundsOf(element.id);
  if (!box) return null;
  let polygon = elementOutlinePolygon(element, context);
  if (!polygon) {
    if (
      (element.type === "shape.geo" &&
        (element.semantic as GeoShapeSemantic).geo !== "rect") ||
      element.type === "draw.freehand"
    )
      return null;
    polygon = boxPolygon(box);
  }
  const rotation = element.visual.rotation ?? 0;
  return rotation
    ? polygon.map((point) => rotatePoint(point, boxCenter(box), rotation))
    : polygon;
}

function fromClipped(value: MultiPolygon): BooleanMultiPolygon {
  return value.map((polygon) =>
    polygon.map((ring) => {
      const open =
        ring.length > 1 &&
        ring[0]?.[0] === ring.at(-1)?.[0] &&
        ring[0]?.[1] === ring.at(-1)?.[1]
          ? ring.slice(0, -1)
          : ring;
      return open.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 }));
    }),
  );
}

function toClipped(value: BooleanMultiPolygon): MultiPolygon {
  return value.map((polygon) =>
    polygon.map((ring) => ring.map((point) => [point.x, point.y])),
  );
}

type ClippedPoint = [number, number];

function clippedPart(
  points: readonly { readonly x: number; readonly y: number }[],
): Polygon {
  return [points.map((point): ClippedPoint => [point.x, point.y])];
}

function circlePart(
  center: { readonly x: number; readonly y: number },
  radius: number,
): Polygon {
  const segments = Math.max(16, Math.min(64, Math.ceil(Math.PI * radius)));
  return clippedPart(
    Array.from({ length: segments }, (_, index) => {
      // Half-step sampling avoids cardinal vertices that become numerically
      // coincident with adjacent stroke rectangles inside polygon-clipping.
      const angle = ((index + 0.5) * Math.PI * 2) / segments;
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    }),
  );
}

function signedRingArea(
  ring: readonly { readonly x: number; readonly y: number }[],
): number {
  return ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return area + point.x * (next?.y ?? 0) - (next?.x ?? 0) * point.y;
  }, 0);
}

/**
 * Convert disjoint or strictly nested SVG non-zero contours into GeoJSON
 * polygon rings. Crossing overlaps are deliberately rejected: assigning their
 * faces requires a planar winding arrangement, and guessing would make the
 * Boolean operand disagree with the SVG path.
 */
function nonzeroPathPolygons(
  rings: readonly BooleanPolygon[],
): MultiPolygon | null {
  const entries = rings.map((ring, index) => ({
    index,
    ring,
    polygon: clippedPart(ring),
    area: signedRingArea(ring),
    parent: -1,
    winding: 0,
    owner: -1,
  }));
  if (entries.some((entry) => Math.abs(entry.area) <= Number.EPSILON))
    return null;
  for (const child of entries) {
    let parent: (typeof entries)[number] | undefined;
    for (const candidate of entries) {
      if (
        candidate.index === child.index ||
        Math.abs(candidate.area) <= Math.abs(child.area)
      )
        continue;
      const outside = polygonClipping.difference(
        child.polygon,
        candidate.polygon,
      );
      if (!outside.length) {
        if (!parent || Math.abs(candidate.area) < Math.abs(parent.area))
          parent = candidate;
        continue;
      }
      const overlap = polygonClipping.intersection(
        child.polygon,
        candidate.polygon,
      );
      if (overlap.length) return null;
    }
    child.parent = parent?.index ?? -1;
  }
  const ordered = [...entries].sort(
    (a, b) => Math.abs(b.area) - Math.abs(a.area),
  );
  const polygons: Polygon[] = [];
  for (const entry of ordered) {
    const parent = entry.parent < 0 ? undefined : entries[entry.parent];
    const sign = entry.area > 0 ? 1 : -1;
    const previous = parent?.winding ?? 0;
    entry.winding = previous + sign;
    if (previous === 0 && entry.winding !== 0) {
      entry.owner = polygons.length;
      polygons.push(clippedPart(entry.ring));
    } else if (previous !== 0 && entry.winding === 0) {
      const owner = parent?.owner ?? -1;
      if (owner < 0 || !polygons[owner]) return null;
      polygons[owner]?.push(entry.ring.map((point) => [point.x, point.y]));
      entry.owner = -1;
    } else entry.owner = parent?.owner ?? -1;
  }
  const [first, ...rest] = polygons;
  return first ? polygonClipping.union(first, ...rest) : [];
}

function unionParts(parts: readonly Polygon[]): MultiPolygon {
  let level: MultiPolygon[] = parts.map((part) => [part]);
  while (level.length > 1) {
    const next: MultiPolygon[] = [];
    for (let index = 0; index < level.length; index += 32) {
      const batch = level.slice(index, index + 32);
      const [first, ...rest] = batch;
      if (first) next.push(polygonClipping.union(first, ...rest));
    }
    level = next;
  }
  return level[0] ?? [];
}

function lineIntersection(
  a: { readonly x: number; readonly y: number },
  directionA: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  directionB: { readonly x: number; readonly y: number },
) {
  const cross = directionA.x * directionB.y - directionA.y * directionB.x;
  if (Math.abs(cross) <= 1e-9) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const at = (dx * directionB.y - dy * directionB.x) / cross;
  return { x: a.x + directionA.x * at, y: a.y + directionA.y * at };
}

function fixedStrokeParts(
  points: readonly { readonly x: number; readonly y: number }[],
  strokeWidth: number,
  cap: "butt" | "round" | "square",
  join: "miter" | "round" | "bevel",
  miterLimit: number,
): Polygon[] {
  const radius = strokeWidth / 2;
  const cleanPoints = points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1]?.x ||
      point.y !== points[index - 1]?.y,
  );
  const segments = cleanPoints.slice(0, -1).flatMap((from, index) => {
    const to = cleanPoints[index + 1];
    if (!to) return [];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length <= Number.EPSILON) return [];
    const direction = {
      x: (to.x - from.x) / length,
      y: (to.y - from.y) / length,
    };
    const normal = { x: -direction.y, y: direction.x };
    return [{ from, to, direction, normal }];
  });
  if (!segments.length) return [];
  const parts: Polygon[] = segments.map(({ from, to, normal }) =>
    clippedPart([
      { x: from.x + normal.x * radius, y: from.y + normal.y * radius },
      { x: to.x + normal.x * radius, y: to.y + normal.y * radius },
      { x: to.x - normal.x * radius, y: to.y - normal.y * radius },
      { x: from.x - normal.x * radius, y: from.y - normal.y * radius },
    ]),
  );
  for (let index = 1; index < segments.length; index += 1) {
    const before = segments[index - 1];
    const after = segments[index];
    if (!before || !after) continue;
    const point = before.to;
    const turn =
      before.direction.x * after.direction.y -
      before.direction.y * after.direction.x;
    if (Math.abs(turn) <= 1e-9) continue;
    if (join === "round") {
      parts.push(circlePart(point, radius));
      continue;
    }
    const side = turn > 0 ? -1 : 1;
    const from = {
      x: point.x + before.normal.x * radius * side,
      y: point.y + before.normal.y * radius * side,
    };
    const to = {
      x: point.x + after.normal.x * radius * side,
      y: point.y + after.normal.y * radius * side,
    };
    const miter = lineIntersection(from, before.direction, to, after.direction);
    if (
      join === "miter" &&
      miter &&
      Math.hypot(miter.x - point.x, miter.y - point.y) <= radius * miterLimit
    )
      parts.push(clippedPart([point, from, miter, to]));
    else parts.push(clippedPart([point, from, to]));
  }
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) return parts;
  if (cap === "round") {
    parts.push(circlePart(first.from, radius), circlePart(last.to, radius));
  } else if (cap === "square") {
    parts.push(
      clippedPart([
        {
          x: first.from.x + first.normal.x * radius,
          y: first.from.y + first.normal.y * radius,
        },
        {
          x: first.from.x - first.normal.x * radius,
          y: first.from.y - first.normal.y * radius,
        },
        {
          x:
            first.from.x - first.normal.x * radius - first.direction.x * radius,
          y:
            first.from.y - first.normal.y * radius - first.direction.y * radius,
        },
        {
          x:
            first.from.x + first.normal.x * radius - first.direction.x * radius,
          y:
            first.from.y + first.normal.y * radius - first.direction.y * radius,
        },
      ]),
      clippedPart([
        {
          x: last.to.x + last.normal.x * radius,
          y: last.to.y + last.normal.y * radius,
        },
        {
          x: last.to.x - last.normal.x * radius,
          y: last.to.y - last.normal.y * radius,
        },
        {
          x: last.to.x - last.normal.x * radius + last.direction.x * radius,
          y: last.to.y - last.normal.y * radius + last.direction.y * radius,
        },
        {
          x: last.to.x + last.normal.x * radius + last.direction.x * radius,
          y: last.to.y + last.normal.y * radius + last.direction.y * radius,
        },
      ]),
    );
  }
  return parts;
}

function openStrokeSourceMultiPolygon(
  element: Element,
): BooleanMultiPolygon | null {
  const semantic = element.semantic as FreehandSemantic;
  const style = element.visual.style;
  if (
    element.type !== "draw.freehand" ||
    semantic.closed === true ||
    (!style?.strokeGradient &&
      (style?.stroke === "none" || style?.stroke === "transparent"))
  )
    return null;
  const geometry = freehandGeometry(element);
  const strokeWidth = style?.strokeWidth ?? 2;
  if (!geometry || !Number.isFinite(strokeWidth) || strokeWidth <= 0)
    return null;
  let parts: Polygon[];
  if (geometry.pressureOutline) {
    const samples = geometry.pressureOutline.samples;
    parts = samples.slice(0, -1).flatMap((from, index) => {
      const to = samples[index + 1];
      if (!to) return [];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length <= Number.EPSILON) return [];
      const normal = {
        x: -(to.y - from.y) / length,
        y: (to.x - from.x) / length,
      };
      return [
        clippedPart([
          {
            x: from.x + normal.x * from.radius,
            y: from.y + normal.y * from.radius,
          },
          { x: to.x + normal.x * to.radius, y: to.y + normal.y * to.radius },
          { x: to.x - normal.x * to.radius, y: to.y - normal.y * to.radius },
          {
            x: from.x - normal.x * from.radius,
            y: from.y - normal.y * from.radius,
          },
        ]),
      ];
    });
    parts.push(...samples.map((sample) => circlePart(sample, sample.radius)));
  } else {
    const pattern = resolvedStrokeDashArray(style);
    const fragments = dashPolyline(
      flattenStroke(geometry.points, false, 0.25),
      pattern,
      style?.strokeDashOffset ?? 0,
    );
    parts = fragments.flatMap((fragment) =>
      fixedStrokeParts(
        fragment,
        strokeWidth,
        style?.strokeCap ?? "round",
        style?.strokeJoin ?? "round",
        style?.strokeMiterLimit ?? 4,
      ),
    );
  }
  if (!parts.length) return null;
  try {
    const local = fromClipped(unionParts(parts));
    const center = boxCenter(geometry.box);
    const rotation = element.visual.rotation ?? 0;
    return local.map((polygon) =>
      polygon.map((ring) =>
        ring.map((point) => {
          const page = {
            x: point.x + geometry.box.x,
            y: point.y + geometry.box.y,
          };
          return rotation ? rotatePoint(page, center, rotation) : page;
        }),
      ),
    );
  } catch {
    return null;
  }
}

function pathSourceMultiPolygon(element: Element): BooleanMultiPolygon | null {
  const semantic = element.semantic as PathSemantic;
  const geometry = compoundPathGeometry(element);
  if (!geometry) return null;
  const center = boxCenter(geometry.box);
  const rotation = element.visual.rotation ?? 0;
  const rings = geometry.contours.map((contour) =>
    flattenStroke(contour, true, 0.25).map((point) => {
      const page = {
        x: point.x + geometry.box.x,
        y: point.y + geometry.box.y,
      };
      return rotation ? rotatePoint(page, center, rotation) : page;
    }),
  );
  if (rings.some((ring) => ring.length < 3)) return null;
  try {
    if (semantic.fillRule === "nonzero") {
      const polygons = nonzeroPathPolygons(rings);
      return polygons ? fromClipped(polygons) : null;
    }
    const operands = rings.map(
      (ring): Polygon => [ring.map((point) => [point.x, point.y])],
    );
    const [first, ...rest] = operands;
    if (!first) return null;
    return fromClipped(
      semantic.fillRule === "evenodd"
        ? polygonClipping.xor(first, ...rest)
        : polygonClipping.union(first),
    );
  } catch {
    return null;
  }
}

/** Exact filled silhouette accepted as one Boolean operand. */
export function booleanSourceGeometry(
  element: Element | undefined,
  context: ShapeContext,
  visited: ReadonlySet<ElementId> = new Set(),
): BooleanMultiPolygon | null {
  if (!element || visited.has(element.id)) return null;
  if (element.type === "draw.path") return pathSourceMultiPolygon(element);
  if (
    element.type === "draw.freehand" &&
    (element.semantic as FreehandSemantic).closed !== true
  )
    return openStrokeSourceMultiPolygon(element);
  if (element.type === "group") {
    const nested = booleanGeometryInternal(element, context, visited);
    if (!nested) return null;
    try {
      return fromClipped(clippedPolygons(nested));
    } catch {
      return null;
    }
  }
  const polygon = booleanSourcePolygon(element, context);
  return polygon ? [[polygon]] : null;
}

function clippedPolygons(geometry: BooleanGeometry): MultiPolygon {
  const operands = geometry.operands.map(toClipped);
  const [first, ...rest] = operands;
  if (!first) return [];
  switch (geometry.operation) {
    case "union":
      return polygonClipping.union(first, ...rest);
    case "subtract":
      return polygonClipping.difference(first, ...rest);
    case "intersect":
      return polygonClipping.intersection(first, ...rest);
    case "exclude":
      return polygonClipping.xor(first, ...rest);
  }
}

/** Canonical final silhouette, grouped as polygons with exterior/hole rings. */
export function booleanResultGeometry(
  geometry: BooleanGeometry,
): BooleanMultiPolygon {
  try {
    return fromClipped(clippedPolygons(geometry));
  } catch {
    return [];
  }
}

export function canFlattenBooleanGroup(
  store: Store,
  groupId: ElementId,
  context: ShapeContext,
): boolean {
  if (context.isLocked?.(groupId)) return false;
  const group = store.get(groupId);
  if (!group || group.type !== "group") return false;
  const members = memberIdsOf(group);
  if (
    members.length < 2 ||
    members.some((member) => context.isLocked?.(member))
  )
    return false;
  const geometry = booleanGeometry(group, context);
  if (!geometry) return false;
  try {
    return clippedPolygons(geometry).some((polygon) =>
      polygon.some((ring) => ring.length >= 4),
    );
  } catch {
    return false;
  }
}

function clean(value: number): number {
  const rounded = Number(value.toFixed(4));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Replace one Boolean group and its operands with an editable compound path. */
export function planFlattenBooleanGroup(
  store: Store,
  groupId: ElementId,
  id: ElementId,
  context: ShapeContext,
): FlattenBooleanPlan | null {
  if (store.has(id) || !canFlattenBooleanGroup(store, groupId, context))
    return null;
  const group = store.get(groupId);
  if (!group || group.type !== "group") return null;
  const members = memberIdsOf(group);
  if (
    members.length < 2 ||
    members.some((member) => context.isLocked?.(member))
  )
    return null;
  const geometry = booleanGeometry(group, context);
  if (!geometry) return null;
  let clipped: MultiPolygon;
  try {
    clipped = clippedPolygons(geometry);
  } catch {
    return null;
  }
  const rings = clipped.flat().flatMap((ring) => {
    const open =
      ring.length > 1 &&
      ring[0]?.[0] === ring.at(-1)?.[0] &&
      ring[0]?.[1] === ring.at(-1)?.[1]
        ? ring.slice(0, -1)
        : ring;
    return open.length >= 3 ? [open] : [];
  });
  const bounds = unionBoxes(
    rings.flatMap((ring) => {
      const box = polygonBounds(
        ring.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 })),
      );
      return box ? [box] : [];
    }),
  );
  if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !rings.length)
    return null;
  const first = expandGroups(store, [members[0] ?? ""])
    .map((member) => store.get(member))
    .find((member) => member && member.type !== "group");
  if (!first) return null;
  const {
    x: _sourceX,
    y: _sourceY,
    width: _sourceWidth,
    height: _sourceHeight,
    rotation: _sourceRotation,
    ...sourceVisual
  } = first.visual;
  const {
    x: _groupX,
    y: _groupY,
    width: _groupWidth,
    height: _groupHeight,
    rotation: _groupRotation,
    style: groupStyle,
    ...groupVisual
  } = group.visual;
  const firstStyle = first.visual.style;
  const flattenedStyle =
    first.type === "draw.freehand" &&
    (first.semantic as FreehandSemantic).closed !== true
      ? (() => {
          const {
            stroke,
            strokeGradient,
            strokeWidth: _strokeWidth,
            strokeCap: _strokeCap,
            strokeJoin: _strokeJoin,
            strokeMiterLimit: _strokeMiterLimit,
            strokeDashArray: _strokeDashArray,
            strokeDashOffset: _strokeDashOffset,
            dash: _dash,
            ...rest
          } = firstStyle ?? {};
          return {
            ...rest,
            fill: stroke ?? "#1d2a2e",
            ...(strokeGradient ? { fillGradient: strokeGradient } : {}),
          };
        })()
      : firstStyle;
  const semantic: PathSemantic = {
    name: "Flattened Boolean",
    contours: rings.map((ring) => ({
      points: ring.map(([x, y]) => ({
        x: clean((x ?? 0) - bounds.x),
        y: clean((y ?? 0) - bounds.y),
      })),
    })),
    fillRule: "evenodd",
  };
  const pathElement: Element = {
    id,
    page: group.page,
    type: "draw.path",
    index: group.index,
    semantic,
    visual: {
      ...sourceVisual,
      ...groupVisual,
      x: clean(bounds.x),
      y: clean(bounds.y),
      width: clean(bounds.width),
      height: clean(bounds.height),
      style: { ...flattenedStyle, ...groupStyle },
    },
    ...(group.accessibility
      ? { accessibility: group.accessibility }
      : first.accessibility
        ? { accessibility: first.accessibility }
        : {}),
    ...(group.extensions ? { extensions: group.extensions } : {}),
  };
  const removed = new Set([groupId, ...expandGroups(store, members)]);
  const mapping = new Map([...removed].map((removedId) => [removedId, id]));
  const commands: Command[] = [{ type: "createElement", element: pathElement }];
  for (const element of store.getPageElements(group.page)) {
    if (removed.has(element.id)) continue;
    const next = remapReferences(element.type, element.semantic, mapping);
    if (next !== element.semantic)
      commands.push({ type: "updateSemantic", id: element.id, semantic: next });
  }
  commands.push({ type: "deleteElements", ids: [...removed] });
  return { id, commands };
}

function booleanGeometryInternal(
  group: Element,
  context: ShapeContext,
  visited: ReadonlySet<ElementId>,
): BooleanGeometry | null {
  if (group.type !== "group" || visited.has(group.id)) return null;
  const operation = (group.semantic as GroupSemantic).booleanOperation;
  if (!operation) return null;
  const next = new Set(visited);
  next.add(group.id);
  const operands = memberIdsOf(group).map((id) =>
    booleanSourceGeometry(context.resolve(id), context, next),
  );
  if (operands.length < 2 || operands.some((operand) => operand === null))
    return null;
  const complete = operands as readonly BooleanMultiPolygon[];
  const bounds = unionBoxes(
    complete
      .flat(2)
      .map((ring) => polygonBounds(ring))
      .filter((box): box is Box => box !== null),
  );
  const polygons = complete.map((operand) => operand[0]?.[0] ?? []);
  return bounds ? { operation, operands: complete, polygons, bounds } : null;
}

/** Resolve nested ordered Boolean operands to canonical page-space outlines. */
export function booleanGeometry(
  group: Element,
  context: ShapeContext,
): BooleanGeometry | null {
  return booleanGeometryInternal(group, context, new Set());
}

/** Luminance-mask contents shared by canvas data URLs and standalone SVG. */
export function booleanMaskBody(geometry: BooleanGeometry): string {
  const { bounds, operation, operands } = geometry;
  const operandPath = (operand: BooleanMultiPolygon) =>
    operand.flat().map(path).join(" ");
  if (operation === "union")
    return operands
      .map(
        (operand) =>
          `<path d="${operandPath(operand)}" fill="white" fill-rule="evenodd"/>`,
      )
      .join("");
  if (operation === "subtract")
    return operands
      .map(
        (operand, index) =>
          `<path d="${operandPath(operand)}" fill="${index ? "black" : "white"}" fill-rule="evenodd"/>`,
      )
      .join("");
  if (operation === "exclude")
    return `<path d="${operands.map(operandPath).join(" ")}" fill="white" fill-rule="evenodd"/>`;

  const outer = [
    `M${number(bounds.x)} ${number(bounds.y)}`,
    `H${number(bounds.x + bounds.width)}`,
    `V${number(bounds.y + bounds.height)}`,
    `H${number(bounds.x)}`,
    "Z",
  ].join(" ");
  return [
    `<path d="${operandPath(operands[0] ?? [])}" fill="white" fill-rule="evenodd"/>`,
    ...operands
      .slice(1)
      .map(
        (operand) =>
          `<path d="${outer} ${operandPath(operand)}" fill="black" fill-rule="evenodd"/>`,
      ),
  ].join("");
}

export function booleanMaskDefinition(
  id: string,
  geometry: BooleanGeometry,
): string {
  const { bounds } = geometry;
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${number(bounds.x)}" y="${number(bounds.y)}" width="${number(bounds.width)}" height="${number(bounds.height)}" mask-type="luminance">${booleanMaskBody(geometry)}</mask>`;
}

/** CSS mask image in the Boolean group's own bounding box. */
export function booleanMaskCss(geometry: BooleanGeometry): string {
  const { bounds } = geometry;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${number(bounds.x)} ${number(bounds.y)} ${number(bounds.width)} ${number(bounds.height)}"><defs>${booleanMaskDefinition("m", geometry)}</defs><rect x="${number(bounds.x)}" y="${number(bounds.y)}" width="${number(bounds.width)}" height="${number(bounds.height)}" fill="white" mask="url(#m)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function booleanGeometryContains(
  geometry: BooleanGeometry,
  point: { readonly x: number; readonly y: number },
): boolean {
  const ringContains = (polygon: BooleanPolygon) => {
    let contained = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const a = polygon[i];
      const b = polygon[j];
      if (!a || !b) continue;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        contained = !contained;
    }
    return contained;
  };
  const inside = geometry.operands.map(
    (operand) =>
      operand.flat().filter((ring) => ringContains(ring)).length % 2 === 1,
  );
  switch (geometry.operation) {
    case "union":
      return inside.some(Boolean);
    case "subtract":
      return inside[0] === true && inside.slice(1).every((value) => !value);
    case "intersect":
      return inside.every(Boolean);
    case "exclude":
      return inside.filter(Boolean).length % 2 === 1;
  }
}

export function setGroupBooleanOperation(
  editor: Editor,
  groupId: ElementId,
  operation: BooleanOperation | null,
): boolean {
  const group = editor.store.get(groupId);
  if (
    group?.type !== "group" ||
    editor.createShapeContext().isLocked?.(groupId)
  )
    return false;
  const semantic = group.semantic as GroupSemantic;
  if ((semantic.booleanOperation ?? null) === operation) return false;
  if (operation) {
    const context = editor.createShapeContext();
    const members = memberIdsOf(group);
    if (
      members.length < 2 ||
      members.some(
        (id) => booleanSourceGeometry(editor.store.get(id), context) === null,
      )
    )
      return false;
  }
  const { booleanOperation: _operation, maskId: _mask, ...rest } = semantic;
  editor.apply([
    {
      type: "updateSemantic",
      id: groupId,
      semantic: operation ? { ...rest, booleanOperation: operation } : rest,
    },
  ]);
  return true;
}

/** Atomically wrap eligible selection units in a Boolean group. */
export function planBooleanGroup(
  store: Store,
  memberIds: Iterable<ElementId>,
  id: ElementId,
  rng: Rng,
  context: ShapeContext,
  operation: BooleanOperation,
): GroupPlan | null {
  const plan = planGroup(store, memberIds, id, rng);
  const create = plan?.commands[0];
  if (!plan || create?.type !== "createElement") return null;
  const selected = new Set(memberIdsOf(create.element));
  const members = store
    .getPageElements(create.element.page)
    .filter((element) => selected.has(element.id))
    .map((element) => element.id);
  if (
    members.some(
      (member) => booleanSourceGeometry(store.get(member), context) === null,
    )
  )
    return null;
  return {
    ...plan,
    commands: [
      {
        ...create,
        element: {
          ...create.element,
          semantic: { memberIds: members, booleanOperation: operation },
        },
      },
    ],
  };
}
