import type { Document, PageId } from "@diagra/ir";
import { buildBpmnModel } from "../model.ts";
import {
  BPMN_LINT_RULE_IDS,
  type BpmnLintConfig,
  type BpmnLintContext,
  type BpmnLintFinding,
  recommendedLintConfig,
} from "./config.ts";
import { evaluateBpmnRule } from "./rules.ts";

export function lintBpmnPage(
  document: Document,
  pageId: PageId,
  config: BpmnLintConfig = recommendedLintConfig(),
  context: BpmnLintContext = {},
): readonly BpmnLintFinding[] {
  const model = buildBpmnModel(document, pageId);
  const order = new Map(model.order.map((id, index) => [id, index]));
  const findings: BpmnLintFinding[] = [];
  for (const ruleId of BPMN_LINT_RULE_IDS) {
    const setting = config.rules[ruleId];
    if (setting === "off") continue;
    const severity = setting === "warn" ? "warning" : "error";
    for (const result of evaluateBpmnRule(ruleId, model, context)) {
      findings.push({ ...result, ruleId, severity });
    }
  }
  const unique = new Map<string, BpmnLintFinding>();
  for (const finding of findings) {
    const key = JSON.stringify([
      finding.ruleId,
      finding.elementId,
      finding.message,
      finding.severity,
    ]);
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()].sort((left, right) => {
    const leftOrder =
      left.elementId === pageId
        ? -1
        : (order.get(left.elementId) ?? Number.MAX_SAFE_INTEGER);
    const rightOrder =
      right.elementId === pageId
        ? -1
        : (order.get(right.elementId) ?? Number.MAX_SAFE_INTEGER);
    return (
      leftOrder - rightOrder ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.message.localeCompare(right.message)
    );
  });
}

export type {
  BpmnLintFinding,
  BpmnLintConfig,
  BpmnLintContext,
  BpmnLintRuleId,
} from "./config.ts";
