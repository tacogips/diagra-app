export const BPMN_LINT_RULE_IDS = [
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
] as const;

export type BpmnLintRuleId = (typeof BPMN_LINT_RULE_IDS)[number];
export type BpmnRuleSetting = "off" | "warn" | "error";
export type BpmnLintSeverity = "error" | "warning";
export interface BpmnLintConfig {
  readonly rules: Readonly<Record<BpmnLintRuleId, BpmnRuleSetting>>;
}
export interface BpmnLintFinding {
  readonly ruleId: BpmnLintRuleId;
  readonly severity: BpmnLintSeverity;
  readonly elementId: string;
  readonly message: string;
}
export interface BpmnLintContext {
  readonly missingDi?: readonly string[];
}

const WARN_RULES = new Set<BpmnLintRuleId>([
  "fake-join",
  "no-overlapping-elements",
  "superfluous-gateway",
  "superfluous-termination",
]);
const DESCRIPTIONS: Readonly<Record<BpmnLintRuleId, string>> = {
  "label-required":
    "Require labels on decision points, named containers, and conditional flows.",
  "no-implicit-end": "Require flow nodes to lead to an explicit end event.",
  "no-implicit-start": "Require flow nodes to follow an explicit start event.",
  "start-event-required":
    "Require a start event in every process scope that contains flow nodes.",
  "end-event-required": "Require an end event in every process scope.",
  "no-disconnected":
    "Report flow nodes with no incoming or outgoing sequence flow.",
  "conditional-flows":
    "Require non-default sibling flows to be conditional after a conditional fork.",
  "no-duplicate-sequence-flows":
    "Report repeated sequence flows with the same endpoints and condition.",
  "no-gateway-join-fork": "Avoid gateways that join and fork at the same time.",
  "no-implicit-split":
    "Use an explicit gateway for an unconditioned multi-flow split.",
  "single-blank-start-event":
    "Allow at most one start event without an event definition in a scope.",
  "single-event-definition": "Use at most one event definition on an event.",
  "superfluous-gateway":
    "Remove gateways with exactly one incoming and one outgoing sequence flow.",
  "fake-join": "Use a gateway to join multiple incoming sequence flows.",
  "no-complex-gateway":
    "Avoid complex gateways in descriptive operation flows.",
  "no-inclusive-gateway":
    "Avoid inclusive gateways in descriptive operation flows.",
  "no-overlapping-elements":
    "Keep visible flow-node bounds from overlapping within a scope.",
  "superfluous-termination":
    "Use terminate events only when the scope has concurrent paths.",
  "sub-process-blank-start-event":
    "Give ordinary sub-process start events an event definition.",
  "event-sub-process-typed-start-event":
    "Use an event definition on event sub-process start events.",
  "link-event":
    "Give link events names and pair each throw event with a catch event.",
  "ad-hoc-sub-process":
    "Do not use start or end events inside an ad-hoc sub-process.",
  "no-bpmndi":
    "Provide diagram interchange geometry for every semantic element.",
};

export class BpmnLintConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BpmnLintConfigError";
  }
}
function defaultRules(
  setting: BpmnRuleSetting,
): Record<BpmnLintRuleId, BpmnRuleSetting> {
  return Object.fromEntries(
    BPMN_LINT_RULE_IDS.map((id) => [id, setting]),
  ) as Record<BpmnLintRuleId, BpmnRuleSetting>;
}
export function recommendedLintConfig(): BpmnLintConfig {
  const rules = defaultRules("error");
  for (const id of WARN_RULES) rules[id] = "warn";
  return { rules };
}
const allErrorConfig: BpmnLintConfig = { rules: defaultRules("error") };
const ALL_EXTENDS = new Set(["bpmnlint:all"]);
const RECOMMENDED_EXTENDS = new Set(["bpmnlint:recommended", "recommended"]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseSetting(value: unknown, ruleId: string): BpmnRuleSetting {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === "off" || candidate === 0) return "off";
  if (candidate === "warn" || candidate === 1) return "warn";
  if (candidate === "error" || candidate === 2) return "error";
  throw new BpmnLintConfigError(`Invalid severity for rule '${ruleId}'.`);
}
export function parseLintConfig(text: string): BpmnLintConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BpmnLintConfigError("Lint configuration is not valid JSON.");
  }
  if (!isRecord(parsed))
    throw new BpmnLintConfigError("Lint configuration root must be an object.");
  const rules = defaultRules("off");
  const rawExtends = parsed["extends"];
  const extendList =
    rawExtends === undefined
      ? []
      : Array.isArray(rawExtends)
        ? rawExtends
        : [rawExtends];
  for (const extension of extendList) {
    if (typeof extension !== "string")
      throw new BpmnLintConfigError(
        `Invalid extends value '${String(extension)}'.`,
      );
    if (ALL_EXTENDS.has(extension)) Object.assign(rules, allErrorConfig.rules);
    else if (RECOMMENDED_EXTENDS.has(extension))
      Object.assign(rules, recommendedLintConfig().rules);
    else throw new BpmnLintConfigError(`Unknown extends value '${extension}'.`);
  }
  const rawRules = parsed["rules"];
  if (rawRules !== undefined && !isRecord(rawRules))
    throw new BpmnLintConfigError("The rules setting must be an object.");
  if (isRecord(rawRules)) {
    for (const [rawId, value] of Object.entries(rawRules)) {
      if (!(BPMN_LINT_RULE_IDS as readonly string[]).includes(rawId))
        throw new BpmnLintConfigError(`Unknown rule '${rawId}'.`);
      rules[rawId as BpmnLintRuleId] = parseSetting(value, rawId);
    }
  }
  return { rules };
}
export function bpmnLintRuleDescription(ruleId: BpmnLintRuleId): string {
  return DESCRIPTIONS[ruleId];
}
