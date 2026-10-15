import type { Element } from "@nodetto/ir";
import type { BpmnModel } from "../model.ts";
import type { BpmnLintContext, BpmnLintRuleId } from "./config.ts";

type Finding = { readonly elementId: string; readonly message: string };
type Rule = (model: BpmnModel, context: BpmnLintContext) => readonly Finding[];
type Semantic = Readonly<Record<string, unknown>>;
function sem(element: Element): Semantic {
  return element.semantic as Semantic;
}
function text(element: Element, key: string): string | undefined {
  const value = sem(element)[key];
  return typeof value === "string" ? value : undefined;
}
function bool(element: Element, key: string): boolean {
  return sem(element)[key] === true;
}
function array(element: Element, key: string): readonly unknown[] {
  const value = sem(element)[key];
  return Array.isArray(value) ? value : [];
}
function flowNodes(model: BpmnModel): Element[] {
  return model.order
    .map((id) => model.get(id))
    .filter(
      (element): element is Element =>
        !!element &&
        [
          "bpmn.task",
          "bpmn.subProcess",
          "bpmn.callActivity",
          "bpmn.event",
          "bpmn.boundaryEvent",
          "bpmn.gateway",
        ].includes(element.type),
    );
}
function events(model: BpmnModel): Element[] {
  return model.order
    .map((id) => model.get(id))
    .filter(
      (element): element is Element =>
        !!element &&
        (element.type === "bpmn.event" ||
          element.type === "bpmn.boundaryEvent"),
    );
}
function eventPosition(element: Element): string | undefined {
  return text(element, "position");
}
function isStart(element: Element): boolean {
  return element.type === "bpmn.event" && eventPosition(element) === "start";
}
function isEnd(element: Element): boolean {
  return element.type === "bpmn.event" && eventPosition(element) === "end";
}
function flowName(element: Element): string {
  return (text(element, "name") ?? "").trim();
}
function isLink(element: Element): boolean {
  return array(element, "definitions").some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "kind" in entry &&
      entry.kind === "link",
  );
}
function linkDefinition(element: Element): Semantic | undefined {
  const definition = array(element, "definitions").find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "kind" in entry &&
      entry.kind === "link",
  );
  return typeof definition === "object" && definition !== null
    ? (definition as Semantic)
    : undefined;
}
function eventDefs(element: Element): readonly unknown[] {
  return array(element, "definitions");
}
function boxOf(element: Element):
  | {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | undefined {
  const { x, y, width, height } = element.visual;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  )
    return undefined;
  return { x, y, width, height };
}
function isGateway(element: Element): boolean {
  return element.type === "bpmn.gateway";
}
function isAdHocScope(model: BpmnModel, element: Element): boolean {
  const scope = model.get(model.scopeOf(element.id));
  return scope?.type === "bpmn.subProcess" && bool(scope, "adHoc");
}
function isEventSubProcess(element: Element): boolean {
  return (
    element.type === "bpmn.subProcess" && bool(element, "triggeredByEvent")
  );
}
function isCompensationActivity(element: Element): boolean {
  return (
    ["bpmn.task", "bpmn.subProcess", "bpmn.callActivity"].includes(
      element.type,
    ) && bool(element, "forCompensation")
  );
}
function exemptFlowNode(model: BpmnModel, element: Element): boolean {
  return (
    element.type === "bpmn.boundaryEvent" ||
    isCompensationActivity(element) ||
    isEventSubProcess(element) ||
    isAdHocScope(model, element)
  );
}
function plainMessage(rule: BpmnLintRuleId, id: string): Finding {
  return { elementId: id, message: messages[rule] };
}
const messages: Readonly<Record<BpmnLintRuleId, string>> = {
  "label-required": "This BPMN element needs a label.",
  "no-implicit-end": "This flow node has no path to an explicit end event.",
  "no-implicit-start":
    "This flow node has no incoming sequence flow from a start event.",
  "start-event-required": "This process scope needs a start event.",
  "end-event-required": "This process scope needs an end event.",
  "no-disconnected":
    "This flow node has no incoming or outgoing sequence flow.",
  "conditional-flows":
    "This outgoing flow needs a condition or must be the default flow.",
  "no-duplicate-sequence-flows":
    "This sequence flow duplicates an earlier flow.",
  "no-gateway-join-fork": "This gateway joins and forks in the same place.",
  "no-implicit-split":
    "This flow node splits into multiple unconditioned paths.",
  "single-blank-start-event":
    "Only one start event without a definition is allowed in this scope.",
  "single-event-definition": "This event has more than one event definition.",
  "superfluous-gateway": "This gateway has one incoming and one outgoing flow.",
  "fake-join": "This flow node joins multiple paths without a gateway.",
  "no-complex-gateway":
    "Complex gateways are not supported by this conformance level.",
  "no-inclusive-gateway":
    "Inclusive gateways are not supported by this conformance level.",
  "no-overlapping-elements":
    "This flow node overlaps another visible flow node.",
  "superfluous-termination":
    "This terminate event is used without concurrent paths.",
  "sub-process-blank-start-event":
    "A regular sub-process start event needs an event definition.",
  "event-sub-process-typed-start-event":
    "An event sub-process start event needs an event definition.",
  "link-event": "This link event needs a matching name and catch/throw pair.",
  "ad-hoc-sub-process":
    "Ad-hoc sub-processes must not contain start or end events.",
  "no-bpmndi": "This BPMN element has no diagram geometry.",
};

