import { describe, expect, test } from "bun:test";
import { validateDocument } from "./validate.ts";
import {
  connectorWaypointFromPage,
  connectorWaypointToPage,
} from "./connector-waypoints.ts";
import { BPMN_ELEMENT_TYPES } from "./semantics.ts";
import type { Document, Element } from "./types.ts";

const payloads: Readonly<Record<string, unknown>> = {
  "bpmn.participant": { collapsed: false },
  "bpmn.lane": { parent: "pool" },
  "bpmn.task": { taskType: "none", loop: "none" },
  "bpmn.subProcess": {
    expanded: false,
    triggeredByEvent: false,
    adHoc: false,
    loop: "none",
  },
  "bpmn.callActivity": { loop: "none" },
  "bpmn.event": { position: "start", definitions: [] },
  "bpmn.boundaryEvent": {
    attachedTo: "task",
    cancelActivity: true,
    definitions: [],
  },
  "bpmn.gateway": { gatewayType: "exclusive" },
  "bpmn.dataObject": { role: "reference", collection: false },
  "bpmn.dataStore": {},
  "bpmn.textAnnotation": { text: "" },
  "bpmn.group": {},
  "bpmn.sequenceFlow": { from: "task", to: "task" },
  "bpmn.messageFlow": { from: "task", to: "task" },
  "bpmn.association": { from: "task", to: "task", direction: "none" },
  "bpmn.dataAssociation": { from: "task", to: "task" },
};

function doc(
  elements: readonly Element[],
  kind: "bpmn" | "freeform" = "bpmn",
): Document {
  return {
    schemaVersion: 1,
    id: "doc",
    title: "Test",
    pages: [{ id: "page", name: "BPMN", kind }],
    elements,
  };
}
function el(
  id: string,
  type: string,
  semantic: unknown,
  visual: Element["visual"] = {},
): Element {
  return { id, page: "page", type, index: id, semantic, visual };
}

describe("BPMN IR contract", () => {
  test("all sixteen semantic types validate with their minimal payload", () => {
    for (const type of BPMN_ELEMENT_TYPES) {
      const issues = validateDocument(doc([el("one", type, payloads[type])]));
      expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    }
  });
  test("enum and duplicate event definition values are rejected", () => {
    expect(
      validateDocument(
        doc([el("t", "bpmn.task", { taskType: "robot", loop: "none" })]),
      ).some((issue) => issue.code === "value.enum"),
    ).toBe(true);
    const issues = validateDocument(
      doc([
        el("e", "bpmn.event", {
          position: "start",
          definitions: [
            { id: "d1", kind: "message" },
            { id: "d1", kind: "timer" },
          ],
        }),
      ]),
    );
    expect(
      issues.some((issue) => issue.code === "bpmn.definitionIdDuplicate"),
    ).toBe(true);
  });
  test("reference type mismatches are warnings and labelBounds are validated", () => {
    const issues = validateDocument(
      doc([
        el("parent", "bpmn.task", { taskType: "none", loop: "none" }),
        el(
          "child",
          "bpmn.task",
          { taskType: "none", loop: "none", parent: "parent" },
          { labelBounds: { x: 0, y: 0, width: -1, height: 10 } },
        ),
      ]),
    );
    expect(
      issues.some(
        (issue) =>
          issue.code === "bpmn.parentType" && issue.severity === "warning",
      ),
    ).toBe(true);
    expect(issues.some((issue) => issue.code === "value.min")).toBe(true);
  });
  test("BPMN reference type warnings resolve targets that appear later", () => {
    const issues = validateDocument(
      doc([
        el("child", "bpmn.task", {
          taskType: "none",
          loop: "none",
          parent: "later-parent",
        }),
        el("later-parent", "bpmn.task", { taskType: "none", loop: "none" }),
      ]),
    );
    expect(
      issues.some(
        (issue) =>
          issue.code === "bpmn.parentType" &&
          issue.path === "elements[0].semantic.parent" &&
          issue.severity === "warning",
      ),
    ).toBe(true);
  });
  test("flow endpoints remain required and invalid boundary hosts warn", () => {
    const issues = validateDocument(
      doc([
        el("gateway", "bpmn.gateway", { gatewayType: "exclusive" }),
        el("boundary", "bpmn.boundaryEvent", {
          attachedTo: "gateway",
          cancelActivity: true,
          definitions: [],
        }),
        el("flow", "bpmn.sequenceFlow", { from: "gateway" }),
      ]),
    );
    expect(issues.some((issue) => issue.code === "bpmn.attachedToType")).toBe(
      true,
    );
    expect(issues.some((issue) => issue.code === "field.missing")).toBe(true);
  });
  test("BPMN pages and waypoint conversion are supported", () => {
    expect(validateDocument(doc([], "bpmn"))).toEqual([]);
    const point = { x: 47.5, y: 36.25 };
    const waypoint = connectorWaypointFromPage(
      point,
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    );
    const roundTrip = connectorWaypointToPage(
      waypoint,
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    );
    expect(Math.abs(roundTrip.x - point.x)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(roundTrip.y - point.y)).toBeLessThanOrEqual(0.01);
  });
});
