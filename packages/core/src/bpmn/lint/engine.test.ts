import { describe, expect, test } from "bun:test";
import { BPMN_LINT_RULE_IDS, recommendedLintConfig } from "./config.ts";
import { lintBpmnPage } from "./engine.ts";
import { buildLintTestDocument, type BpmnElementSpec } from "./test-builder.ts";

const event = (id: string, position: string): BpmnElementSpec => ({
  id,
  type: "bpmn.event",
  semantic: { position, definitions: [] },
});
const task = (id: string, name = id): BpmnElementSpec => ({
  id,
  type: "bpmn.task",
  semantic: { name, taskType: "user", loop: "none" },
});
const flow = (
  id: string,
  from: string,
  to: string,
  extra: Readonly<Record<string, unknown>> = {},
): BpmnElementSpec => ({
  id,
  type: "bpmn.sequenceFlow",
  semantic: { from, to, ...extra },
});

describe("BPMN lint engine", () => {
  test("reports the article-equivalent three draft findings", () => {
    const doc = buildLintTestDocument({
      elements: [
        {
          id: "pool",
          type: "bpmn.participant",
          semantic: { name: "Purchasing", collapsed: false },
        },
        {
          ...event("start", "start"),
          semantic: {
            name: "Start",
            position: "start",
            definitions: [],
            parent: "pool",
          },
        },
        {
          ...task("task", ""),
          semantic: {
            name: "",
            taskType: "user",
            loop: "none",
            parent: "pool",
          },
        },
        {
          id: "throw",
          type: "bpmn.event",
          semantic: {
            name: "Order sent",
            position: "intermediateThrow",
            definitions: [{ id: "message", kind: "message" }],
            parent: "pool",
          },
        },
        {
          ...event("end", "end"),
          semantic: {
            name: "End",
            position: "end",
            definitions: [],
            parent: "pool",
          },
        },
        flow("f1", "start", "task"),
        flow("f2", "throw", "end"),
      ],
    });
    expect(
      lintBpmnPage(doc, "page").map(({ ruleId, elementId }) => [
        ruleId,
        elementId,
      ]),
    ).toEqual([
      ["label-required", "task"],
      ["no-implicit-end", "task"],
      ["no-implicit-start", "throw"],
    ]);
  });
  test("does not count message flows as sequence-flow connectivity", () => {
    const doc = buildLintTestDocument({
      elements: [
        {
          id: "p1",
          type: "bpmn.participant",
          semantic: { name: "Pool 1", collapsed: false },
        },
        {
          id: "p2",
          type: "bpmn.participant",
          semantic: { name: "Pool 2", collapsed: false },
        },
        {
          ...event("s1", "start"),
          semantic: {
            name: "Start",
            position: "start",
            definitions: [],
            parent: "p1",
          },
        },
        {
          ...task("t1"),
          semantic: {
            name: "t1",
            taskType: "user",
            loop: "none",
            parent: "p1",
          },
        },
        {
          ...event("e1", "end"),
          semantic: {
            name: "End",
            position: "end",
            definitions: [],
            parent: "p1",
          },
        },
        {
          ...event("s2", "start"),
          semantic: {
            name: "Start",
            position: "start",
            definitions: [],
            parent: "p2",
          },
        },
        {
          ...task("t2"),
          semantic: {
            name: "t2",
            taskType: "user",
            loop: "none",
            parent: "p2",
          },
        },
        {
          ...event("e2", "end"),
          semantic: {
            name: "End",
            position: "end",
            definitions: [],
            parent: "p2",
          },
        },
        flow("a", "s1", "t1"),
        flow("b", "t1", "e1"),
        flow("c", "s2", "t2"),
        flow("d", "t2", "e2"),
        {
          id: "msg",
          type: "bpmn.messageFlow",
          semantic: { from: "t1", to: "t2" },
        },
      ],
    });
    expect(lintBpmnPage(doc, "page")).toEqual([]);
  });
  test("exempts unattached boundary events from implicit start", () => {
    const doc = buildLintTestDocument({
      elements: [
        task("host"),
        {
          id: "boundary",
          type: "bpmn.boundaryEvent",
          semantic: { attachedTo: "host", definitions: [] },
        },
      ],
    });
    expect(
      lintBpmnPage(doc, "page").some(
        (finding) =>
          finding.ruleId === "no-implicit-start" &&
          finding.elementId === "boundary",
      ),
    ).toBe(false);
  });
  test("orders findings stably by model order then rule id", () => {
    const doc = buildLintTestDocument({
      elements: [task("z", ""), task("a", "")],
    });
    const defaults = recommendedLintConfig();
    const config = {
      rules: Object.fromEntries(
        BPMN_LINT_RULE_IDS.map((id) => [
          id,
          id === "label-required" || id === "no-disconnected" ? "error" : "off",
        ]),
      ),
    } as typeof defaults;
    const first = lintBpmnPage(doc, "page", config);
    expect(lintBpmnPage(doc, "page", config)).toEqual(first);
    expect(
      first
        .filter((finding) => finding.ruleId === "no-disconnected")
        .map((finding) => finding.elementId),
    ).toEqual(["z", "a"]);
    expect(first.slice(0, 2).map((finding) => finding.ruleId)).toEqual([
      "label-required",
      "no-disconnected",
    ]);
  });
  test("warn maps to warning and off suppresses findings", () => {
    const doc = buildLintTestDocument({ elements: [task("task", "")] });
    const config = {
      rules: Object.fromEntries(
        BPMN_LINT_RULE_IDS.map((id) => [
          id,
          id === "label-required" ? "warn" : "off",
        ]),
      ),
    } as ReturnType<typeof recommendedLintConfig>;
    expect(lintBpmnPage(doc, "page", config)[0]?.severity).toBe("warning");
    const off = {
      rules: { ...config.rules, "label-required": "off" },
    } as ReturnType<typeof recommendedLintConfig>;
    expect(lintBpmnPage(doc, "page", off)).toEqual([]);
  });
});
