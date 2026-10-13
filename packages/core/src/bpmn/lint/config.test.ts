import { describe, expect, test } from "bun:test";
import {
  BPMN_LINT_RULE_IDS,
  BpmnLintConfigError,
  parseLintConfig,
  recommendedLintConfig,
} from "./config.ts";

describe("BPMN lint config", () => {
  test("publishes the pinned 23 rule ids and recommended severities", () => {
    expect(BPMN_LINT_RULE_IDS).toEqual([
      "label-required",
      "no-implicit-end",
      "no-implicit-start",
      "start-event-required",
      "end-event-required",
      "no-disconnected",
      "conditional-flows",
      "no-duplicate-sequence-flows",
      "no-gateway-join-fork",
      "no-implicit-split",
      "single-blank-start-event",
      "single-event-definition",
      "superfluous-gateway",
      "fake-join",
      "no-complex-gateway",
      "no-inclusive-gateway",
      "no-overlapping-elements",
      "superfluous-termination",
      "sub-process-blank-start-event",
      "event-sub-process-typed-start-event",
      "link-event",
      "ad-hoc-sub-process",
      "no-bpmndi",
    ]);
    const config = recommendedLintConfig();
    const warnings = new Set([
      "fake-join",
      "no-overlapping-elements",
      "superfluous-gateway",
      "superfluous-termination",
    ]);
    for (const ruleId of BPMN_LINT_RULE_IDS) {
      expect(config.rules[ruleId]).toBe(
        warnings.has(ruleId) ? "warn" : "error",
      );
    }
  });
  test("extends recommended and then applies rule overrides", () => {
    const config = parseLintConfig(
      '{"extends":"bpmnlint:recommended","rules":{"label-required":"off","fake-join":"error"}}',
    );
    expect(config.rules["label-required"]).toBe("off");
    expect(config.rules["fake-join"]).toBe("error");
    expect(config.rules["no-implicit-start"]).toBe("error");
  });
  test("accepts extends arrays in order and all rules preset", () => {
    expect(
      parseLintConfig('{"extends":["bpmnlint:all","recommended"]}').rules[
        "fake-join"
      ],
    ).toBe("warn");
  });
  test("rejects plugin extends and unknown rule ids", () => {
    expect(() =>
      parseLintConfig('{"extends":"plugin:foo/recommended"}'),
    ).toThrow(BpmnLintConfigError);
    expect(() => parseLintConfig('{"rules":{"no-such-rule":"error"}}')).toThrow(
      BpmnLintConfigError,
    );
  });
  test("accepts and ignores rule options", () => {
    expect(
      parseLintConfig('{"rules":{"label-required":["warn",{"x":1}]}}').rules[
        "label-required"
      ],
    ).toBe("warn");
  });
  test("rejects invalid JSON, roots, extends and severities", () => {
    for (const input of [
      "not json",
      "[]",
      '{"extends":true}',
      '{"rules":{"label-required":"fatal"}',
    ])
      expect(() => parseLintConfig(input)).toThrow(BpmnLintConfigError);
  });
  test("maps numeric levels 0, 1 and 2", () => {
    const config = parseLintConfig(
      '{"rules":{"label-required":0,"no-implicit-end":1,"no-implicit-start":2}}',
    );
    expect(config.rules["label-required"]).toBe("off");
    expect(config.rules["no-implicit-end"]).toBe("warn");
    expect(config.rules["no-implicit-start"]).toBe("error");
  });
});
