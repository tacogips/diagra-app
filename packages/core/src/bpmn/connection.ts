import type { Document, Element, ElementId } from "@diagra/ir";
import { buildBpmnModel, isBpmnActivity, isBpmnFlowNode } from "./model.ts";

export type BpmnFlowType =
  | "bpmn.sequenceFlow"
  | "bpmn.messageFlow"
  | "bpmn.association"
  | "bpmn.dataAssociation";

export type BpmnRejectionCode =
  | "bpmn.connection.crossPoolSequenceFlow"
  | "bpmn.connection.samePoolMessageFlow"
  | "bpmn.connection.startEventIncoming"
  | "bpmn.connection.endEventOutgoing"
  | "bpmn.connection.boundaryIncoming"
  | "bpmn.connection.crossScope"
  | "bpmn.connection.invalidEndpoint";

export interface BpmnRejection {
  readonly code: BpmnRejectionCode;
  readonly message: string;
}

export type BpmnConnectionResult =
  | {
      readonly ok: true;
      readonly type: BpmnFlowType;
      readonly corrected: boolean;
    }
  | ({ readonly ok: false } & BpmnRejection);

const reject = (
  code: BpmnRejectionCode,
  message: string,
): BpmnConnectionResult => ({
  ok: false,
  code,
  message,
});

const semantic = (element: Element): Record<string, unknown> =>
  element.semantic as Record<string, unknown>;

const dataType = (element: Element): boolean =>
  element.type === "bpmn.dataObject" || element.type === "bpmn.dataStore";

const collapsedParticipant = (element: Element): boolean =>
  element.type === "bpmn.participant" && semantic(element).collapsed === true;

export function resolveBpmnConnection(
  document: Document,
  from: ElementId,
  to: ElementId,
  requested?: BpmnFlowType,
): BpmnConnectionResult {
  const source = document.elements.find((element) => element.id === from);
  const target = document.elements.find((element) => element.id === to);
  if (
    !source ||
    !target ||
    source.page !== target.page ||
    !source.type.startsWith("bpmn.") ||
    !target.type.startsWith("bpmn.") ||
    from === to
  )
    return reject(
      "bpmn.connection.invalidEndpoint",
      "Choose two different BPMN elements on the same page.",
    );

  const model = buildBpmnModel(document, source.page);
  if (source.type === "bpmn.group" || target.type === "bpmn.group")
    return reject(
      "bpmn.connection.invalidEndpoint",
      "Groups cannot be flow endpoints.",
    );
  if (source.type === "bpmn.lane" || target.type === "bpmn.lane")
    return reject(
      "bpmn.connection.invalidEndpoint",
      "Lanes cannot be flow endpoints.",
    );
  if (
    source.type === "bpmn.textAnnotation" ||
    target.type === "bpmn.textAnnotation"
  ) {
    const other = source.type === "bpmn.textAnnotation" ? target : source;
    if (other.type === "bpmn.group")
      return reject(
        "bpmn.connection.invalidEndpoint",
        "Groups cannot be flow endpoints.",
      );
    return {
      ok: true,
      type: "bpmn.association",
      corrected: requested !== undefined && requested !== "bpmn.association",
    };
  }

  if (dataType(source) || dataType(target)) {
    const other = dataType(source) ? target : source;
    if (dataType(source) && dataType(target))
      return reject(
        "bpmn.connection.invalidEndpoint",
        "A data flow must connect data to an activity or event.",
      );
    if (
      !isBpmnActivity(other.type) &&
      other.type !== "bpmn.event" &&
      other.type !== "bpmn.boundaryEvent"
    )
      return reject(
        "bpmn.connection.invalidEndpoint",
        "Data flows connect data to an activity or event.",
      );
    return {
      ok: true,
      type: "bpmn.dataAssociation",
      corrected:
        requested !== undefined && requested !== "bpmn.dataAssociation",
    };
  }

  const sourcePool =
    model.participantOf(from) ??
    (collapsedParticipant(source) ? from : undefined);
  const targetPool =
    model.participantOf(to) ?? (collapsedParticipant(target) ? to : undefined);
  const crossPool =
    sourcePool !== targetPool &&
    (sourcePool !== undefined || targetPool !== undefined);
  const defaultType: BpmnFlowType = crossPool
    ? "bpmn.messageFlow"
    : "bpmn.sequenceFlow";
  const type =
    requested && requested !== defaultType
      ? defaultType
      : (requested ?? defaultType);

  if (type === "bpmn.messageFlow") {
    if (!crossPool)
      return reject(
        "bpmn.connection.samePoolMessageFlow",
        "A message flow must cross pool boundaries.",
      );
    const sourceAllowed =
      isBpmnActivity(source.type) ||
      source.type === "bpmn.participant" ||
      (source.type === "bpmn.event" &&
        ["intermediateThrow", "end"].includes(
          String(semantic(source).position),
        ));
    const targetAllowed =
      isBpmnActivity(target.type) ||
      target.type === "bpmn.participant" ||
      (target.type === "bpmn.event" &&
        ["start", "intermediateCatch"].includes(
          String(semantic(target).position),
        )) ||
      target.type === "bpmn.boundaryEvent";
    if (!sourceAllowed || !targetAllowed)
      return reject(
        "bpmn.connection.invalidEndpoint",
        "Message flows connect activities, participants and message events.",
      );
    return {
      ok: true,
      type,
      corrected: requested !== undefined && requested !== defaultType,
    };
  }

  if (!isBpmnFlowNode(source.type) || !isBpmnFlowNode(target.type))
    return reject(
      "bpmn.connection.invalidEndpoint",
      "Sequence flows connect BPMN flow nodes.",
    );
  if (target.type === "bpmn.event" && semantic(target).position === "start")
    return reject(
      "bpmn.connection.startEventIncoming",
      "A start event cannot have an incoming sequence flow.",
    );
  if (target.type === "bpmn.boundaryEvent")
    return reject(
      "bpmn.connection.boundaryIncoming",
      "A boundary event cannot have an incoming sequence flow.",
    );
  if (source.type === "bpmn.event" && semantic(source).position === "end")
    return reject(
      "bpmn.connection.endEventOutgoing",
      "An end event cannot have an outgoing sequence flow.",
    );
  if (model.scopeOf(from) !== model.scopeOf(to)) {
    if (sourcePool !== targetPool)
      return reject(
        "bpmn.connection.crossPoolSequenceFlow",
        "A sequence flow cannot cross pool boundaries. Use a message flow.",
      );
    return reject(
      "bpmn.connection.crossScope",
      "A sequence flow cannot cross a subprocess boundary.",
    );
  }
  return {
    ok: true,
    type: "bpmn.sequenceFlow",
    corrected: requested !== undefined && requested !== defaultType,
  };
}
