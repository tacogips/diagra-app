import type { Element, ElementId } from "@diagra/ir";
import type { Box, Vec } from "../geometry.ts";
import { wrapTextLines } from "../text-layout.ts";

export interface NotationPaint {
  readonly role: string;
  readonly stroke?: string;
  readonly fill?: string;
  readonly strokeWidth?: number;
  readonly dash?: string;
}

export type NotationPrimitive =
  | (NotationPaint & {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
    })
  | (NotationPaint & {
      readonly kind: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
    })
  | (NotationPaint & { readonly kind: "path"; readonly d: string })
  | (NotationPaint & {
      readonly kind: "polygon";
      readonly points: readonly Vec[];
    })
  | (NotationPaint & {
      readonly kind: "text";
      readonly x: number;
      readonly y: number;
      readonly lines: readonly string[];
      readonly anchor: "start" | "middle";
      readonly fontSize: number;
      readonly lineHeight: number;
      readonly rotate?: -90;
    });

const SHAPE_TYPES = new Set([
  "bpmn.participant",
  "bpmn.lane",
  "bpmn.task",
  "bpmn.subProcess",
  "bpmn.callActivity",
  "bpmn.event",
  "bpmn.boundaryEvent",
  "bpmn.gateway",
  "bpmn.dataObject",
  "bpmn.dataStore",
  "bpmn.textAnnotation",
  "bpmn.group",
]);
const FLOW_TYPES = new Set([
  "bpmn.sequenceFlow",
  "bpmn.messageFlow",
  "bpmn.association",
  "bpmn.dataAssociation",
]);

