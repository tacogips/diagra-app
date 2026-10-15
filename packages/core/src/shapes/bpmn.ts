import { boxContains, diamondContains, ellipseContains } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";
import { createConnectorUtil, readDirectEndpoints } from "./connector.ts";
import { nodeBounds } from "./node.ts";

const SIZES: Readonly<Record<string, readonly [number, number]>> = {
  "bpmn.participant": [600, 250],
  "bpmn.lane": [570, 120],
  "bpmn.task": [100, 80],
  "bpmn.subProcess": [100, 80],
  "bpmn.callActivity": [100, 80],
  "bpmn.event": [36, 36],
  "bpmn.boundaryEvent": [36, 36],
  "bpmn.gateway": [50, 50],
  "bpmn.dataObject": [36, 50],
  "bpmn.dataStore": [50, 50],
  "bpmn.textAnnotation": [100, 30],
  "bpmn.group": [200, 150],
};

const SEMANTICS: Readonly<Record<string, () => unknown>> = {
  "bpmn.participant": () => ({ name: "Pool", collapsed: false }),
  "bpmn.lane": () => ({ name: "Lane", parent: "" }),
  "bpmn.task": () => ({ name: "Task", taskType: "none", loop: "none" }),
  "bpmn.subProcess": () => ({
    name: "Sub-process",
    expanded: false,
    triggeredByEvent: false,
    adHoc: false,
    loop: "none",
  }),
  "bpmn.callActivity": () => ({ name: "Call activity", loop: "none" }),
  "bpmn.event": () => ({ name: "", position: "start", definitions: [] }),
  "bpmn.boundaryEvent": () => ({
    name: "",
    attachedTo: "",
    cancelActivity: true,
    definitions: [],
  }),
  "bpmn.gateway": () => ({ name: "", gatewayType: "exclusive" }),
  "bpmn.dataObject": () => ({
    name: "Data object",
    role: "reference",
    collection: false,
  }),
  "bpmn.dataStore": () => ({ name: "Data store" }),
  "bpmn.textAnnotation": () => ({ text: "" }),
  "bpmn.group": () => ({ name: "" }),
};

function bpmnShape(type: string): ShapeUtil {
  const size = SIZES[type] ?? [100, 80];
  return {
    type,
    canResize: [
      "bpmn.task",
      "bpmn.subProcess",
      "bpmn.callActivity",
      "bpmn.participant",
      "bpmn.lane",
      "bpmn.dataStore",
      "bpmn.textAnnotation",
      "bpmn.group",
    ].includes(type),
    getBounds: (element) => nodeBounds(element.visual),
    hitTest(element, point) {
      const box = nodeBounds(element.visual);
      if (type === "bpmn.event" || type === "bpmn.boundaryEvent")
        return ellipseContains(box, point);
      if (type === "bpmn.gateway") return diamondContains(box, point);
      return boxContains(box, point);
    },
    resize(_element, box) {
      return {
        visual: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    },
    defaultSemantic: SEMANTICS[type] ?? (() => ({})),
    defaultVisual: () => ({ x: 0, y: 0, width: size[0], height: size[1] }),
  };
}

export const bpmnNodeShapeUtils: readonly ShapeUtil[] =
  Object.keys(SIZES).map(bpmnShape);
export const bpmnSequenceFlowShapeUtil = createConnectorUtil({
  type: "bpmn.sequenceFlow",
  readEndpoints: readDirectEndpoints,
  defaultSemantic: () => ({ from: "", to: "" }),
});
export const bpmnMessageFlowShapeUtil = createConnectorUtil({
  type: "bpmn.messageFlow",
  readEndpoints: readDirectEndpoints,
  defaultSemantic: () => ({ from: "", to: "" }),
});
export const bpmnAssociationShapeUtil = createConnectorUtil({
  type: "bpmn.association",
  readEndpoints: readDirectEndpoints,
  defaultSemantic: () => ({ from: "", to: "", direction: "none" }),
});
export const bpmnDataAssociationShapeUtil = createConnectorUtil({
  type: "bpmn.dataAssociation",
  readEndpoints: readDirectEndpoints,
  defaultSemantic: () => ({ from: "", to: "" }),
});
