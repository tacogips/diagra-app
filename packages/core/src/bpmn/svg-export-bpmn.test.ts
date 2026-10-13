import { describe, expect, test } from "bun:test";
import { Store } from "../store.ts";
import { createDefaultRegistry } from "../shapes/index.ts";
import { document, element, TEST_PAGE } from "../test-helpers.ts";
import { renderPageSvg } from "../svg-export.ts";
import { bpmnLabelBox } from "./notation.ts";

const occurrences = (source: string, text: string) =>
  source.split(text).length - 1;

describe("BPMN SVG export", () => {
  test("maps shared notation roles", () => {
    const pool = element({
      id: "pool",
      type: "bpmn.participant",
      index: "a1",
      semantic: { name: "Operations", collapsed: false },
      visual: { x: 0, y: 0, width: 500, height: 200 },
    });
    const lane1 = element({
      id: "lane1",
      type: "bpmn.lane",
      index: "a2",
      semantic: { name: "Requester", parent: "pool" },
      visual: { x: 30, y: 0, width: 470, height: 100 },
    });
    const lane2 = element({
      id: "lane2",
      type: "bpmn.lane",
      index: "a3",
      semantic: { name: "Approver", parent: "pool" },
      visual: { x: 30, y: 100, width: 470, height: 100 },
    });
    const start = element({
      id: "start",
      type: "bpmn.event",
      index: "a4",
      semantic: { name: "Request", position: "start", definitions: [] },
      visual: { x: 50, y: 25, width: 36, height: 36 },
    });
    const task = element({
      id: "task",
      type: "bpmn.task",
      index: "a5",
      semantic: { name: "Review", taskType: "user", loop: "none" },
      visual: { x: 140, y: 20, width: 100, height: 70 },
    });
    const message = element({
      id: "message",
      type: "bpmn.event",
      index: "a6",
      semantic: {
        name: "Notify",
        position: "intermediateThrow",
        definitions: [{ kind: "message" }],
      },
      visual: { x: 280, y: 30, width: 36, height: 36 },
    });
    const gateway = element({
      id: "gateway",
      type: "bpmn.gateway",
      index: "a7",
      semantic: { name: "Approved?", gatewayType: "exclusive" },
      visual: { x: 350, y: 20, width: 50, height: 50 },
    });
    const end = element({
      id: "end",
      type: "bpmn.event",
      index: "a8",
      semantic: { name: "Complete", position: "end", definitions: [] },
      visual: { x: 430, y: 125, width: 36, height: 36 },
    });
    const flow1 = element({
      id: "flow1",
      type: "bpmn.sequenceFlow",
      index: "a9",
      semantic: { from: "start", to: "task" },
    });
    const flow2 = element({
      id: "flow2",
      type: "bpmn.sequenceFlow",
      index: "a10",
      semantic: { from: "task", to: "message" },
    });
    const flow3 = element({
      id: "flow3",
      type: "bpmn.sequenceFlow",
      index: "a11",
      semantic: { from: "message", to: "gateway" },
    });
    const flow4 = element({
      id: "flow4",
      type: "bpmn.sequenceFlow",
      index: "a12",
      semantic: { from: "gateway", to: "end", name: "YES" },
    });
    const svg = renderPageSvg(
      new Store(
        document([
          pool,
          lane1,
          lane2,
          start,
          task,
          message,
          gateway,
          end,
          flow1,
          flow2,
          flow3,
          flow4,
        ]),
      ),
      createDefaultRegistry(),
      TEST_PAGE.id,
    );
    expect(svg).not.toBeNull();
    const output = svg as string;
    expect(occurrences(output, 'class="bpmn-participant-header"')).toBe(1);
    expect(occurrences(output, 'class="bpmn-lane-header"')).toBe(2);
    expect(occurrences(output, 'class="bpmn-task-icon-user"')).toBe(1);
    expect(occurrences(output, 'class="bpmn-event-icon-message-filled"')).toBe(
      1,
    );
    expect(occurrences(output, 'class="bpmn-gateway-marker-exclusive"')).toBe(
      1,
    );
    expect(occurrences(output, 'class="bpmn-sequence-arrow"')).toBe(4);
  });

  test("includes an external event label in export bounds", () => {
    const end = element({
      id: "end",
      type: "bpmn.event",
      index: "a1",
      semantic: { name: "Complete", position: "end", definitions: [] },
      visual: { x: 430, y: 125, width: 36, height: 36 },
    });
    const box = { x: 430, y: 125, width: 36, height: 36 };
    const label = bpmnLabelBox(end, box);
    if (label === null) throw new Error("Expected an external event label");
    const svg = renderPageSvg(
      new Store(document([end])),
      createDefaultRegistry(),
      TEST_PAGE.id,
    );
    expect(svg).not.toBeNull();
    const viewBox = (svg as string)
      .match(/viewBox="([^"]+)"/)?.[1]
      ?.split(" ")
      .map(Number);
    const viewBoxBottom = (viewBox?.[1] ?? 0) + (viewBox?.[3] ?? 0);
    const labelBottom = label.y + label.height;
    const shapeBottom = box.y + box.height;
    expect(viewBoxBottom).toBeGreaterThanOrEqual(labelBottom);
    expect(viewBoxBottom).toBeGreaterThan(shapeBottom + 16);
  });
});