function fields(element: Element): Record<string, unknown> {
  return element.semantic as Record<string, unknown>;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function paint(element: Element): {
  stroke: string;
  fill: string;
  color: string;
} {
  const style = element.visual.style;
  return {
    stroke: style?.stroke ?? "#000000",
    fill: style?.fill ?? "#ffffff",
    color: style?.color ?? "#000000",
  };
}

function textPrimitive(
  role: string,
  value: string,
  box: Box,
  color: string,
  fontSize = 11,
  rotate?: -90,
  anchor: "start" | "middle" = "middle",
): NotationPrimitive {
  const lines = wrapTextLines(value, Math.max(1, box.width), fontSize);
  return {
    kind: "text",
    role,
    x: box.x,
    y: box.y + fontSize / 2,
    lines,
    anchor,
    fontSize,
    lineHeight: fontSize + 2,
    ...(rotate === undefined ? {} : { rotate }),
    fill: color,
    stroke: "none",
  };
}

function labelText(
  element: Element,
  box: Box,
  value: string,
  color: string,
  role = "label",
): NotationPrimitive | null {
  if (!value) return null;
  const bounds = element.visual.labelBounds;
  const local = bounds
    ? {
        x: bounds.x - (element.visual.x ?? box.x) + bounds.width / 2,
        y: bounds.y - (element.visual.y ?? box.y),
        width: bounds.width,
        height: bounds.height,
      }
    : { x: box.width / 2, y: box.height + 7, width: 90, height: 24 };
  return textPrimitive(role, value, local, color);
}

export function bpmnLabelBox(element: Element, box: Box): Box | null {
  if (
    ![
      "bpmn.event",
      "bpmn.boundaryEvent",
      "bpmn.gateway",
      "bpmn.dataObject",
      "bpmn.dataStore",
    ].includes(element.type)
  )
    return null;
  const value = string(fields(element)["name"]);
  if (!value) return null;
  const label = element.visual.labelBounds;
  if (label) return label;
  return {
    x: box.x + box.width / 2 - 45,
    y: box.y + box.height + 7,
    width: 90,
    height: 24,
  };
}

export function isBpmnShapeType(type: string): boolean {
  return SHAPE_TYPES.has(type);
}

function iconPath(
  role: string,
  d: string,
  stroke: string,
  fill = "none",
  strokeWidth = 1.5,
): NotationPrimitive {
  return { kind: "path", role, d, stroke, fill, strokeWidth };
}

function eventIcon(
  kind: string,
  cx: number,
  cy: number,
  filled: boolean,
  stroke: string,
): NotationPrimitive[] {
  const role = `event-icon-${kind}-${filled || kind === "terminate" ? "filled" : "hollow"}`;
  const fill = filled || kind === "terminate" ? stroke : "none";
  const common = { stroke, fill, strokeWidth: 1.5 };
  switch (kind) {
    case "message":
      return [
        iconPath(
          role,
          `M${cx - 8} ${cy - 5} H${cx + 8} V${cy + 5} H${cx - 8} Z M${cx - 8} ${cy - 5} L${cx} ${cy + 1} L${cx + 8} ${cy - 5}`,
          stroke,
          fill,
        ),
      ];
    case "timer":
      return [
        { kind: "circle", role, cx, cy, r: 7, ...common },
        iconPath(role, `M${cx} ${cy - 7} V${cy} L${cx + 4} ${cy + 2}`, stroke),
      ];
    case "error":
      return [
        iconPath(
          role,
          `M${cx - 4} ${cy - 8} L${cx + 2} ${cy - 2} L${cx - 1} ${cy + 1} L${cx + 4} ${cy + 7} L${cx - 2} ${cy + 2} L${cx + 1} ${cy - 1} Z`,
          stroke,
          fill,
        ),
      ];
    case "escalation":
      return [
        iconPath(
          role,
          `M${cx} ${cy - 8} L${cx + 7} ${cy + 6} H${cx - 7} Z M${cx} ${cy - 3} V${cy + 1} M${cx} ${cy + 4} V${cy + 4.5}`,
          stroke,
          fill,
        ),
      ];
    case "cancel":
      return [
        iconPath(
          role,
          `M${cx - 6} ${cy - 6} L${cx + 6} ${cy + 6} M${cx + 6} ${cy - 6} L${cx - 6} ${cy + 6}`,
          stroke,
          "none",
          2,
        ),
      ];
    case "compensation":
      return [
        {
          kind: "polygon",
          role,
          points: [
            { x: cx + 6, y: cy - 7 },
            { x: cx - 5, y: cy },
            { x: cx + 6, y: cy + 7 },
          ],
          ...common,
        },
      ];
    case "conditional":
      return [
        iconPath(
          role,
          `M${cx - 7} ${cy - 5} H${cx + 7} M${cx - 7} ${cy} H${cx + 7} M${cx - 7} ${cy + 5} H${cx + 7}`,
          stroke,
        ),
      ];
    case "link":
      return [
        iconPath(
          role,
          `M${cx - 7} ${cy} H${cx + 7} M${cx + 2} ${cy - 4} L${cx + 7} ${cy} L${cx + 2} ${cy + 4}`,
          stroke,
        ),
      ];
    case "signal":
      return [
        iconPath(
          role,
          `M${cx} ${cy - 8} L${cx + 7} ${cy + 6} H${cx - 7} Z`,
          stroke,
          fill,
        ),
      ];
    case "terminate":
      return [
        {
          kind: "circle",
          role,
          cx,
          cy,
          r: 7,
          stroke,
          fill: stroke,
          strokeWidth: 1.5,
        },
      ];
    case "parallelMultiple":
      return [
        iconPath(
          role,
          `M${cx} ${cy - 7} V${cy + 7} M${cx - 7} ${cy} H${cx + 7}`,
          stroke,
        ),
      ];
    case "multiple":
      return [
        iconPath(
          role,
          `M${cx} ${cy - 7} L${cx + 2} ${cy - 2} L${cx + 7} ${cy} L${cx + 2} ${cy + 2} L${cx} ${cy + 7} L${cx - 2} ${cy + 2} L${cx - 7} ${cy} L${cx - 2} ${cy - 2} Z`,
          stroke,
          fill,
        ),
      ];
    default:
      return [];
  }
}

export function bpmnNotation(
  element: Element,
  box: Box,
  _lookup?: (id: ElementId) => Element | undefined,
): readonly NotationPrimitive[] {
  if (!isBpmnShapeType(element.type)) return [];
  const data = fields(element);
  const { stroke, fill, color } = paint(element);
  const out: NotationPrimitive[] = [];
  const rect = (
    role: string,
    x: number,
    y: number,
    width: number,
    height: number,
    rx = 0,
    sw = 1.5,
    dash?: string,
  ): NotationPrimitive => ({
    kind: "rect",
    role,
    x,
    y,
    width,
    height,
    rx,
    stroke,
    fill,
    strokeWidth: sw,
    ...(dash ? { dash } : {}),
  });
  const center = { x: box.width / 2, y: box.height / 2 };
  const name = string(data["name"]);
  switch (element.type) {
    case "bpmn.participant": {
      const collapsed = data["collapsed"] === true;
      out.push(rect("participant-body", 0, 0, box.width, box.height));
      if (!collapsed)
        out.push(rect("participant-header", 0, 0, 30, box.height, 0, 1));
      const label = textPrimitive(
        "participant-label",
        name,
        collapsed
          ? {
              x: box.width / 2,
              y: box.height / 2 - 8,
              width: box.width - 20,
              height: box.height,
            }
          : {
              x: 15,
              y: box.height / 2 - 8,
              width: box.height - 20,
              height: 30,
            },
        color,
        12,
        collapsed ? undefined : -90,
      );
      out.push(label);
      break;
    }
    case "bpmn.lane":
      out.push(rect("lane-body", 0, 0, box.width, box.height));
      out.push(rect("lane-header", 0, 0, 30, box.height, 0, 1));
      out.push(
        textPrimitive(
          "lane-label",
          name,
          { x: 15, y: box.height / 2 - 8, width: box.height - 20, height: 30 },
          color,
          12,
          -90,
        ),
      );
      break;
    case "bpmn.task":
    case "bpmn.subProcess":
    case "bpmn.callActivity": {
      const taskType = string(data["taskType"]);
      const eventSub =
        element.type === "bpmn.subProcess" && data["triggeredByEvent"] === true;
      out.push(
        rect(
          "activity-body",
          0,
          0,
          box.width,
          box.height,
          10,
          element.type === "bpmn.callActivity" ? 5 : 2,
          eventSub ? "2 3" : undefined,
        ),
      );
      const expandedSubProcess =
        element.type === "bpmn.subProcess" && data["expanded"] === true;
      const activityLabelBox = expandedSubProcess
        ? { x: 8, y: 8, width: box.width - 16, height: 24 }
        : {
            x: box.width / 2,
            y: Math.max(0, center.y - 15),
            width: box.width - 16,
            height: 30,
          };
      const label = name
        ? textPrimitive(
            "activity-label",
            name,
            activityLabelBox,
            color,
            11,
            undefined,
            expandedSubProcess ? "start" : "middle",
          )
        : null;
      if (label) out.push(label);
      if (element.type === "bpmn.task" && taskType !== "none") {
        const role = taskType === "businessRule" ? "businessRule" : taskType;
        out.push(
          iconPath(
            `task-icon-${role}`,
            `M${box.width - 22} 8 h14 v14 h-14 z`,
            stroke,
          ),
        );
      }
      const loop = string(data["loop"]);
      if (loop === "standard")
        out.push(
          iconPath(
            "marker-loop",
            `M${center.x - 7} ${box.height - 8} a7 5 0 1 1 10 0 M${center.x + 3} ${box.height - 11} l2 4 l-4 1`,
            stroke,
          ),
        );
      if (
        loop === "parallelMultiInstance" ||
        loop === "sequentialMultiInstance"
      )
        out.push(
          iconPath(
            loop === "parallelMultiInstance"
              ? "marker-parallel"
              : "marker-sequential",
            `M${center.x - 7} ${box.height - 7} V${box.height - 2} M${center.x} ${box.height - 7} V${box.height - 2} M${center.x + 7} ${box.height - 7} V${box.height - 2}`,
            stroke,
          ),
        );
      if (data["forCompensation"] === true)
        out.push({
          kind: "polygon",
          role: "marker-compensation",
          points: [
            { x: center.x, y: box.height - 12 },
            { x: center.x - 6, y: box.height - 3 },
            { x: center.x + 6, y: box.height - 3 },
          ],
          stroke,
          fill: "none",
          strokeWidth: 1,
        });
      if (element.type === "bpmn.subProcess") {
        if (data["expanded"] === false)
          out.push(
            rect(
              "marker-subprocess",
              box.width - 20,
              box.height - 20,
              14,
              14,
              0,
              1,
            ),
          );
        if (data["adHoc"] === true)
          out.push(
            textPrimitive(
              "marker-adhoc",
              "~",
              { x: center.x, y: box.height - 17, width: 14, height: 12 },
              stroke,
              12,
            ),
          );
      }
      break;
    }
    case "bpmn.event":
    case "bpmn.boundaryEvent": {
      const position =
        element.type === "bpmn.event" ? string(data["position"]) : "boundary";
      const radius = Math.min(box.width, box.height) / 2;
      const dashed =
        element.type === "bpmn.boundaryEvent" &&
        data["cancelActivity"] === false
          ? "4 3"
          : undefined;
      const role =
        position === "start"
          ? "event-border-start"
          : position === "end"
            ? "event-border-end"
            : "event-border-intermediate";
      out.push({
        kind: "circle",
        role,
        cx: center.x,
        cy: center.y,
        r: radius,
        stroke,
        fill,
        strokeWidth: role === "event-border-end" ? 4 : 2,
        ...(dashed ? { dash: dashed } : {}),
      });
      if (position !== "start" && position !== "end")
        out.push({
          kind: "circle",
          role: "event-border-inner",
          cx: center.x,
          cy: center.y,
          r: radius - 3,
          stroke,
          fill: "none",
          strokeWidth: 1.5,
          ...(dashed ? { dash: dashed } : {}),
        });
      const definitions = Array.isArray(data["definitions"])
        ? (data["definitions"] as readonly Record<string, unknown>[])
        : [];
      const kinds =
        definitions.length > 1
          ? [
              data["parallelMultiple"] === true
                ? "parallelMultiple"
                : "multiple",
            ]
          : definitions.map((definition) => string(definition["kind"]));
      const filled = position === "end" || position === "intermediateThrow";
      for (const kind of kinds)
        out.push(...eventIcon(kind, center.x, center.y, filled, stroke));
      const label = labelText(element, box, name, color);
      if (label) out.push(label);
      break;
    }
    case "bpmn.gateway": {
      out.push({
        kind: "polygon",
        role: "gateway-body",
        points: [
          { x: center.x, y: 0 },
          { x: box.width, y: center.y },
          { x: center.x, y: box.height },
          { x: 0, y: center.y },
        ],
        stroke,
        fill,
        strokeWidth: 1.5,
      });
      const type = string(data["gatewayType"]);
      if (type === "exclusive" && data["markerVisible"] !== false)
        out.push(
          iconPath(
            "gateway-marker-exclusive",
            `M${center.x - 7} ${center.y - 7} L${center.x + 7} ${center.y + 7} M${center.x + 7} ${center.y - 7} L${center.x - 7} ${center.y + 7}`,
            stroke,
          ),
        );
      if (type === "parallel")
        out.push(
          iconPath(
            "gateway-marker-parallel",
            `M${center.x} ${center.y - 8} V${center.y + 8} M${center.x - 8} ${center.y} H${center.x + 8}`,
            stroke,
          ),
        );
      if (type === "inclusive")
        out.push({
          kind: "circle",
          role: "gateway-marker-inclusive",
          cx: center.x,
          cy: center.y,
          r: 7,
          stroke,
          fill: "none",
          strokeWidth: 1.5,
        });
      if (type === "eventBased")
        out.push({
          kind: "circle",
          role: "gateway-marker-eventBased",
          cx: center.x,
          cy: center.y,
          r: 8,
          stroke,
          fill: "none",
          strokeWidth: 1.5,
        });
      if (type === "complex")
        out.push(
          iconPath(
            "gateway-marker-complex",
            `M${center.x} ${center.y - 8} L${center.x + 2} ${center.y - 2} L${center.x + 8} ${center.y} L${center.x + 2} ${center.y + 2} L${center.x} ${center.y + 8} L${center.x - 2} ${center.y + 2} L${center.x - 8} ${center.y} L${center.x - 2} ${center.y - 2} Z`,
            stroke,
          ),
        );
      const label = labelText(element, box, name, color);
      if (label) out.push(label);
      break;
    }
    case "bpmn.dataObject": {
      const role = string(data["role"]);
      if (role === "input")
        out.push({
          kind: "polygon",
          role: "data-object-input",
          points: [
            { x: 0, y: 0 },
            { x: box.width - 10, y: 0 },
            { x: box.width, y: box.height / 2 },
            { x: box.width - 10, y: box.height },
            { x: 0, y: box.height },
          ],
          stroke,
          fill,
          strokeWidth: 1.5,
        });
      else if (role === "output")
        out.push({
          kind: "polygon",
          role: "data-object-output",
          points: [
            { x: 0, y: 0 },
            { x: box.width - 10, y: 0 },
            { x: box.width, y: box.height / 2 },
            { x: box.width - 10, y: box.height },
            { x: 0, y: box.height },
          ],
          stroke,
          fill: stroke,
          strokeWidth: 1.5,
        });
      else
        out.push(rect("data-object-body", 0, 0, box.width, box.height, 0, 1.5));
      if (data["collection"] === true)
        out.push(
          iconPath(
            "data-object-collection",
            `M4 ${box.height - 4} H${box.width - 4} M4 ${box.height - 8} H${box.width - 4}`,
            stroke,
          ),
        );
      const label = labelText(element, box, name, color);
      if (label) out.push(label);
      break;
    }
    case "bpmn.dataStore":
      out.push({
        kind: "path",
        role: "data-store-body",
        d: `M0 8 C0 0 ${box.width} 0 ${box.width} 8 V${box.height - 8} C${box.width} ${box.height} 0 ${box.height} 0 ${box.height - 8} Z M0 8 C0 16 ${box.width} 16 ${box.width} 8`,
        stroke,
        fill,
        strokeWidth: 1.5,
      });
      {
        const label = labelText(element, box, name, color);
        if (label) out.push(label);
      }
      break;
    case "bpmn.textAnnotation":
      out.push(
        iconPath("annotation-bracket", "M12 0 H0 V30 H12", stroke, "none", 1.5),
      );
      out.push(
        textPrimitive(
          "annotation-text",
          string(data["text"]),
          { x: 18, y: 0, width: box.width - 18, height: box.height },
          color,
          11,
          undefined,
          "start",
        ),
      );
      break;
    case "bpmn.group":
      out.push(
        rect("group-body", 0, 0, box.width, box.height, 10, 1.5, "8 3 2 3"),
      );
      if (name)
        out.push(
          textPrimitive(
            "group-label",
            name,
            { x: 8, y: 0, width: box.width - 16, height: 16 },
            color,
            11,
            undefined,
            "start",
          ),
        );
      break;
  }
  return out;
}

function polylineMidpoint(points: readonly Vec[]): Vec {
  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index] as Vec;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  const halfway = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const start = points[index] as Vec;
    const end = points[index + 1] as Vec;
    const length = lengths[index] as number;
    if (traversed + length >= halfway) {
      const ratio = length === 0 ? 0 : (halfway - traversed) / length;
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
    }
    traversed += length;
  }
  return points.at(-1) as Vec;
}