const rules: Readonly<Record<BpmnLintRuleId, Rule>> = {
  "label-required": (model) =>
    model.order.flatMap((id) => {
      const element = model.get(id);
      if (!element) return [];
      if (["bpmn.participant", "bpmn.lane"].includes(element.type))
        return flowName(element) ? [] : [plainMessage("label-required", id)];
      if (isGateway(element)) {
        const outgoing = model.outgoing(id).length;
        if (
          flowName(element) ||
          ["parallel", "eventBased"].includes(
            text(element, "gatewayType") ?? "",
          ) ||
          outgoing <= 1
        )
          return [];
        return [plainMessage("label-required", id)];
      }
      if (
        [
          "bpmn.task",
          "bpmn.subProcess",
          "bpmn.callActivity",
          "bpmn.event",
        ].includes(element.type) &&
        !flowName(element)
      )
        return [plainMessage("label-required", id)];
      if (
        element.type === "bpmn.sequenceFlow" &&
        !!text(element, "condition") &&
        !flowName(element)
      )
        return [plainMessage("label-required", id)];
      return [];
    }),
  "no-implicit-end": (model) =>
    flowNodes(model).flatMap((node) =>
      exemptFlowNode(model, node) ||
      isEnd(node) ||
      model.outgoing(node.id).length > 0 ||
      (isLink(node) && text(node, "position") === "intermediateThrow")
        ? []
        : [plainMessage("no-implicit-end", node.id)],
    ),
  "no-implicit-start": (model) =>
    flowNodes(model).flatMap((node) =>
      exemptFlowNode(model, node) ||
      isStart(node) ||
      model.incoming(node.id).length > 0 ||
      (isLink(node) && text(node, "position") === "intermediateCatch")
        ? []
        : [plainMessage("no-implicit-start", node.id)],
    ),
  "start-event-required": (model) =>
    model.scopes().flatMap((scope) => {
      const scopeElement = model.get(scope);
      if (
        scopeElement?.type === "bpmn.subProcess" &&
        bool(scopeElement, "adHoc")
      )
        return [];
      const nodes = flowNodes(model).filter(
        (node) => model.scopeOf(node.id) === scope,
      );
      if (scope === model.pageId && nodes.length === 0) return [];
      return nodes.some(isStart)
        ? []
        : [plainMessage("start-event-required", scope)];
    }),
  "end-event-required": (model) =>
    model.scopes().flatMap((scope) => {
      const scopeElement = model.get(scope);
      if (
        scopeElement?.type === "bpmn.subProcess" &&
        bool(scopeElement, "adHoc")
      )
        return [];
      const nodes = flowNodes(model).filter(
        (node) => model.scopeOf(node.id) === scope,
      );
      if (scope === model.pageId && nodes.length === 0) return [];
      return nodes.some(isEnd)
        ? []
        : [plainMessage("end-event-required", scope)];
    }),
  "no-disconnected": (model) =>
    flowNodes(model).flatMap((node) =>
      exemptFlowNode(model, node) ||
      model.incoming(node.id).length + model.outgoing(node.id).length > 0
        ? []
        : [plainMessage("no-disconnected", node.id)],
    ),
  "conditional-flows": (model) =>
    flowNodes(model).flatMap((node) => {
      if (
        isGateway(node) &&
        ["parallel", "eventBased"].includes(text(node, "gatewayType") ?? "")
      )
        return [];
      const outgoing = model.outgoing(node.id);
      const conditionalFork = outgoing.some(
        (flow) => !!text(flow, "condition") || bool(flow, "isDefault"),
      );
      return conditionalFork
        ? outgoing
            .filter(
              (flow) => !text(flow, "condition") && !bool(flow, "isDefault"),
            )
            .map((flow) => plainMessage("conditional-flows", flow.id))
        : [];
    }),
  "no-duplicate-sequence-flows": (model) => {
    const seen = new Set<string>();
    return model.order.flatMap((id) => {
      const flow = model.get(id);
      if (flow?.type !== "bpmn.sequenceFlow") return [];
      const key = JSON.stringify([
        text(flow, "from"),
        text(flow, "to"),
        text(flow, "condition") ?? "",
      ]);
      if (seen.has(key))
        return [plainMessage("no-duplicate-sequence-flows", id)];
      seen.add(key);
      return [];
    });
  },
  "no-gateway-join-fork": (model) =>
    flowNodes(model)
      .filter(isGateway)
      .flatMap((gateway) =>
        model.incoming(gateway.id).length > 1 &&
        model.outgoing(gateway.id).length > 1
          ? [plainMessage("no-gateway-join-fork", gateway.id)]
          : [],
      ),
  "no-implicit-split": (model) =>
    flowNodes(model)
      .filter((node) => !isGateway(node))
      .flatMap((node) => {
        const plain = model
          .outgoing(node.id)
          .filter(
            (flow) => !text(flow, "condition") && !bool(flow, "isDefault"),
          );
        return plain.length > 1
          ? [plainMessage("no-implicit-split", node.id)]
          : [];
      }),
  "single-blank-start-event": (model) =>
    model.scopes().flatMap((scope) => {
      const starts = flowNodes(model).filter(
        (node) =>
          isStart(node) &&
          model.scopeOf(node.id) === scope &&
          eventDefs(node).length === 0,
      );
      return starts
        .slice(1)
        .map((node) => plainMessage("single-blank-start-event", node.id));
    }),
  "single-event-definition": (model) =>
    events(model)
      .filter((event) => eventDefs(event).length > 1)
      .map((event) => plainMessage("single-event-definition", event.id)),
  "superfluous-gateway": (model) =>
    flowNodes(model)
      .filter(isGateway)
      .flatMap((gateway) =>
        model.incoming(gateway.id).length === 1 &&
        model.outgoing(gateway.id).length === 1
          ? [plainMessage("superfluous-gateway", gateway.id)]
          : [],
      ),
  "fake-join": (model) =>
    flowNodes(model)
      .filter((node) => !isGateway(node) && model.incoming(node.id).length > 1)
      .map((node) => plainMessage("fake-join", node.id)),
  "no-complex-gateway": (model) =>
    flowNodes(model)
      .filter(
        (node) => isGateway(node) && text(node, "gatewayType") === "complex",
      )
      .map((node) => plainMessage("no-complex-gateway", node.id)),
  "no-inclusive-gateway": (model) =>
    flowNodes(model)
      .filter(
        (node) => isGateway(node) && text(node, "gatewayType") === "inclusive",
      )
      .map((node) => plainMessage("no-inclusive-gateway", node.id)),
  "no-overlapping-elements": (model) => {
    const nodes = flowNodes(model).filter(
      (node) => node.visual.hidden !== true,
    );
    const findings: Finding[] = [];
    for (let laterIndex = 0; laterIndex < nodes.length; laterIndex++) {
      const later = nodes[laterIndex];
      if (!later) continue;
      for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex++) {
        const earlier = nodes[earlierIndex];
        if (!earlier || model.scopeOf(later.id) !== model.scopeOf(earlier.id))
          continue;
        const boundaryHost =
          (later.type === "bpmn.boundaryEvent" &&
            text(later, "attachedTo") === earlier.id) ||
          (earlier.type === "bpmn.boundaryEvent" &&
            text(earlier, "attachedTo") === later.id);
        const subprocessDescendant =
          (earlier.type === "bpmn.subProcess" &&
            bool(earlier, "expanded") &&
            model.descendantsOf(earlier.id).includes(later.id)) ||
          (later.type === "bpmn.subProcess" &&
            bool(later, "expanded") &&
            model.descendantsOf(later.id).includes(earlier.id));
        if (boundaryHost || subprocessDescendant) continue;
        const laterBox = boxOf(later);
        const earlierBox = boxOf(earlier);
        if (!laterBox || !earlierBox) continue;
        const overlapX =
          Math.min(
            laterBox.x + laterBox.width,
            earlierBox.x + earlierBox.width,
          ) - Math.max(laterBox.x, earlierBox.x);
        const overlapY =
          Math.min(
            laterBox.y + laterBox.height,
            earlierBox.y + earlierBox.height,
          ) - Math.max(laterBox.y, earlierBox.y);
        if (overlapX > 0 && overlapY > 0) {
          findings.push(plainMessage("no-overlapping-elements", later.id));
          break;
        }
      }
    }
    return findings;
  },
  "superfluous-termination": (model) =>
    events(model)
      .filter(
        (event) =>
          isEnd(event) &&
          eventDefs(event).some(
            (definition) =>
              typeof definition === "object" &&
              definition !== null &&
              "kind" in definition &&
              definition.kind === "terminate",
          ),
      )
      .flatMap((event) => {
        const scope = model.scopeOf(event.id);
        const nodes = flowNodes(model).filter(
          (node) => model.scopeOf(node.id) === scope,
        );
        const concurrent =
          nodes.some(
            (node) =>
              (isGateway(node) &&
                ["parallel", "inclusive", "complex"].includes(
                  text(node, "gatewayType") ?? "",
                ) &&
                model.outgoing(node.id).length > 1) ||
              (!isGateway(node) &&
                model
                  .outgoing(node.id)
                  .filter(
                    (flow) =>
                      !text(flow, "condition") && !bool(flow, "isDefault"),
                  ).length > 1),
          ) || nodes.filter(isStart).length > 1;
        return concurrent
          ? []
          : [plainMessage("superfluous-termination", event.id)];
      }),
  "sub-process-blank-start-event": (model) =>
    flowNodes(model)
      .filter((node) => isStart(node) && eventDefs(node).length > 0)
      .flatMap((node) => {
        const scope = model.get(model.scopeOf(node.id));
        return scope?.type === "bpmn.subProcess" &&
          !bool(scope, "triggeredByEvent")
          ? [plainMessage("sub-process-blank-start-event", node.id)]
          : [];
      }),
  "event-sub-process-typed-start-event": (model) =>
    flowNodes(model)
      .filter((node) => isStart(node) && eventDefs(node).length === 0)
      .flatMap((node) => {
        const scope = model.get(model.scopeOf(node.id));
        return scope?.type === "bpmn.subProcess" &&
          bool(scope, "triggeredByEvent")
          ? [plainMessage("event-sub-process-typed-start-event", node.id)]
          : [];
      }),
  "link-event": (model) => {
    const links = events(model).filter(isLink);
    const findings: Finding[] = [];
    for (const event of links) {
      const definition = linkDefinition(event);
      const name =
        typeof definition?.["linkName"] === "string"
          ? (definition["linkName"] as string)
          : flowName(event);
      if (!name.trim()) findings.push(plainMessage("link-event", event.id));
      const position = eventPosition(event);
      const sameScope = links.filter(
        (other) => model.scopeOf(other.id) === model.scopeOf(event.id),
      );
      if (
        position === "intermediateThrow" &&
        !sameScope.some(
          (other) =>
            eventPosition(other) === "intermediateCatch" &&
            (typeof linkDefinition(other)?.["linkName"] === "string"
              ? linkDefinition(other)?.["linkName"]
              : flowName(other)) === name,
        )
      )
        findings.push(plainMessage("link-event", event.id));
      if (
        position === "intermediateCatch" &&
        sameScope.some(
          (other) =>
            other.id !== event.id &&
            eventPosition(other) === "intermediateCatch" &&
            (typeof linkDefinition(other)?.["linkName"] === "string"
              ? linkDefinition(other)?.["linkName"]
              : flowName(other)) === name,
        )
      )
        findings.push(plainMessage("link-event", event.id));
    }
    return findings;
  },
  "ad-hoc-sub-process": (model) =>
    flowNodes(model)
      .filter((node) => isStart(node) || isEnd(node))
      .flatMap((node) =>
        isAdHocScope(model, node)
          ? [plainMessage("ad-hoc-sub-process", node.id)]
          : [],
      ),
  "no-bpmndi": (model, context) =>
    (context.missingDi ?? [])
      .filter((id) => model.get(id) !== undefined)
      .map((id) => plainMessage("no-bpmndi", id)),
};

export function evaluateBpmnRule(
  ruleId: BpmnLintRuleId,
  model: BpmnModel,
  context: BpmnLintContext,
): readonly Finding[] {
  return rules[ruleId](model, context);
}
