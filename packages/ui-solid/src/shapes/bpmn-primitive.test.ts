import { describe, expect, test } from "bun:test";
import { bpmnNotation, type NotationPrimitive } from "@nodetto/core";
import type { Element } from "@nodetto/ir";
import { primitiveAttributes } from "./bpmn-primitive.ts";

describe("BPMN SVG primitive mapping", () => {
  test("maps a rounded rectangle and its notation role", () => {
    expect(
      primitiveAttributes({
        kind: "rect",
        role: "activity-body",
        x: 1,
        y: 2,
        width: 30,
        height: 20,
        rx: 10,
        stroke: "#000000",
        fill: "#ffffff",
      }),
    ).toEqual({
      tag: "rect",
      attrs: {
        class: "bpmn-activity-body",
        stroke: "#000000",
        fill: "#ffffff",
        "stroke-width": undefined,
        "stroke-dasharray": undefined,
        x: 1,
        y: 2,
        width: 30,
        height: 20,
        rx: 10,
      },
    });
  });

  test("maps circle dash arrays to the SVG attribute", () => {
    const primitive: NotationPrimitive = {
      kind: "circle",
      role: "event-border",
      cx: 9,
      cy: 8,
      r: 7,
      dash: "4 3",
    };
    expect(primitiveAttributes(primitive).attrs["stroke-dasharray"]).toBe(
      "4 3",
    );
  });

  test("serializes polygon points as SVG coordinates", () => {
    expect(
      primitiveAttributes({
        kind: "polygon",
        role: "gateway-marker",
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      }).attrs.points,
    ).toBe("1,2 3,4");
  });

  test("maps rotated text to an SVG rotate transform", () => {
    expect(
      primitiveAttributes({
        kind: "text",
        role: "participant-label",
        x: 12,
        y: 34,
        lines: ["Operations"],
        anchor: "middle",
        fontSize: 11,
        lineHeight: 13,
        rotate: -90,
      }).attrs.transform,
    ).toBe("rotate(-90 12 34)");
  });

  test("maps a message catch event to its hollow envelope role", () => {
    const element: Element = {
      id: "catch",
      page: "page-1",
      type: "bpmn.event",
      index: "a1",
      semantic: {
        name: "Receive",
        position: "intermediateCatch",
        definitions: [{ kind: "message" }],
      },
      visual: { x: 0, y: 0, width: 36, height: 36 },
    };
    const mapped = bpmnNotation(element, {
      x: 0,
      y: 0,
      width: 36,
      height: 36,
    }).map(primitiveAttributes);
    expect(mapped.map((primitive) => primitive.attrs.class)).toContain(
      "bpmn-event-icon-message-hollow",
    );
  });
});