function triangle(
  tip: Vec,
  previous: Vec,
  size: number,
  role: string,
  stroke: string,
  fill: string,
): NotationPrimitive {
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  const backX = tip.x - Math.cos(angle) * size;
  const backY = tip.y - Math.sin(angle) * size;
  const wing = size * 0.55;
  return {
    kind: "polygon",
    role,
    points: [
      tip,
      { x: backX + Math.sin(angle) * wing, y: backY - Math.cos(angle) * wing },
      { x: backX - Math.sin(angle) * wing, y: backY + Math.cos(angle) * wing },
    ],
    stroke,
    fill,
    strokeWidth: 1.5,
  };
}

export function bpmnFlowDecoration(
  element: Element,
  points: readonly Vec[],
  lookup: (id: ElementId) => Element | undefined,
): readonly NotationPrimitive[] {
  if (!FLOW_TYPES.has(element.type) || points.length < 2) return [];
  const data = fields(element);
  const style = element.visual.style;
  const stroke = style?.stroke ?? "#000000";
  const out: NotationPrimitive[] = [];
  const start = points[0] as Vec;
  const next = points[1] as Vec;
  const end = points.at(-1) as Vec;
  const beforeEnd = points.at(-2) as Vec;
  if (element.type === "bpmn.sequenceFlow") {
    out.push(triangle(end, beforeEnd, 10, "sequence-arrow", stroke, stroke));
    if (data["isDefault"] === true) {
      const angle = Math.atan2(next.y - start.y, next.x - start.x);
      const x = start.x + Math.cos(angle) * 10;
      const y = start.y + Math.sin(angle) * 10;
      out.push({
        kind: "path",
        role: "default-slash",
        d: `M${x - Math.sin(angle) * 6} ${y + Math.cos(angle) * 6} L${x + Math.sin(angle) * 6} ${y - Math.cos(angle) * 6}`,
        stroke,
        fill: "none",
        strokeWidth: 1.5,
      });
    } else if (
      typeof data["condition"] === "string" &&
      data["condition"] !== ""
    ) {
      const source = lookup(string(data["from"]));
      if (source && !source.type.startsWith("bpmn.gateway")) {
        const diamond = {
          x: start.x + (next.x - start.x) * 0.12,
          y: start.y + (next.y - start.y) * 0.12,
        };
        out.push({
          kind: "polygon",
          role: "conditional-diamond",
          points: [
            { x: diamond.x + 4, y: diamond.y },
            { x: diamond.x, y: diamond.y - 4 },
            { x: diamond.x - 4, y: diamond.y },
            { x: diamond.x, y: diamond.y + 4 },
          ],
          stroke,
          fill: "none",
          strokeWidth: 1,
        });
      }
    }
  } else if (element.type === "bpmn.messageFlow") {
    out.push({
      kind: "circle",
      role: "message-start-circle",
      cx: start.x,
      cy: start.y,
      r: 4,
      stroke,
      fill: "none",
      strokeWidth: 1.5,
    });
    out.push(triangle(end, beforeEnd, 10, "message-arrow", stroke, "none"));
  } else if (element.type === "bpmn.association") {
    const direction = string(data["direction"]);
    if (direction === "one" || direction === "both")
      out.push(
        iconPath(
          "association-arrow",
          `M${end.x - 10} ${end.y - 4} L${end.x} ${end.y} L${end.x - 10} ${end.y + 4}`,
          stroke,
        ),
      );
    if (direction === "both")
      out.push(
        iconPath(
          "association-arrow",
          `M${start.x + 10} ${start.y - 4} L${start.x} ${start.y} L${start.x + 10} ${start.y + 4}`,
          stroke,
        ),
      );
  } else
    out.push(
      iconPath(
        "data-association-arrow",
        `M${end.x - 10} ${end.y - 4} L${end.x} ${end.y} L${end.x - 10} ${end.y + 4}`,
        stroke,
      ),
    );
  const label = string(data["name"]);
  if (label) {
    const labelBounds = element.visual.labelBounds;
    const anchor = labelBounds
      ? {
          x: labelBounds.x + labelBounds.width / 2,
          y: labelBounds.y + labelBounds.height / 2,
        }
      : polylineMidpoint(points);
    out.push({
      kind: "text",
      role: "flow-label",
      x: anchor.x,
      y: anchor.y,
      lines: wrapTextLines(label, 90, 11),
      anchor: "middle",
      fontSize: 11,
      lineHeight: 13,
      fill: style?.color ?? "#000000",
      stroke: "none",
    });
  }
  return out;
}
