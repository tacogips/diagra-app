import { describe, expect, test } from "bun:test";
import {
  BPMN_LINT_RULE_IDS,
  type BpmnLintRuleId,
  type BpmnRuleSetting,
} from "./config.ts";
import { lintBpmnPage } from "./engine.ts";
import { buildLintTestDocument, type BpmnElementSpec } from "./test-builder.ts";

type Case = {
  readonly elements: readonly BpmnElementSpec[];
  readonly expectedId?: string;
  readonly missingDi?: readonly string[];
};
const task = (
  id: string,
  extra: Readonly<Record<string, unknown>> = {},
  visual: BpmnElementSpec["visual"] = {},
): BpmnElementSpec => ({
  id,
  type: "bpmn.task",
  semantic: { name: id, taskType: "user", loop: "none", ...extra },
  visual,
});
const event = (
  id: string,
  position: string,
  definitions: readonly unknown[] = [],
  extra: Readonly<Record<string, unknown>> = {},
): BpmnElementSpec => ({
  id,
  type: "bpmn.event",
  semantic: { name: id, position, definitions, ...extra },
});
const gateway = (id: string, gatewayType = "exclusive"): BpmnElementSpec => ({
  id,
  type: "bpmn.gateway",
  semantic: { name: id, gatewayType },
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
const pool = (id = "pool"): BpmnElementSpec => ({
  id,
  type: "bpmn.participant",
  semantic: { name: id, collapsed: false },
});
const start = (
  id: string,
  extra: Readonly<Record<string, unknown>> = {},
): BpmnElementSpec => event(id, "start", [], extra);
const end = (
  id: string,
  extra: Readonly<Record<string, unknown>> = {},
): BpmnElementSpec => event(id, "end", [], extra);
const startScope: Case = {
  elements: [pool(), task("task", { parent: "pool" })],
  expectedId: "pool",
};
const endScope: Case = {
  elements: [pool(), task("task", { parent: "pool" })],
  expectedId: "pool",
};

const cases: Readonly<
  Record<BpmnLintRuleId, { positive: Case; negative: Case }>
> = {
  "label-required": {
    positive: {
      elements: [
        { ...task("task"), semantic: { taskType: "user", loop: "none" } },
      ],
      expectedId: "task",
    },
    negative: { elements: [task("named")] },
  },
  "no-implicit-end": {
    positive: { elements: [task("task")], expectedId: "task" },
    negative: {
      elements: [task("task"), end("end"), flow("f", "task", "end")],
    },
  },
  "no-implicit-start": {
    positive: { elements: [task("task")], expectedId: "task" },
    negative: { elements: [start("start")] },
  },
  "start-event-required": {
    positive: startScope,
    negative: {
      elements: [
        pool(),
        start("start", { parent: "pool" }),
        task("task", { parent: "pool" }),
        flow("f", "start", "task"),
      ],
      expectedId: "pool",
    },
  },
  "end-event-required": {
    positive: endScope,
    negative: {
      elements: [
        pool(),
        start("start", { parent: "pool" }),
        end("end", { parent: "pool" }),
        flow("f", "start", "end"),
      ],
      expectedId: "pool",
    },
  },
  "no-disconnected": {
    positive: { elements: [task("task")], expectedId: "task" },
    negative: {
      elements: [task("task"), end("end"), flow("f", "task", "end")],
    },
  },
  "conditional-flows": {
    positive: {
      elements: [
        task("source"),
        task("a"),
        task("b"),
        flow("conditional", "source", "a", { condition: "ok" }),
        flow("plain", "source", "b"),
      ],
      expectedId: "plain",
    },
    negative: {
      elements: [
        task("source"),
        task("a"),
        task("b"),
        flow("a", "source", "a"),
        flow("b", "source", "b"),
      ],
    },
  },
  "no-duplicate-sequence-flows": {
    positive: {
      elements: [
        task("a"),
        task("b"),
        flow("first", "a", "b"),
        flow("duplicate", "a", "b"),
      ],
      expectedId: "duplicate",
    },
    negative: { elements: [task("a"), task("b"), flow("only", "a", "b")] },
  },
  "no-gateway-join-fork": {
    positive: {
      elements: [
        task("a"),
        task("b"),
        task("c"),
        task("d"),
        gateway("g"),
        flow("i1", "a", "g"),
        flow("i2", "b", "g"),
        flow("o1", "g", "c"),
        flow("o2", "g", "d"),
      ],
      expectedId: "g",
    },
    negative: {
      elements: [
        task("a"),
        task("b"),
        gateway("g"),
        flow("i", "a", "g"),
        flow("o", "g", "b"),
      ],
    },
  },
  "no-implicit-split": {
    positive: {
      elements: [
        task("source"),
        task("a"),
        task("b"),
        flow("a", "source", "a"),
        flow("b", "source", "b"),
      ],
      expectedId: "source",
    },
    negative: {
      elements: [task("source"), task("a"), flow("a", "source", "a")],
    },
  },
  "single-blank-start-event": {
    positive: {
      elements: [start("first"), start("second")],
      expectedId: "second",
    },
    negative: { elements: [start("only")] },
  },
  "single-event-definition": {
    positive: {
      elements: [
        event("event", "intermediateCatch", [
          { id: "m", kind: "message" },
          { id: "t", kind: "timer" },
        ]),
      ],
      expectedId: "event",
    },
    negative: {
      elements: [
        event("event", "intermediateCatch", [{ id: "m", kind: "message" }]),
      ],
    },
  },
  "superfluous-gateway": {
    positive: {
      elements: [
        task("a"),
        task("b"),
        gateway("g"),
        flow("i", "a", "g"),
        flow("o", "g", "b"),
      ],
      expectedId: "g",
    },
    negative: { elements: [task("a"), gateway("g"), flow("i", "a", "g")] },
  },
  "fake-join": {
    positive: {
      elements: [
        task("a"),
        task("b"),
        task("join"),
        flow("i1", "a", "join"),
        flow("i2", "b", "join"),
      ],
      expectedId: "join",
    },
    negative: { elements: [task("a"), task("join"), flow("i", "a", "join")] },
  },
  "no-complex-gateway": {
    positive: { elements: [gateway("g", "complex")], expectedId: "g" },
    negative: { elements: [gateway("g", "exclusive")] },
  },
  "no-inclusive-gateway": {
    positive: { elements: [gateway("g", "inclusive")], expectedId: "g" },
    negative: { elements: [gateway("g", "parallel")] },
  },
  "no-overlapping-elements": {
    positive: {
      elements: [
        task("a", {}, { x: 0, y: 0, width: 20, height: 20 }),
        task("b", {}, { x: 10, y: 10, width: 20, height: 20 }),
      ],
      expectedId: "b",
    },
    negative: {
      elements: [
        task("a", {}, { x: 0, y: 0, width: 20, height: 20 }),
        task("b", {}, { x: 20, y: 20, width: 20, height: 20 }),
      ],
    },
  },
  "superfluous-termination": {
    positive: {
      elements: [
        event("terminate", "end", [{ id: "term", kind: "terminate" }]),
      ],
      expectedId: "terminate",
    },
    negative: {
      elements: [
        gateway("split", "parallel"),
        task("a"),
        task("b"),
        flow("a", "split", "a"),
        flow("b", "split", "b"),
        event("terminate", "end", [{ id: "term", kind: "terminate" }]),
      ],
    },
  },
  "sub-process-blank-start-event": {
    positive: {
      elements: [
        {
          id: "sub",
          type: "bpmn.subProcess",
          semantic: {
            name: "Sub",
            expanded: true,
            triggeredByEvent: false,
            adHoc: false,
            loop: "none",
          },
        },
        event("start", "start", [{ id: "timer", kind: "timer" }], {
          parent: "sub",
        }),
      ],
      expectedId: "start",
    },
    negative: {
      elements: [
        {
          id: "sub",
          type: "bpmn.subProcess",
          semantic: {
            name: "Sub",
            expanded: true,
            triggeredByEvent: false,
            adHoc: false,
            loop: "none",
          },
        },
        start("start", { parent: "sub" }),
      ],
    },
  },
  "event-sub-process-typed-start-event": {
    positive: {
      elements: [
        {
          id: "sub",
          type: "bpmn.subProcess",
          semantic: {
            name: "Sub",
            expanded: true,
            triggeredByEvent: true,
            adHoc: false,
            loop: "none",
          },
        },
        start("start", { parent: "sub" }),
      ],
      expectedId: "start",
    },
    negative: {
      elements: [
        {
          id: "sub",
          type: "bpmn.subProcess",
          semantic: {
            name: "Sub",
            expanded: true,
            triggeredByEvent: true,
            adHoc: false,
            loop: "none",
          },
        },
        event("start", "start", [{ id: "message", kind: "message" }], {
          parent: "sub",
        }),
      ],
    },
  },
  "link-event": {
    positive: {
      elements: [
        event("throw", "intermediateThrow", [
          { id: "link", kind: "link", linkName: "Next" },
        ]),
      ],
      expectedId: "throw",
    },
    negative: {
      elements: [
        event("throw", "intermediateThrow", [
          { id: "link1", kind: "link", linkName: "Next" },
        ]),
        event("catch", "intermediateCatch", [
          { id: "link2", kind: "link", linkName: "Next" },
        ]),
      ],
    },
  },
  "ad-hoc-sub-process": {
    positive: {
      elements: [
        {
          id: "sub",
          type: "bpmn.subProcess",
          semantic: {
            name: "Sub",
            expanded: true,
            triggeredByEvent: false,
            adHoc: true,
            loop: "none",
          },
        },
        start("start", { parent: "sub" }),
      ],
      expectedId: "start",
    },
    negative: { elements: [start("start")] },
  },
  "no-bpmndi": {
    positive: {
      elements: [task("task")],
      missingDi: ["task"],
      expectedId: "task",
    },
    negative: { elements: [task("task")] },
  },
};

function lint(ruleId: BpmnLintRuleId, scenario: Case) {
  const rules = Object.fromEntries(
    BPMN_LINT_RULE_IDS.map((id) => [id, id === ruleId ? "error" : "off"]),
  ) as Record<BpmnLintRuleId, BpmnRuleSetting>;
  const document = buildLintTestDocument({ elements: scenario.elements });
  return lintBpmnPage(
    document,
    "page",
    { rules },
    scenario.missingDi ? { missingDi: scenario.missingDi } : {},
  );
}

describe("BPMN lint rules", () => {
  for (const ruleId of BPMN_LINT_RULE_IDS) {
    test(`${ruleId} reports its positive case`, () => {
      const result = lint(ruleId, cases[ruleId].positive);
      expect(result.map((finding) => finding.elementId)).toContain(
        cases[ruleId].positive.expectedId ?? ruleId,
      );
    });
    test(`${ruleId} accepts its negative case`, () => {
      expect(lint(ruleId, cases[ruleId].negative)).toEqual([]);
    });
  }

  test("exempts link throw and catch events from implicit end and start", () => {
    const document = buildLintTestDocument({
      elements: [
        event("throw", "intermediateThrow", [
          { id: "throw-link", kind: "link", linkName: "Next" },
        ]),
        event("catch", "intermediateCatch", [
          { id: "catch-link", kind: "link", linkName: "Next" },
        ]),
      ],
    });
    const findings = lintBpmnPage(document, "page");
    expect(
      findings.some(
        (finding) =>
          finding.ruleId === "no-implicit-end" && finding.elementId === "throw",
      ),
    ).toBe(false);
    expect(
      findings.some(
        (finding) =>
          finding.ruleId === "no-implicit-start" &&
          finding.elementId === "catch",
      ),
    ).toBe(false);
  });
});
