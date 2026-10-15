import {
  UmlComponentType,
  UmlComponentRelationship,
  type Element,
  type UmlPortSide,
  type UmlPortSemantic,
} from "@nodetto/ir";
import {
  boxContains,
  boxCenter,
  rotatePoint,
  type Box,
  type Vec,
} from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";
import { createConnectorUtil, readDirectEndpoints } from "./connector.ts";

export function umlComponentBounds(element: Element): Box {
  const port = element.type === UmlComponentType.Port;
  const iface = element.type === UmlComponentType.Interface;
  return {
    x: element.visual.x ?? 0,
    y: element.visual.y ?? 0,
    width: port ? 14 : (element.visual.width ?? (iface ? 32 : 180)),
    height: port ? 14 : (element.visual.height ?? (iface ? 32 : 100)),
  };
}

export function umlPortAnchor(
  owner: Element,
  side: UmlPortSide,
  offset: number,
): Vec {
  const box = umlComponentBounds(owner);
  const at = Math.max(0, Math.min(1, offset));
  const point =
    side === "left" || side === "right"
      ? {
          x: box.x + (side === "right" ? box.width : 0),
          y: box.y + at * box.height,
        }
      : {
          x: box.x + at * box.width,
          y: box.y + (side === "bottom" ? box.height : 0),
        };
  return rotatePoint(point, boxCenter(box), owner.visual.rotation ?? 0);
}

export function nearestUmlPortAnchor(
  owner: Element,
  point: Vec,
): Pick<UmlPortSemantic, "side" | "offset"> {
  const box = umlComponentBounds(owner);
  const local = rotatePoint(
    point,
    boxCenter(box),
    -(owner.visual.rotation ?? 0),
  );
  const x = Math.max(
    0,
    Math.min(1, (local.x - box.x) / Math.max(1, box.width)),
  );
  const y = Math.max(
    0,
    Math.min(1, (local.y - box.y) / Math.max(1, box.height)),
  );
  const candidates: { side: UmlPortSide; offset: number; distance: number }[] =
    [
      { side: "left", offset: y, distance: Math.abs(local.x - box.x) },
      {
        side: "right",
        offset: y,
        distance: Math.abs(local.x - box.x - box.width),
      },
      { side: "top", offset: x, distance: Math.abs(local.y - box.y) },
      {
        side: "bottom",
        offset: x,
        distance: Math.abs(local.y - box.y - box.height),
      },
    ];
  candidates.sort((a, b) => a.distance - b.distance);
  const chosen = candidates[0];
  if (!chosen) throw new Error("Port boundary candidates are empty");
  return {
    side: chosen.side,
    offset: Math.round(chosen.offset * 10000) / 10000,
  };
}

function boxUtil(
  type:
    | typeof UmlComponentType.Component
    | typeof UmlComponentType.Interface
    | typeof UmlComponentType.Port,
): ShapeUtil {
  return {
    type,
    canResize: type !== UmlComponentType.Port,
    getBounds: umlComponentBounds,
    hitTest: (element, point) =>
      boxContains(umlComponentBounds(element), point),
    resize: (_element, box) => ({ visual: box }),
    defaultSemantic: () =>
      type === UmlComponentType.Interface
        ? { name: "Interface", kind: "provided" }
        : type === UmlComponentType.Port
          ? { name: "Port", owner: "", side: "right", offset: 0.5 }
          : { name: "Component" },
    defaultVisual: () => ({
      x: 0,
      y: 0,
      width:
        type === UmlComponentType.Component
          ? 180
          : type === UmlComponentType.Port
            ? 14
            : 32,
      height:
        type === UmlComponentType.Component
          ? 100
          : type === UmlComponentType.Port
            ? 14
            : 32,
    }),
  };
}
export const umlComponentShapeUtils: readonly ShapeUtil[] = [
  boxUtil(UmlComponentType.Component),
  boxUtil(UmlComponentType.Interface),
  boxUtil(UmlComponentType.Port),
  createConnectorUtil({
    type: UmlComponentType.Relationship,
    readEndpoints: readDirectEndpoints,
    defaultSemantic: () => ({
      from: "",
      to: "",
      kind: UmlComponentRelationship.Connector,
    }),
  }),
];
export function isUmlComponentEndpoint(type: string): boolean {
  return (
    type === UmlComponentType.Component ||
    type === UmlComponentType.Interface ||
    type === UmlComponentType.Port
  );
}

/** Include external interface/port labels when framing or exporting content. */
export function umlComponentPaintBounds(element: Element, box: Box): Box {
  if (
    element.type !== UmlComponentType.Interface &&
    element.type !== UmlComponentType.Port
  )
    return box;
  const name = (element.semantic as { name?: string }).name ?? "";
  const fontSize = element.visual.style?.fontSize ?? 13;
  const width = Math.max(box.width, Array.from(name).length * fontSize);
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y,
    width,
    height: box.height + 17 + fontSize * 0.3,
  };
}
