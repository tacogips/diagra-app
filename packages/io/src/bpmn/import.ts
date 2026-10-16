import {
  SCHEMA_VERSION,
  assertValidDocument,
  connectorWaypointFromPage,
  MAX_CONNECTOR_WAYPOINTS,
  type Document,
  type Element,
  type Page,
} from "@nodetto/ir";
import {
  BPMN_MODEL_NAMESPACE,
  BpmnParseError,
  parseXml,
  serializeXml,
  type XmlElement,
} from "./xml.ts";

const DC = "http://www.omg.org/spec/DD/20100524/DC";
const attr = (element: XmlElement, name: string): string | undefined =>
  element.attributes.find(
    (item) =>
      item.local === name && item.ns !== "http://www.w3.org/2000/xmlns/",
  )?.value;
const childElements = (element: XmlElement, local?: string): XmlElement[] =>
  element.children.filter(
    (node): node is XmlElement =>
      !("kind" in node) && (!local || node.local === local),
  );
const firstChild = (
  element: XmlElement,
  local: string,
): XmlElement | undefined => childElements(element, local)[0];
const textContent = (element: XmlElement): string =>
  element.children
    .map((node) => ("kind" in node ? node.text : textContent(node)))
    .join("");
const finite = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const nameValue = (element: XmlElement): string | undefined =>
  attr(element, "name");

export interface BpmnImportOptions {
  readonly documentId?: string;
  readonly title?: string;
}
export interface BpmnImportWarning {
  readonly xmlId?: string;
  readonly element: string;
  readonly message: string;
}
export interface BpmnImportReport {
  readonly document: Document;
  readonly pageId: string;
  readonly warnings: readonly BpmnImportWarning[];
  readonly missingDi: readonly string[];
}

interface DiData {
  visual?: Element["visual"];
  waypoints?: Array<{ x: number; y: number }>;
  plane?: string;
  markerVisible?: boolean;
  expanded?: boolean;
  hidden?: boolean;
}
interface Draft {
  id: string;
  type: string;
  semantic: Record<string, unknown>;
  visual: Element["visual"];
  xml: XmlElement;
  parent?: string;
  extensions?: Element["extensions"];
}

const TASK_TYPES: Record<string, string> = {
  task: "none",
  userTask: "user",
  serviceTask: "service",
  manualTask: "manual",
  sendTask: "send",
  receiveTask: "receive",
  scriptTask: "script",
  businessRuleTask: "businessRule",
};
const EVENT_POSITIONS: Record<string, string> = {
  startEvent: "start",
  intermediateCatchEvent: "intermediateCatch",
  intermediateThrowEvent: "intermediateThrow",
  endEvent: "end",
};
const GATEWAYS: Record<string, string> = {
  exclusiveGateway: "exclusive",
  parallelGateway: "parallel",
  inclusiveGateway: "inclusive",
  eventBasedGateway: "eventBased",
  complexGateway: "complex",
};
const DEFINITIONS: Record<string, string> = {
  messageEventDefinition: "message",
  timerEventDefinition: "timer",
  errorEventDefinition: "error",
  escalationEventDefinition: "escalation",
  cancelEventDefinition: "cancel",
  compensateEventDefinition: "compensation",
  conditionalEventDefinition: "conditional",
  linkEventDefinition: "link",
  signalEventDefinition: "signal",
  terminateEventDefinition: "terminate",
};
const BPMN_TAGS = new Set([
  ...Object.keys(TASK_TYPES),
  ...Object.keys(EVENT_POSITIONS),
  ...Object.keys(GATEWAYS),
  "participant",
  "lane",
  "subProcess",
  "adHocSubProcess",
  "callActivity",
  "boundaryEvent",
  "sequenceFlow",
  "messageFlow",
  "association",
  "dataInputAssociation",
  "dataOutputAssociation",
  "dataObjectReference",
  "dataInput",
  "dataOutput",
  "dataStoreReference",
  "textAnnotation",
  "group",
]);

