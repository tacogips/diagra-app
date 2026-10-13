import type { Document, Element, ElementId, PageId } from "@nodetto/ir";
import { compareFractional } from "../fractional.ts";

export type BpmnScopeId = string;

export interface BpmnModel {
  readonly pageId: PageId;
  readonly elements: ReadonlyMap<ElementId, Element>;
  readonly order: readonly ElementId[];
  get(id: ElementId): Element | undefined;
  parentOf(id: ElementId): ElementId | undefined;
  participantOf(id: ElementId): ElementId | undefined;
  scopeOf(id: ElementId): BpmnScopeId;
  incoming(id: ElementId): readonly Element[];
  outgoing(id: ElementId): readonly Element[];
  boundaryEventsOf(activityId: ElementId): readonly Element[];
  descendantsOf(containerId: ElementId): readonly ElementId[];
  scopes(): readonly BpmnScopeId[];
}

export function isBpmnFlowNode(type: string): boolean {
  return [
    "bpmn.task",
    "bpmn.subProcess",
    "bpmn.callActivity",
    "bpmn.event",
    "bpmn.boundaryEvent",
    "bpmn.gateway",
  ].includes(type);
}

export function isBpmnActivity(type: string): boolean {
  return ["bpmn.task", "bpmn.subProcess", "bpmn.callActivity"].includes(type);
}

export function isBpmnFlowType(type: string): boolean {
  return [
    "bpmn.sequenceFlow",
    "bpmn.messageFlow",
    "bpmn.association",
    "bpmn.dataAssociation",
  ].includes(type);
}

function semantic(element: Element): Record<string, unknown> {
  return element.semantic as Record<string, unknown>;
}

function stringField(
  element: Element | undefined,
  field: string,
): string | undefined {
  const value = element ? semantic(element)[field] : undefined;
  return typeof value === "string" ? value : undefined;
}

export function buildBpmnModel(document: Document, pageId: PageId): BpmnModel {
  const ordered = document.elements
    .filter(
      (element) => element.page === pageId && element.type.startsWith("bpmn."),
    )
    .sort(
      (left, right) =>
        compareFractional(left.index, right.index) ||
        compareFractional(left.id, right.id),
    );
  const elements = new Map(ordered.map((element) => [element.id, element]));
  const byId = (id: ElementId) => elements.get(id);
  const parentOf = (id: ElementId): ElementId | undefined => {
    const element = byId(id);
    if (!element) return undefined;
    if (element.type === "bpmn.boundaryEvent") {
      const host = byId(stringField(element, "attachedTo") ?? "");
      return host ? stringField(host, "parent") : undefined;
    }
    return stringField(element, "parent");
  };
  const chain = (id: ElementId): Element[] => {
    const out: Element[] = [];
    const visited = new Set<ElementId>([id]);
    let current = parentOf(id);
    while (current) {
      if (visited.has(current)) return [];
      visited.add(current);
      const element = byId(current);
      if (!element) break;
      out.push(element);
      current = parentOf(current);
    }
    return out;
  };
  const participantOf = (id: ElementId): ElementId | undefined => {
    const element = byId(id);
    if (element?.type === "bpmn.boundaryEvent") {
      const host = stringField(element, "attachedTo");
      return host ? participantOf(host) : undefined;
    }
    if (element?.type === "bpmn.participant") return id;
    return chain(id).find((ancestor) => ancestor.type === "bpmn.participant")
      ?.id;
  };
  const scopeOf = (id: ElementId): BpmnScopeId => {
    const element = byId(id);
    if (element?.type === "bpmn.boundaryEvent") {
      const host = stringField(element, "attachedTo");
      return host ? scopeOf(host) : pageId;
    }
    const ancestors = chain(id);
    if (ancestors.length === 0 && parentOf(id) !== undefined) return pageId;
    const subProcess = ancestors.find(
      (ancestor) => ancestor.type === "bpmn.subProcess",
    );
    if (subProcess) return subProcess.id;
    const participant = ancestors.find(
      (ancestor) => ancestor.type === "bpmn.participant",
    );
    if (participant && semantic(participant)["collapsed"] === true)
      return pageId;
    if (element?.type === "bpmn.participant") {
      return semantic(element)["collapsed"] === true ? pageId : id;
    }
    return participant?.id ?? pageId;
  };
  const flows = ordered.filter(
    (element) => element.type === "bpmn.sequenceFlow",
  );
  const flowEnd = (element: Element, field: "from" | "to") =>
    stringField(element, field);
  const boundaryEventsOf = (activityId: ElementId) =>
    ordered.filter(
      (element) =>
        element.type === "bpmn.boundaryEvent" &&
        stringField(element, "attachedTo") === activityId,
    );
  const descendantsOf = (containerId: ElementId): readonly ElementId[] => {
    const descendants = new Set<ElementId>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const element of ordered) {
        const parent =
          element.type === "bpmn.boundaryEvent"
            ? stringField(element, "attachedTo")
            : parentOf(element.id);
        if (
          (parent === containerId || (parent && descendants.has(parent))) &&
          !descendants.has(element.id)
        ) {
          descendants.add(element.id);
          changed = true;
        }
      }
    }
    return ordered
      .filter((element) => descendants.has(element.id))
      .map((element) => element.id);
  };
  const scopes = (): readonly BpmnScopeId[] => {
    const result = new Set<BpmnScopeId>();
    for (const element of ordered) {
      if (
        element.type === "bpmn.participant" &&
        semantic(element)["collapsed"] !== true
      )
        result.add(element.id);
      if (element.type === "bpmn.subProcess") result.add(element.id);
      if (isBpmnFlowNode(element.type) && parentOf(element.id) === undefined)
        result.add(pageId);
    }
    return [...result];
  };
  return {
    pageId,
    elements,
    order: ordered.map((element) => element.id),
    get: byId,
    parentOf,
    participantOf,
    scopeOf,
    incoming: (id) => flows.filter((flow) => flowEnd(flow, "to") === id),
    outgoing: (id) => flows.filter((flow) => flowEnd(flow, "from") === id),
    boundaryEventsOf,
    descendantsOf,
    scopes,
  };
}
