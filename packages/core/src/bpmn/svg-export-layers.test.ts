import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { importBpmnXml } from "@diagra/io";
import { Store } from "../store.ts";
import { document, element, TEST_PAGE } from "../test-helpers.ts";
import { createDefaultRegistry } from "../shapes/index.ts";
import { renderPageSvg } from "../svg-export.ts";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const purchaseRequestPath = resolve(
  repositoryRoot,
  "packages/io/src/__fixtures__/bpmn/purchase-request.bpmn",
);

function indexesOf(source: string, needle: string): number[] {
  const indexes: number[] = [];
  let from = 0;
  while (true) {
    const index = source.indexOf(needle, from);
    if (index < 0) return indexes;
    indexes.push(index);
    from = index + needle.length;
  }
}

function render(elements: Parameters<typeof document>[0]): string {
  const svg = renderPageSvg(
    new Store(document(elements, [{ ...TEST_PAGE, kind: "bpmn" }])),
    createDefaultRegistry(),
    TEST_PAGE.id,
  );
  if (svg === null) throw new Error("Expected BPMN SVG output");
  return svg;
}

describe("BPMN SVG paint layers", () => {
  test("paints participant and lane bodies before connectors and flows above them", () => {
    const pool = element({
      id: "pool",
      type: "bpmn.participant",
      index: "a1",
      semantic: { name: "Pool", collapsed: false },
      visual: { x: 0, y: 0, width: 600, height: 300 },
    });
    const lane1 = element({
      id: "lane1",
      type: "bpmn.lane",
      index: "a2",
      semantic: { name: "Requester", parent: pool.id },
      visual: { x: 30, y: 0, width: 570, height: 150 },
    });
    const lane2 = element({
      id: "lane2",
      type: "bpmn.lane",
      index: "a3",
      semantic: { name: "Approver", parent: pool.id },
      visual: { x: 30, y: 150, width: 570, height: 150 },
    });
    const task1 = element({
      id: "task1",
      type: "bpmn.task",
      index: "a4",
      semantic: {
        name: "Submit",
        taskType: "none",
        loop: "none",
        parent: lane1.id,
      },
      visual: { x: 100, y: 50, width: 100, height: 80 },
    });
    const task2 = element({
      id: "task2",
      type: "bpmn.task",
      index: "a5",
      semantic: {
        name: "Review",
        taskType: "none",
        loop: "none",
        parent: lane2.id,
      },
      visual: { x: 380, y: 200, width: 100, height: 80 },
    });
    const blackBox = element({
      id: "black-box",
      type: "bpmn.participant",
      index: "a6",
      semantic: { name: "External", collapsed: true },
      visual: { x: 700, y: 50, width: 300, height: 80 },
    });
    const sequence = element({
      id: "sequence",
      type: "bpmn.sequenceFlow",
      index: "a7",
      semantic: { from: task1.id, to: task2.id },
    });
    const message = element({
      id: "message",
      type: "bpmn.messageFlow",
      index: "a8",
      semantic: { from: task2.id, to: blackBox.id },
    });
    const svg = render([
      pool,
      lane1,
      lane2,
      task1,
      task2,
      blackBox,
      sequence,
      message,
    ]);
    const backdrops = svg.indexOf('data-layer="backdrops"');
    const connectors = svg.indexOf('data-layer="connectors"');
    const shapes = svg.indexOf('data-layer="shapes"');
    expect(backdrops).toBeGreaterThanOrEqual(0);
    expect(backdrops).toBeLessThan(connectors);
    expect(connectors).toBeLessThan(shapes);

    const bodies = [
      ...indexesOf(svg, 'class="bpmn-participant-body"'),
      ...indexesOf(svg, 'class="bpmn-lane-body"'),
    ];
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect(body).toBeGreaterThan(backdrops);
      expect(body).toBeLessThan(connectors);
    }
    expect(svg.indexOf('data-id="pool"')).toBeLessThan(
      svg.indexOf('data-id="lane1"'),
    );
    for (const flow of [sequence, message]) {
      const flowIndex = svg.indexOf(`data-id="${flow.id}"`);
      expect(flowIndex).toBeGreaterThan(connectors);
      expect(flowIndex).toBeLessThan(shapes);
    }
    for (const arrow of [
      'class="bpmn-sequence-arrow"',
      'class="bpmn-message-arrow"',
    ]) {
      const arrowIndex = svg.indexOf(arrow);
      expect(arrowIndex).toBeGreaterThan(connectors);
      expect(arrowIndex).toBeLessThan(shapes);
    }
    for (const task of [task1, task2]) {
      expect(svg.indexOf(`data-id="${task.id}"`)).toBeGreaterThan(shapes);
    }
  });

  test("paints all purchase-request sequence flows after every pool and lane body", () => {
    const imported = importBpmnXml(readFileSync(purchaseRequestPath, "utf8"));
    const sequenceFlows = imported.document.elements.filter(
      (candidate) => candidate.type === "bpmn.sequenceFlow",
    );
    expect(sequenceFlows).toHaveLength(12);
    const svg = renderPageSvg(
      new Store(imported.document),
      createDefaultRegistry(),
      imported.pageId,
    );
    if (svg === null) throw new Error("Expected purchase-request SVG output");
    const backdrops = svg.indexOf('data-layer="backdrops"');
    const connectors = svg.indexOf('data-layer="connectors"');
    const bodies = [
      ...indexesOf(svg, 'class="bpmn-participant-body"'),
      ...indexesOf(svg, 'class="bpmn-lane-body"'),
    ];
    expect(backdrops).toBeGreaterThanOrEqual(0);
    expect(connectors).toBeGreaterThan(backdrops);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect(body).toBeGreaterThan(backdrops);
      expect(body).toBeLessThan(connectors);
    }
    const lastBody = Math.max(...bodies);
    const arrows = indexesOf(svg, 'class="bpmn-sequence-arrow"');
    expect(arrows).toHaveLength(12);
    for (const arrow of arrows) expect(arrow).toBeGreaterThan(lastBody);
    for (const flow of sequenceFlows) {
      const flowIndex = svg.indexOf(`data-id="${flow.id}"`);
      expect(flowIndex).toBeGreaterThan(connectors);
      expect(flowIndex).toBeGreaterThan(lastBody);
    }
  });
});