function rawXml(element: XmlElement): string {
  const bindings = new Map<string, string>();
  const pending = [element];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    if (current.prefix && current.ns) bindings.set(current.prefix, current.ns);
    else if (!current.prefix && current.ns) bindings.set("", current.ns);
    for (const attribute of current.attributes)
      if (attribute.prefix && attribute.prefix !== "xmlns" && attribute.ns)
        bindings.set(attribute.prefix, attribute.ns);
    for (const child of current.children)
      if (!("kind" in child)) pending.push(child);
  }
  const declared = new Set(
    element.attributes
      .filter((item) => item.name === "xmlns" || item.name.startsWith("xmlns:"))
      .map((item) => (item.name === "xmlns" ? "" : item.name.slice(6))),
  );
  const inherited = [...bindings]
    .filter(([prefix]) => !declared.has(prefix))
    .map(([prefix, uri]) => ({
      name: prefix ? `xmlns:${prefix}` : "xmlns",
      ...(prefix ? { prefix: "xmlns" } : {}),
      local: prefix || "xmlns",
      ns: "http://www.w3.org/2000/xmlns/",
      value: uri,
    }));
  const fragment: XmlElement = {
    ...element,
    attributes: [...element.attributes, ...inherited],
  };
  return serializeXml(fragment)
    .replace(/^<\?xml[^\n]*\n/, "")
    .trimEnd();
}

function eventDefinitions(xml: XmlElement): Array<Record<string, unknown>> {
  return childElements(xml)
    .filter((item) => DEFINITIONS[item.local])
    .map((item, index) => {
      const kind = DEFINITIONS[item.local] as string;
      const definition: Record<string, unknown> = {
        id:
          attr(item, "id") ??
          `${attr(xml, "id") ?? "event"}_definition_${index + 1}`,
        kind,
      };
      const ref =
        attr(item, "messageRef") ??
        attr(item, "signalRef") ??
        attr(item, "errorRef") ??
        attr(item, "escalationRef");
      if (ref) definition["ref"] = ref;
      if (kind === "link" && nameValue(item))
        definition["linkName"] = nameValue(item);
      if (kind === "timer") {
        const timerChild = childElements(item)[0];
        if (timerChild)
          definition["timer"] = {
            type:
              timerChild.local === "timeDate"
                ? "date"
                : timerChild.local === "timeCycle"
                  ? "cycle"
                  : "duration",
            value: textContent(timerChild),
          };
      }
      const condition = firstChild(item, "condition");
      if (condition) definition["condition"] = textContent(condition);
      return definition;
    });
}

function laneMembership(process: XmlElement): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (container: XmlElement): void => {
    for (const laneSet of [
      ...childElements(container, "laneSet"),
      ...childElements(container, "childLaneSet"),
    ])
      for (const lane of childElements(laneSet, "lane")) {
        const id = attr(lane, "id");
        if (!id) continue;
        for (const ref of childElements(lane, "flowNodeRef"))
          result.set(textContent(ref).trim(), id);
        visit(lane);
      }
  };
  visit(process);
  return result;
}

function collectDi(root: XmlElement): Map<string, DiData> {
  const result = new Map<string, DiData>();
  const diagrams = childElements(root).filter(
    (item) => item.local === "BPMNDiagram",
  );
  diagrams.forEach((diagram, diagramIndex) => {
    const plane = firstChild(diagram, "BPMNPlane");
    if (!plane) return;
    for (const shape of childElements(plane).filter(
      (item) => item.local === "BPMNShape",
    )) {
      const id = attr(shape, "bpmnElement");
      if (!id) continue;
      if (diagramIndex > 0) {
        result.set(id, { ...result.get(id), hidden: true });
        continue;
      }
      const bounds = childElements(shape).find(
        (item) => item.local === "Bounds" && item.ns === DC,
      );
      const labelBounds = childElements(shape)
        .map((item) => firstChild(item, "Bounds"))
        .find((item) => item?.ns === DC);
      const visual: Record<string, unknown> = {};
      if (bounds)
        Object.assign(visual, {
          x: finite(attr(bounds, "x"), 0),
          y: finite(attr(bounds, "y"), 0),
          width: finite(attr(bounds, "width"), 100),
          height: finite(attr(bounds, "height"), 60),
        });
      if (labelBounds)
        visual["labelBounds"] = {
          x: finite(attr(labelBounds, "x"), 0),
          y: finite(attr(labelBounds, "y"), 0),
          width: finite(attr(labelBounds, "width"), 90),
          height: finite(attr(labelBounds, "height"), 20),
        };
      const data: DiData = {
        ...(Object.keys(visual).length
          ? { visual: visual as Element["visual"] }
          : {}),
        ...(diagramIndex ? { plane: attr(plane, "bpmnElement") } : {}),
      };
      if (attr(shape, "isMarkerVisible") !== undefined)
        data.markerVisible = attr(shape, "isMarkerVisible") !== "false";
      if (attr(shape, "isExpanded") !== undefined)
        data.expanded = attr(shape, "isExpanded") !== "false";
      result.set(id, data);
    }
    for (const edge of childElements(plane).filter(
      (item) => item.local === "BPMNEdge",
    )) {
      const id = attr(edge, "bpmnElement");
      if (!id) continue;
      if (diagramIndex > 0) continue;
      const waypoints = childElements(edge, "waypoint").map((point) => ({
        x: finite(attr(point, "x"), 0),
        y: finite(attr(point, "y"), 0),
      }));
      const label = childElements(edge)
        .map((item) => firstChild(item, "Bounds"))
        .find((item) => item?.ns === DC);
      result.set(id, {
        waypoints,
        ...(label
          ? {
              visual: {
                labelBounds: {
                  x: finite(attr(label, "x"), 0),
                  y: finite(attr(label, "y"), 0),
                  width: finite(attr(label, "width"), 90),
                  height: finite(attr(label, "height"), 20),
                },
              },
            }
          : {}),
        ...(diagramIndex ? { plane: attr(plane, "bpmnElement") } : {}),
      });
    }
  });
  return result;
}

