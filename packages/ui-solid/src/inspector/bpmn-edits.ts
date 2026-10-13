import type { BpmnModel } from "@diagra/core";
import type {
  BpmnEventDefinition,
  BpmnEventDefinitionKind,
  BpmnEventPosition,
} from "@diagra/ir";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function withField(
  semantic: unknown,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...record(semantic) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export function withDefinitionKinds(
  semantic: unknown,
  kinds: readonly BpmnEventDefinitionKind[],
  elementId: string,
): Record<string, unknown> {
  const source = record(semantic);
  const definitions = Array.isArray(source["definitions"])
    ? (source["definitions"] as BpmnEventDefinition[])
    : [];
  const selected = new Set(kinds);
  const next = definitions.filter((definition) =>
    selected.has(definition.kind),
  );
  const present = new Set(next.map((definition) => definition.kind));
  const usedIds = new Set(next.map((definition) => definition.id));
  for (const kind of kinds) {
    if (present.has(kind)) continue;
    let suffix = 1;
    let id = `def-${elementId}-${suffix}`;
    while (usedIds.has(id)) {
      suffix += 1;
      id = `def-${elementId}-${suffix}`;
    }
    usedIds.add(id);
    next.push({
      id,
      kind,
      ...(kind === "timer" ? { timer: { type: "duration", value: "" } } : {}),
    });
    present.add(kind);
  }
  return { ...source, definitions: next };
}

export function disabledEventPositions(
  model: BpmnModel,
  eventId: string,
): ReadonlySet<BpmnEventPosition> {
  const disabled = new Set<BpmnEventPosition>();
  if (model.incoming(eventId).length > 0) disabled.add("start");
  if (model.outgoing(eventId).length > 0) disabled.add("end");
  return disabled;
}
