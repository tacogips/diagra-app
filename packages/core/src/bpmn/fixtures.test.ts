import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { Editor } from "../editor.ts";
import { importBpmnXml } from "@nodetto/io";
import { lintBpmnPage, recommendedLintConfig } from "./lint/index.ts";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const fixturePath = (name: string): string =>
  resolve(repositoryRoot, `packages/io/src/__fixtures__/bpmn/${name}.bpmn`);
const importFixture = (name: string) =>
  importBpmnXml(readFileSync(fixturePath(name), "utf8"));

const classCounts = (svg: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const [, value] of svg.matchAll(/\bclass="([^"]*)"/g)) {
    for (const className of value.split(/\s+/)) {
      counts.set(className, (counts.get(className) ?? 0) + 1);
    }
  }
  return counts;
};

const flowLabelText = (svg: string): string[] => {
  const values: string[] = [];
  for (const [, attributes, text] of svg.matchAll(
    /<text\b([^>]*)>([\s\S]*?)<\/text>/g,
  )) {
    const className = attributes.match(/\bclass="([^"]*)"/)?.[1];
    if (className?.split(/\s+/).includes("bpmn-flow-label")) {
      values.push(text.replace(/<[^>]+>/g, ""));
    }
  }
  return values;
};

const findingsFor = (fixtureName: string) => {
  const imported = importFixture(fixtureName);
  return lintBpmnPage(
    imported.document,
    imported.pageId,
    recommendedLintConfig(),
  );
};

test("complete, swapped and inverted purchase-request fixtures lint clean", () => {
  for (const name of [
    "purchase-request",
    "purchase-request-swapped",
    "purchase-request-inverted",
  ]) {
    expect(findingsFor(name)).toEqual([]);
  }
});

test("draft fixture reports exactly its three pinned error findings", () => {
  const findings = findingsFor("purchase-request-draft");
  const pairs = findings
    .map(({ ruleId, elementId }) => [ruleId, elementId])
    .sort(([leftRule, leftElement], [rightRule, rightElement]) =>
      `${leftRule}:${leftElement}`.localeCompare(
        `${rightRule}:${rightElement}`,
      ),
    );
  expect(pairs).toEqual([
    ["label-required", "Task_PlaceOrder"],
    ["no-implicit-end", "Task_PlaceOrder"],
    ["no-implicit-start", "Event_OrderNoticeProcurement"],
  ]);
  expect(findings.every(({ severity }) => severity === "error")).toBe(true);
});

test("complete fixture exports the pinned BPMN SVG roles and flow labels", () => {
  const imported = importFixture("purchase-request");
  const editor = new Editor({ document: imported.document });
  editor.setCurrentPage(imported.pageId);
  const svg = editor.exportPageSvg();
  expect(svg).not.toBeNull();
  const counts = classCounts(svg ?? "");
  expect(Object.fromEntries(counts)).toMatchObject({
    "bpmn-participant-header": 1,
    "bpmn-lane-header": 3,
    "bpmn-task-icon-user": 3,
    "bpmn-event-icon-message-filled": 3,
    "bpmn-event-icon-message-hollow": 3,
    "bpmn-event-border-intermediate": 6,
    "bpmn-event-border-start": 1,
    "bpmn-event-border-end": 2,
    "bpmn-gateway-marker-exclusive": 1,
    "bpmn-sequence-arrow": 12,
  });
  expect(
    flowLabelText(svg ?? "").filter((value) => value === "YES"),
  ).toHaveLength(1);
  expect(
    flowLabelText(svg ?? "").filter((value) => value === "NO"),
  ).toHaveLength(1);
});

test("complete fixture SVG viewBox contains every BPMN label box", () => {
  const imported = importFixture("purchase-request");
  const editor = new Editor({ document: imported.document });
  editor.setCurrentPage(imported.pageId);
  const svg = editor.exportPageSvg();
  expect(svg).not.toBeNull();
  const labelBoxes = imported.document.elements.flatMap(({ visual }) =>
    visual.labelBounds ? [visual.labelBounds] : [],
  );
  expect(labelBoxes.length).toBeGreaterThan(0);
  const viewBox = svg
    ?.match(/\bviewBox="([^"]+)"/)?.[1]
    ?.split(/\s+/)
    .map(Number);
  expect(viewBox).toHaveLength(4);
  const [left = 0, top = 0, width = 0, height = 0] = viewBox ?? [];
  const right = left + width;
  const bottom = top + height;
  for (const label of labelBoxes) {
    expect(label.x).toBeGreaterThanOrEqual(left);
    expect(label.y).toBeGreaterThanOrEqual(top);
    expect(label.x + label.width).toBeLessThanOrEqual(right);
    expect(label.y + label.height).toBeLessThanOrEqual(bottom);
  }
});

test("complete fixture rejects an outgoing flow from its end event", () => {
  const imported = importFixture("purchase-request");
  const editor = new Editor({ document: imported.document });
  editor.setCurrentPage(imported.pageId);
  const result = editor.connectBpmn(
    "End_PurchaseComplete",
    "Task_SubmitRequest",
  );
  expect(result).toMatchObject({
    ok: false,
    code: "bpmn.connection.endEventOutgoing",
  });
});
