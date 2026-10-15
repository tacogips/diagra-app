import type { Element } from "@nodetto/ir";

const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;
const PREFIX: Readonly<Record<string, string>> = {
  "bpmn.task": "Activity_",
  "bpmn.subProcess": "Activity_",
  "bpmn.callActivity": "Activity_",
  "bpmn.event": "Event_",
  "bpmn.boundaryEvent": "Event_",
  "bpmn.gateway": "Gateway_",
  "bpmn.sequenceFlow": "Flow_",
  "bpmn.messageFlow": "Flow_",
  "bpmn.participant": "Participant_",
  "bpmn.lane": "Lane_",
  "bpmn.dataObject": "DataObjectReference_",
  "bpmn.dataStore": "DataStoreReference_",
  "bpmn.textAnnotation": "TextAnnotation_",
  "bpmn.group": "Group_",
  "bpmn.association": "Association_",
  "bpmn.dataAssociation": "DataAssociation_",
};

export function bpmnExportId(
  element: Element | { id: string; type: string },
): string {
  if (NCNAME.test(element.id)) return element.id;
  const prefix = PREFIX[element.type] ?? "Element_";
  const clean = element.id.replace(/[^A-Za-z0-9._-]/g, "_");
  const result = `${prefix}${clean}`;
  return NCNAME.test(result)
    ? result
    : `Element_${clean.replace(/^[^A-Za-z_]+/, "")}`;
}