export function importBpmnXml(
  text: string,
  options: BpmnImportOptions = {},
): BpmnImportReport {
  const root = parseXml(text);
  if (root.local !== "definitions" || root.ns !== BPMN_MODEL_NAMESPACE)
    throw new BpmnParseError(
      "root must be BPMN definitions in the BPMN model namespace",
    );
  const warnings: BpmnImportWarning[] = [];
  const missingDi: string[] = [];
  const ids = new Set<string>();
  const drafts: Draft[] = [];
  const pages: Page[] = [];
  const processes = childElements(root, "process");
  const collaboration = childElements(root, "collaboration")[0];
  const participantsXml = collaboration
    ? childElements(collaboration, "participant")
    : [];
  const participantProcess = new Map<string, string>();
  const participantByProcess = new Map<string, string>();
  const di = collectDi(root);
  const pageId = "bpmn-page";
  const add = (
    xml: XmlElement,
    type: string,
    semantic: Record<string, unknown>,
    parent?: string,
    xmlOnly?: Record<string, unknown>,
  ): Draft => {
    const id = attr(xml, "id");
    if (!id) throw new BpmnParseError(`${xml.local} is missing id`);
    if (ids.has(id)) throw new BpmnParseError(`duplicate BPMN id ${id}`);
    ids.add(id);
    const diData = di.get(id);
    const visual = {
      ...diData?.visual,
      ...(diData?.hidden ? { hidden: true } : {}),
    };
    if (!diData) {
      missingDi.push(id);
      warnings.push({
        xmlId: id,
        element: xml.local,
        message:
          "Element has no BPMNDiagram information; a position was assigned.",
      });
    }
    if (parent && !("parent" in semantic)) semantic["parent"] = parent;
    const foreignAttributes = xml.attributes
      .filter(
        (item) =>
          item.ns &&
          item.ns !== BPMN_MODEL_NAMESPACE &&
          item.ns !== "http://www.w3.org/2000/xmlns/",
      )
      .map((item) => ({
        name: item.name,
        namespace: item.ns,
        value: item.value,
      }));
    const foreignChildren = childElements(xml)
      .filter(
        (item) =>
          item.ns !== BPMN_MODEL_NAMESPACE ||
          item.local === "extensionElements" ||
          item.local === "documentation",
      )
      .map(rawXml);
    for (const item of foreignAttributes)
      warnings.push({
        xmlId: id,
        element: xml.local,
        message: `Foreign XML attribute ${item.name} was preserved.`,
      });
    for (const item of childElements(xml).filter(
      (child) =>
        child.ns !== BPMN_MODEL_NAMESPACE ||
        child.local === "extensionElements" ||
        child.local === "documentation",
    ))
      warnings.push({
        xmlId: id,
        element: item.local,
        message: `Foreign or extended XML child ${item.local} was preserved.`,
      });
    const extensions =
      foreignAttributes.length || foreignChildren.length || xmlOnly
        ? {
            bpmnXml: {
              ...xmlOnly,
              ...(foreignAttributes.length
                ? { attributes: foreignAttributes }
                : {}),
              ...(foreignChildren.length ? { children: foreignChildren } : {}),
            },
          }
        : undefined;
    const draft: Draft = {
      id,
      type,
      semantic,
      visual,
      xml,
      ...(parent ? { parent } : {}),
      ...(extensions ? { extensions } : {}),
    };
    drafts.push(draft);
    return draft;
  };
  for (const xml of participantsXml) {
    const processRef = attr(xml, "processRef");
    if (processRef) {
      participantProcess.set(attr(xml, "id") ?? "", processRef);
      participantByProcess.set(processRef, attr(xml, "id") ?? "");
    }
    const collapsed =
      !processRef || di.get(attr(xml, "id") ?? "")?.visual === undefined;
    add(xml, "bpmn.participant", {
      ...(nameValue(xml) ? { name: nameValue(xml) } : {}),
      collapsed: attr(xml, "isExpanded") === "false" || collapsed,
      ...(processRef ? { processRef } : {}),
    });
    if (attr(xml, "isHorizontal") === "false")
      warnings.push({
        xmlId: attr(xml, "id"),
        element: "participant",
        message: "Vertical pools are rendered horizontally.",
      });
  }
  const processName = processes[0] ? nameValue(processes[0]) : undefined;
  const pageName =
    nameValue(participantsXml[0] ?? (processes[0] as XmlElement)) ??
    options.title ??
    processName ??
    "BPMN";
  const pageExtensions: Record<string, unknown> = {
    bpmnXml: {
      ...(attr(root, "id") ? { definitionsId: attr(root, "id") } : {}),
      ...(attr(root, "targetNamespace")
        ? { targetNamespace: attr(root, "targetNamespace") }
        : {}),
      ...(collaboration && attr(collaboration, "id")
        ? { collaborationId: attr(collaboration, "id") }
        : {}),
      ...(processes[0] && attr(processes[0], "id")
        ? { processId: attr(processes[0], "id") }
        : {}),
      namespaces: Object.fromEntries(
        root.attributes
          .filter(
            (item) => item.name === "xmlns" || item.name.startsWith("xmlns:"),
          )
          .map((item): [string, string] => [
            item.name === "xmlns" ? "" : item.name.slice(6),
            item.value,
          ])
          .filter(
            ([prefix]) =>
              !["bpmn", "bpmndi", "dc", "di", "xsi"].includes(prefix),
          ),
      ),
    },
  };
  const page: Page = {
    id: pageId,
    name: pageName,
    kind: "bpmn",
    extensions: pageExtensions,
  };
  pages.push(page);
  const laneByProcess = new Map<string, Map<string, string>>();
  for (const process of processes)
    laneByProcess.set(attr(process, "id") ?? "", laneMembership(process));
  for (const [processId, lanes] of laneByProcess) {
    const process = processes.find((item) => attr(item, "id") === processId);
    if (!process) continue;
    const participant = participantByProcess.get(processId);
    const visitLanes = (
      container: XmlElement,
      parent: string | undefined,
    ): void => {
      for (const laneSet of [
        ...childElements(container, "laneSet"),
        ...childElements(container, "childLaneSet"),
      ])
        for (const lane of childElements(laneSet, "lane")) {
          const id = attr(lane, "id");
          if (!id) continue;
          add(lane, "bpmn.lane", {
            ...(nameValue(lane) ? { name: nameValue(lane) } : {}),
            ...((parent ?? participant)
              ? { parent: parent ?? participant }
              : {}),
          });
          visitLanes(lane, id);
        }
    };
    visitLanes(process, participant);
    const dataObjects = new Map<string, XmlElement>();
    const indexDataObjects = (container: XmlElement): void => {
      for (const child of childElements(container)) {
        if (child.local === "dataObject") {
          const dataObjectId = attr(child, "id");
          if (dataObjectId) dataObjects.set(dataObjectId, child);
        }
        indexDataObjects(child);
      }
    };
    indexDataObjects(process);
    const consumedDataObjects = new Set<string>();
    const indexDataObjectReferences = (container: XmlElement): void => {
      for (const child of childElements(container)) {
        if (child.local === "dataObjectReference") {
          const reference = attr(child, "dataObjectRef");
          if (reference && dataObjects.has(reference))
            consumedDataObjects.add(reference);
        }
        indexDataObjectReferences(child);
      }
    };
    indexDataObjectReferences(process);
    const walk = (container: XmlElement, enclosing?: string): void => {
      for (const child of childElements(container)) {
        const id = attr(child, "id");
        if (!id) continue;
        if (
          [
            "sequenceFlow",
            "messageFlow",
            "association",
            "dataInputAssociation",
            "dataOutputAssociation",
          ].includes(child.local)
        )
          continue;
        const laneParent = lanes.get(id);
        const parent = laneParent ?? enclosing ?? participant;
        const local = child.local;
        if (
          BPMN_TAGS.has(local) &&
          local !== "participant" &&
          local !== "lane" &&
          local !== "sequenceFlow" &&
          local !== "messageFlow" &&
          local !== "association" &&
          local !== "dataInputAssociation" &&
          local !== "dataOutputAssociation"
        ) {
          if (TASK_TYPES[local]) {
            const loop = childElements(child).find(
              (item) =>
                item.local === "standardLoopCharacteristics" ||
                item.local === "multiInstanceLoopCharacteristics",
            );
            const loopType = !loop
              ? "none"
              : loop.local === "standardLoopCharacteristics"
                ? "standard"
                : attr(loop, "isSequential") === "true"
                  ? "sequentialMultiInstance"
                  : "parallelMultiInstance";
            add(child, "bpmn.task", {
              ...(nameValue(child) ? { name: nameValue(child) } : {}),
              taskType: TASK_TYPES[local],
              loop: loopType,
              ...(attr(child, "isForCompensation") === "true"
                ? { forCompensation: true }
                : {}),
              ...(parent ? { parent } : {}),
            });
            for (const ioSpecification of childElements(
              child,
              "ioSpecification",
            ))
              for (const ioElement of childElements(ioSpecification)) {
                if (
                  ioElement.local !== "dataInput" &&
                  ioElement.local !== "dataOutput"
                )
                  continue;
                add(
                  ioElement,
                  "bpmn.dataObject",
                  {
                    ...(nameValue(ioElement)
                      ? { name: nameValue(ioElement) }
                      : {}),
                    role: ioElement.local === "dataInput" ? "input" : "output",
                    collection: attr(ioElement, "isCollection") === "true",
                    parent: id,
                  },
                  id,
                );
              }
          } else if (local === "subProcess" || local === "adHocSubProcess") {
            add(child, "bpmn.subProcess", {
              ...(nameValue(child) ? { name: nameValue(child) } : {}),
              expanded:
                di.get(id)?.expanded ?? attr(child, "isExpanded") !== "false",
              triggeredByEvent: attr(child, "triggeredByEvent") === "true",
              adHoc: local === "adHocSubProcess",
              loop: "none",
              ...(parent ? { parent } : {}),
            });
            walk(child, id);
          } else if (local === "callActivity")
            add(child, "bpmn.callActivity", {
              ...(nameValue(child) ? { name: nameValue(child) } : {}),
              calledElement: attr(child, "calledElement"),
              loop: "none",
              ...(parent ? { parent } : {}),
            });
          else if (EVENT_POSITIONS[local])
            add(child, "bpmn.event", {
              ...(nameValue(child) ? { name: nameValue(child) } : {}),
              position: EVENT_POSITIONS[local],
              definitions: eventDefinitions(child),
              ...(attr(child, "isInterrupting") !== undefined
                ? { interrupting: attr(child, "isInterrupting") !== "false" }
                : {}),
              ...(parent ? { parent } : {}),
            });
          else if (local === "boundaryEvent")
            add(child, "bpmn.boundaryEvent", {
              ...(nameValue(child) ? { name: nameValue(child) } : {}),
              attachedTo: attr(child, "attachedToRef") ?? "",
              cancelActivity: attr(child, "cancelActivity") !== "false",
              definitions: eventDefinitions(child),
              ...(parent ? { parent } : {}),
            });
          else if (GATEWAYS[local])
            add(child, "bpmn.gateway", {
              ...(nameValue(child) ? { name: nameValue(child) } : {}),
              gatewayType: GATEWAYS[local],
              ...(attr(child, "gatewayDirection")
                ? { gatewayDirection: attr(child, "gatewayDirection") }
                : {}),
              ...(di.get(id)?.markerVisible !== undefined
                ? { markerVisible: di.get(id)?.markerVisible }
                : {}),
              ...(parent ? { parent } : {}),
            });
          else if (
            local === "dataObjectReference" ||
            local === "dataInput" ||
            local === "dataOutput"
          ) {
            const dataObjectId = attr(child, "dataObjectRef");
            const referencedDataObject = dataObjectId
              ? dataObjects.get(dataObjectId)
              : undefined;
            add(
              child,
              "bpmn.dataObject",
              {
                ...(nameValue(child) ? { name: nameValue(child) } : {}),
                role:
                  local === "dataInput"
                    ? "input"
                    : local === "dataOutput"
                      ? "output"
                      : "reference",
                collection:
                  attr(child, "isCollection") === "true" ||
                  attr(referencedDataObject ?? child, "isCollection") ===
                    "true",
                ...(parent ? { parent } : {}),
              },
              undefined,
              dataObjectId ? { dataObjectId } : undefined,
            );
          } else if (local === "dataStoreReference")
            add(child, "bpmn.dataStore", {
              ...(nameValue(child) ? { name: nameValue(child) } : {}),
              ...(parent ? { parent } : {}),
            });
          else if (local === "textAnnotation")
            add(child, "bpmn.textAnnotation", {
              text: textContent(firstChild(child, "text") ?? child),
              ...(parent ? { parent } : {}),
            });
          else if (local === "group") {
            const categoryValue = firstChild(child, "categoryValue");
            const categoryName = categoryValue
              ? (nameValue(categoryValue) ?? attr(categoryValue, "value"))
              : undefined;
            add(child, "bpmn.group", {
              ...(categoryName ? { name: categoryName } : {}),
              ...(parent ? { parent } : {}),
            });
          }
        } else if (
          local !== "laneSet" &&
          local !== "documentation" &&
          local !== "extensionElements" &&
          !local.endsWith("LoopCharacteristics") &&
          !local.endsWith("EventDefinition") &&
          local !== "ioSpecification" &&
          local !== "incoming" &&
          local !== "outgoing"
        ) {
          if (
            child.ns === BPMN_MODEL_NAMESPACE &&
            local !== "laneSet" &&
            !(local === "dataObject" && consumedDataObjects.has(id))
          ) {
            const xmlText = rawXml(child);
            const unsupported =
              ((pageExtensions["bpmnXml"] as Record<string, unknown>)[
                "unsupported"
              ] as string[] | undefined) ?? [];
            unsupported.push(xmlText);
            (pageExtensions["bpmnXml"] as Record<string, unknown>)[
              "unsupported"
            ] = unsupported;
            warnings.push({
              xmlId: id,
              element: local,
              message: `Unsupported BPMN element ${local} was preserved as raw XML.`,
            });
          }
        }
      }
    };
    walk(process);
    // Flows are appended after their endpoints in source document order.
    const flowTags = new Set([
      "sequenceFlow",
      "association",
      "dataInputAssociation",
      "dataOutputAssociation",
    ]);
    const defaultFlowIds = new Set<string>();
    const collectDefaults = (container: XmlElement): void => {
      for (const child of childElements(container)) {
        const defaultId = attr(child, "default");
        if (defaultId) defaultFlowIds.add(defaultId);
        collectDefaults(child);
      }
    };
    collectDefaults(process);
    const addFlows = (container: XmlElement, enclosing?: string): void => {
      for (const child of childElements(container)) {
        if (flowTags.has(child.local)) {
          const sourceNode = firstChild(child, "sourceRef");
          const targetNode = firstChild(child, "targetRef");
          const source =
            attr(child, "sourceRef") ??
            (sourceNode
              ? textContent(sourceNode).trim()
              : child.local === "dataOutputAssociation"
                ? (enclosing ?? "")
                : "");
          const target =
            attr(child, "targetRef") ??
            (targetNode
              ? textContent(targetNode).trim()
              : child.local === "dataInputAssociation"
                ? (enclosing ?? "")
                : "");
          const semantic: Record<string, unknown> = {
            from: source,
            to: target,
          };
          if (nameValue(child)) semantic["name"] = nameValue(child);
          const condition = firstChild(child, "conditionExpression");
          if (condition) semantic["condition"] = textContent(condition);
          if (child.local === "sequenceFlow") {
            semantic["isDefault"] = defaultFlowIds.has(attr(child, "id") ?? "");
            add(child, "bpmn.sequenceFlow", semantic);
          } else if (child.local === "association")
            add(child, "bpmn.association", {
              ...semantic,
              direction:
                attr(child, "associationDirection") === "One"
                  ? "one"
                  : attr(child, "associationDirection") === "Both"
                    ? "both"
                    : "none",
            });
          else add(child, "bpmn.dataAssociation", semantic);
        }
        const childId = attr(child, "id");
        if (childElements(child).length) addFlows(child, childId ?? enclosing);
      }
    };
    addFlows(process);
  }
  if (collaboration) {
    for (const flow of childElements(collaboration, "messageFlow"))
      add(flow, "bpmn.messageFlow", {
        from: attr(flow, "sourceRef") ?? "",
        to: attr(flow, "targetRef") ?? "",
        ...(nameValue(flow) ? { name: nameValue(flow) } : {}),
        ...(attr(flow, "messageRef")
          ? { messageRef: attr(flow, "messageRef") }
          : {}),
      });
  }
  const usedMissing = new Set(missingDi);
  let nextIndex = 0;
  for (const draft of drafts) {
    const data = di.get(draft.id);
    if (data?.waypoints) {
      const from = drafts.find(
        (item) => item.id === draft.semantic["from"],
      )?.visual;
      const to = drafts.find(
        (item) => item.id === draft.semantic["to"],
      )?.visual;
      if (data.waypoints.length > 2 && from && to) {
        const start = {
          x: (from.x ?? 0) + (from.width ?? 100) / 2,
          y: (from.y ?? 0) + (from.height ?? 60) / 2,
        };
        const end = {
          x: (to.x ?? 0) + (to.width ?? 100) / 2,
          y: (to.y ?? 0) + (to.height ?? 60) / 2,
        };
        const points = data.waypoints.slice(1, -1);
        if (points.length > MAX_CONNECTOR_WAYPOINTS)
          warnings.push({
            xmlId: draft.id,
            element: draft.xml.local,
            message: `Only the first ${MAX_CONNECTOR_WAYPOINTS} interior waypoints were kept.`,
          });
        draft.semantic["routing"] = "manual";
        draft.semantic["routingWaypoints"] = points
          .slice(0, MAX_CONNECTOR_WAYPOINTS)
          .map((point) => connectorWaypointFromPage(point, start, end));
      } else draft.semantic["routing"] = "straight";
    }
  }
  // Missing shapes receive stable positions below any imported geometry.
  const positioned = drafts.filter((item) => item.visual.x !== undefined);
  const baseY =
    positioned.reduce(
      (max, item) =>
        Math.max(max, (item.visual.y ?? 0) + (item.visual.height ?? 60)),
      0,
    ) + 40;
  for (const draft of drafts)
    if (
      usedMissing.has(draft.id) &&
      !draft.type.endsWith("Flow") &&
      !draft.type.endsWith("Association")
    ) {
      nextIndex += 1;
      draft.visual = {
        ...draft.visual,
        x: (nextIndex - 1) * 120,
        y: baseY,
        width: draft.visual.width ?? 100,
        height: draft.visual.height ?? 60,
      };
    }
  const elements: Element[] = drafts.map((draft, index) => ({
    id: draft.id,
    page: pageId,
    type: draft.type,
    index: `a${String(index + 1).padStart(6, "0")}`,
    semantic: draft.semantic,
    visual: draft.visual,
    ...(draft.extensions ? { extensions: draft.extensions } : {}),
  }));
  const preservedRoot = childElements(root).filter(
    (item) => !["process", "collaboration", "BPMNDiagram"].includes(item.local),
  );
  const rootElements = preservedRoot.map(rawXml);
  for (const item of preservedRoot)
    warnings.push({
      xmlId: attr(item, "id"),
      element: item.local,
      message: `Root-level BPMN or foreign element ${item.local} was preserved as raw XML.`,
    });
  if (rootElements.length)
    (pageExtensions["bpmnXml"] as Record<string, unknown>)["rootElements"] =
      rootElements;
  const document: Document = {
    schemaVersion: SCHEMA_VERSION,
    id: options.documentId ?? "bpmn-document",
    title: pageName,
    pages,
    elements,
  };
  assertValidDocument(document);
  return { document, pageId, warnings, missingDi };
}
