import { describe, expect, test } from "bun:test";
import { bpmnFlowDecoration, bpmnLabelBox, bpmnNotation } from "./notation.ts";
import {
  connectorDecoration,
  connectorDefaultDash,
} from "../shapes/connector.ts";
import { element } from "../test-helpers.ts";

const box = { x: 10, y: 20, width: 100, height: 80 };
const roles = (type: string, semantic: unknown, visual = {}) =>
  bpmnNotation(
    element({
      id: "e",
      type,
      semantic,
      visual: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        ...visual,
      },
    }),
    box,
  ).map((primitive) => primitive.role);

describe("BPMN renderer-neutral notation", () => {
  test("produces event, activity, gateway and participant roles", () => {
    expect(
      roles("bpmn.event", {
        position: "start",
        name: "Begin",
        definitions: [],
      }),
    ).toEqual(["event-border-start", "label"]);
    expect(
      roles("bpmn.event", {
        position: "intermediateCatch",
        name: "Notice",
        definitions: [{ kind: "message" }],
      }),
    ).toContain("event-icon-message-hollow");
    expect(
      roles("bpmn.event", {
        position: "intermediateThrow",
        definitions: [{ kind: "message" }],
      }),
    ).toContain("event-icon-message-filled");
    expect(roles("bpmn.event", { position: "end", definitions: [] })).toContain(
      "event-border-end",
    );
    expect(
      roles("bpmn.task", {
        name: "Review",
        taskType: "user",
        loop: "standard",
      }),
    ).toEqual(
      expect.arrayContaining([
        "activity-body",
        "activity-label",
        "task-icon-user",
        "marker-loop",
      ]),
    );
    expect(roles("bpmn.gateway", { gatewayType: "exclusive" })).toContain(
      "gateway-marker-exclusive",
    );
    expect(
      roles("bpmn.gateway", { gatewayType: "exclusive", markerVisible: false }),
    ).not.toContain("gateway-marker-exclusive");
    expect(
      roles("bpmn.participant", { name: "Approvers", collapsed: false }),
    ).toEqual(["participant-body", "participant-header", "participant-label"]);
  });

  test("covers the pinned roles for remaining BPMN notation kinds", () => {
    for (const taskType of [
      "user",
      "service",
      "manual",
      "send",
      "receive",
      "script",
      "businessRule",
    ]) {
      expect(roles("bpmn.task", { taskType, loop: "none" })).toContain(
        `task-icon-${taskType}`,
      );
    }
    expect(
      roles("bpmn.participant", { name: "External", collapsed: true }),
    ).toEqual(["participant-body", "participant-label"]);
    for (const [gatewayType, marker] of [
      ["parallel", "gateway-marker-parallel"],
      ["inclusive", "gateway-marker-inclusive"],
      ["eventBased", "gateway-marker-eventBased"],
      ["complex", "gateway-marker-complex"],
    ]) {
      expect(roles("bpmn.gateway", { gatewayType })).toContain(marker);
    }
    expect(
      roles("bpmn.subProcess", {
        name: "Subprocess",
        expanded: false,
        triggeredByEvent: true,
        adHoc: true,
        loop: "parallelMultiInstance",
        forCompensation: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        "activity-body",
        "marker-subprocess",
        "marker-adhoc",
        "marker-parallel",
        "marker-compensation",
      ]),
    );
    expect(
      roles("bpmn.callActivity", {
        name: "Call",
        calledElement: "service",
        loop: "none",
        forCompensation: true,
      }),
    ).toContain("marker-compensation");
    expect(
      roles("bpmn.event", {
        position: "intermediateCatch",
        definitions: [{ kind: "message" }, { kind: "timer" }],
      }),
    ).toContain("event-icon-multiple-hollow");
    expect(
      roles("bpmn.event", {
        position: "intermediateThrow",
        parallelMultiple: true,
        definitions: [{ kind: "message" }, { kind: "timer" }],
      }),
    ).toContain("event-icon-parallelMultiple-filled");
    expect(
      roles("bpmn.dataObject", {
        name: "Input",
        role: "input",
        collection: true,
      }),
    ).toEqual(
      expect.arrayContaining(["data-object-input", "data-object-collection"]),
    );
    expect(
      roles("bpmn.dataObject", { name: "Output", role: "output" }),
    ).toContain("data-object-output");
    expect(roles("bpmn.dataStore", { name: "Store" })).toContain(
      "data-store-body",
    );
    expect(roles("bpmn.textAnnotation", { text: "Note" })).toEqual([
      "annotation-bracket",
      "annotation-text",
    ]);
    expect(roles("bpmn.group", { name: "Category" })).toEqual([
      "group-body",
      "group-label",
    ]);
  });

  test("uses visual colors, dashed non-interrupting borders and external label bounds", () => {
    const event = element({
      id: "e",
      type: "bpmn.boundaryEvent",
      semantic: { name: "Timeout", cancelActivity: false, definitions: [] },
      visual: {
        x: 10,
        y: 20,
        width: 36,
        height: 36,
        style: { stroke: "#ff0000" },
      },
    });
    const primitives = bpmnNotation(event, {
      x: 10,
      y: 20,
      width: 36,
      height: 36,
    });
    expect(primitives[0]).toMatchObject({
      role: "event-border-intermediate",
      dash: "4 3",
      stroke: "#ff0000",
    });
    expect(
      bpmnLabelBox(event, { x: 10, y: 20, width: 36, height: 36 }),
    ).toEqual({ x: -17, y: 63, width: 90, height: 24 });
  });

  test("anchors BPMN labels at their visual centers or left offsets", () => {
    const text = (
      type: string,
      semantic: unknown,
      shapeBox: { x: number; y: number; width: number; height: number },
      visual: Record<string, unknown> = {},
    ) =>
      bpmnNotation(
        element({
          id: "labels",
          type,
          semantic,
          visual: { ...shapeBox, ...visual },
        }),
        shapeBox,
      ).find((primitive) => primitive.kind === "text");

    expect(
      text(
        "bpmn.task",
        { name: "Submit purchase request", taskType: "user" },
        { x: 0, y: 0, width: 100, height: 80 },
      ),
    ).toMatchObject({ role: "activity-label", x: 50, anchor: "middle" });
    expect(
      text(
        "bpmn.event",
        { name: "Done", position: "end", definitions: [] },
        { x: 0, y: 0, width: 36, height: 36 },
      ),
    ).toMatchObject({ role: "label", x: 18, anchor: "middle" });

    const labelBounds = { x: 100, y: 200, width: 60, height: 27 };
    const boundedLabel = text(
      "bpmn.event",
      { name: "Done", position: "end", definitions: [] },
      { x: 110, y: 150, width: 36, height: 36 },
      { labelBounds },
    );
    expect(boundedLabel).toMatchObject({ x: 20, anchor: "middle" });
    expect((boundedLabel?.x ?? 0) + 110).toBe(
      labelBounds.x + labelBounds.width / 2,
    );

    expect(
      text(
        "bpmn.subProcess",
        { name: "Expanded", expanded: true },
        { x: 0, y: 0, width: 100, height: 80 },
      ),
    ).toMatchObject({ role: "activity-label", x: 8, anchor: "start" });
    expect(
      text(
        "bpmn.group",
        { name: "Work" },
        { x: 0, y: 0, width: 100, height: 80 },
      ),
    ).toMatchObject({ role: "group-label", x: 8, anchor: "start" });
    expect(
      text(
        "bpmn.textAnnotation",
        { text: "Note" },
        { x: 0, y: 0, width: 100, height: 80 },
      ),
    ).toMatchObject({ role: "annotation-text", x: 18, anchor: "start" });

    expect(
      text(
        "bpmn.participant",
        { name: "Approvers", collapsed: false },
        { x: 10, y: 20, width: 100, height: 80 },
      ),
    ).toMatchObject({ x: 15, anchor: "middle", rotate: -90 });
    expect(
      text(
        "bpmn.lane",
        { name: "Review" },
        { x: 10, y: 20, width: 100, height: 80 },
      ),
    ).toMatchObject({ x: 15, anchor: "middle", rotate: -90 });
    expect(
      text(
        "bpmn.participant",
        { name: "External", collapsed: true },
        { x: 10, y: 20, width: 100, height: 80 },
      ),
    ).toMatchObject({ x: 50, anchor: "middle" });
    const adhocMarker = bpmnNotation(
      element({
        id: "adhoc",
        type: "bpmn.subProcess",
        semantic: { name: "Adhoc", expanded: false, adHoc: true },
        visual: { x: 0, y: 0, width: 100, height: 80 },
      }),
      { x: 0, y: 0, width: 100, height: 80 },
    ).find((primitive) => primitive.role === "marker-adhoc");
    expect(adhocMarker).toMatchObject({ x: 50, anchor: "middle" });
  });

  test("decorates all BPMN connector kinds without changing generic marker contracts", () => {
    const from = element({
      id: "task",
      type: "bpmn.task",
      semantic: { taskType: "user" },
    });
    const flow = element({
      id: "flow",
      type: "bpmn.sequenceFlow",
      semantic: { from: "task", to: "end", condition: "yes" },
    });
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(
      bpmnFlowDecoration(flow, points, (id) =>
        id === "task" ? from : undefined,
      ).map((item) => item.role),
    ).toContain("conditional-diamond");
    const labeled = element({
      id: "labeled",
      type: "bpmn.sequenceFlow",
      semantic: { from: "task", to: "end", name: "Bent route" },
    });
    const bentLabel = bpmnFlowDecoration(
      labeled,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 90 },
      ],
      () => from,
    ).find((item) => item.role === "flow-label");
    expect(bentLabel).toMatchObject({ kind: "text", x: 10, y: 40 });
    const gateway = element({
      id: "gateway",
      type: "bpmn.gateway",
      semantic: { gatewayType: "exclusive" },
    });
    expect(
      bpmnFlowDecoration(flow, points, () => gateway).map((item) => item.role),
    ).not.toContain("conditional-diamond");
    const message = element({
      id: "message",
      type: "bpmn.messageFlow",
      semantic: { from: "a", to: "b" },
    });
    expect(
      bpmnFlowDecoration(message, points, () => undefined).map(
        (item) => item.role,
      ),
    ).toEqual(["message-start-circle", "message-arrow"]);
    expect(connectorDecoration(message)).toEqual({
      start: null,
      end: null,
      label: "",
    });
    expect(connectorDefaultDash(message)).toBe("6 4");
    const defaultFlow = element({
      id: "default",
      type: "bpmn.sequenceFlow",
      semantic: { from: "task", to: "end", isDefault: true },
    });
    expect(
      bpmnFlowDecoration(defaultFlow, points, () => from).map(
        (item) => item.role,
      ),
    ).toContain("default-slash");
    const association = element({
      id: "association",
      type: "bpmn.association",
      semantic: { from: "task", to: "end", direction: "both" },
    });
    expect(
      bpmnFlowDecoration(association, points, () => from).filter(
        (item) => item.role === "association-arrow",
      ),
    ).toHaveLength(2);
    const dataAssociation = element({
      id: "data-association",
      type: "bpmn.dataAssociation",
      semantic: { from: "task", to: "end" },
    });
    expect(
      bpmnFlowDecoration(dataAssociation, points, () => from).map(
        (item) => item.role,
      ),
    ).toContain("data-association-arrow");
    expect(
      connectorDefaultDash(
        element({
          id: "association",
          type: "bpmn.association",
          semantic: { direction: "both" },
        }),
      ),
    ).toBe("1 4");
  });
});
