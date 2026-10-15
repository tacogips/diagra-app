import {
  connectorWaypointToPage,
  type Document,
  type Element,
} from "@nodetto/ir";
import {
  parseXml,
  serializeXml,
  type XmlAttribute,
  type XmlElement,
  type XmlNode,
} from "./xml.ts";
import { bpmnExportId } from "./ids.ts";

const MODEL = "http://www.omg.org/spec/BPMN/20100524/MODEL";
const BPMNDI = "http://www.omg.org/spec/BPMN/20100524/DI";
const DC = "http://www.omg.org/spec/DD/20100524/DC";
const DI = "http://www.omg.org/spec/DD/20100524/DI";
const XSI = "http://www.w3.org/2001/XMLSchema-instance";
type Point = { x: number; y: number };
export interface BpmnExportOptions {
  readonly routeOf?: (edge: Element) => readonly Point[] | undefined;
}
export interface BpmnExportWarning {
  readonly elementId?: string;
  readonly message: string;
}
export interface BpmnExportReport {
  readonly xml: string;
  readonly warnings: readonly BpmnExportWarning[];
}
const semantic = (element: Element): Record<string, unknown> =>
  element.semantic as Record<string, unknown>;
function element(
  name: string,
  attributes: Record<string, string | undefined> = {},
  nodes: XmlNode[] = [],
): XmlElement {
  const attrs: XmlAttribute[] = Object.entries(attributes)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => ({
      name: key,
      local: key.includes(":") ? (key.split(":").at(-1) as string) : key,
      ...(key.includes(":") ? { prefix: key.split(":")[0] } : {}),
      value,
    }));
  return {
    name,
    ...(name.includes(":")
      ? {
          prefix: name.split(":")[0],
          local: name.split(":").at(-1) as string,
          ns: name.startsWith("bpmn:")
            ? MODEL
            : name.startsWith("bpmndi:")
              ? BPMNDI
              : name.startsWith("dc:")
                ? DC
                : name.startsWith("di:")
                  ? DI
                  : undefined,
        }
      : { local: name }),
    attributes: attrs,
    children: nodes,
  };
}
function text(value: string): XmlNode {
  return { kind: "text", text: value };
}
function num(value: number | undefined, fallback: number): string {
  const number = value ?? fallback;
  return String(Math.round(number * 100) / 100);
}
function nodeTag(elementRecord: Element): string {
  const s = semantic(elementRecord);
  switch (elementRecord.type) {
    case "bpmn.task":
      return (
        (
          {
            none: "task",
            user: "userTask",
            service: "serviceTask",
            manual: "manualTask",
            send: "sendTask",
            receive: "receiveTask",
            script: "scriptTask",
            businessRule: "businessRuleTask",
          } as Record<string, string>
        )[String(s["taskType"])] ?? "task"
      );
    case "bpmn.subProcess":
      return s["adHoc"] ? "adHocSubProcess" : "subProcess";
    case "bpmn.callActivity":
      return "callActivity";
    case "bpmn.event":
      return (
        (
          {
            start: "startEvent",
            intermediateCatch: "intermediateCatchEvent",
            intermediateThrow: "intermediateThrowEvent",
            end: "endEvent",
          } as Record<string, string>
        )[String(s["position"])] ?? "startEvent"
      );
    case "bpmn.boundaryEvent":
      return "boundaryEvent";
    case "bpmn.gateway":
      return `${String(s["gatewayType"])}Gateway`;
    case "bpmn.dataObject":
      return s["role"] === "input"
        ? "dataInput"
        : s["role"] === "output"
          ? "dataOutput"
          : "dataObjectReference";
    case "bpmn.dataStore":
      return "dataStoreReference";
    case "bpmn.textAnnotation":
      return "textAnnotation";
    case "bpmn.group":
      return "group";
    default:
      return "task";
  }
}
function xmlOnly(page: {
  extensions?: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const extension = page.extensions?.["bpmnXml"];
  return extension && typeof extension === "object"
    ? (extension as Record<string, unknown>)
    : {};
}
function border(
  box: { x: number; y: number; width: number; height: number },
  toward: Point,
): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const scale = Math.min(
    dx ? box.width / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY,
    dy ? box.height / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function exportBpmnXml(
  document: Document,
  pageId: string,
  options: BpmnExportOptions = {},
): BpmnExportReport {
  const page = document.pages.find((item) => item.id === pageId);
  if (!page || page.kind !== "bpmn")
    throw new Error(`BPMN page not found: ${pageId}`);
  const warnings: BpmnExportWarning[] = [];
  const records = document.elements
    .filter((item) => item.page === pageId && item.type.startsWith("bpmn."))
    .slice()
    .sort((a, b) => a.index.localeCompare(b.index) || a.id.localeCompare(b.id));
  const byId = new Map(records.map((item) => [item.id, item]));
  const idOf = (id: string): string => {
    const found = byId.get(id);
    return found
      ? bpmnExportId(found)
      : bpmnExportId({ id, type: "bpmn.task" });
  };
  const extension = xmlOnly(page);
  const attrNamespace = (prefix: string, uri: string): XmlAttribute => ({
    name: `xmlns:${prefix}`,
    prefix: "xmlns",
    local: prefix,
    ns: "http://www.w3.org/2000/xmlns/",
    value: uri,
  });
  const namespaces: XmlAttribute[] = [
    attrNamespace("bpmn", MODEL),
    attrNamespace("bpmndi", BPMNDI),
    attrNamespace("dc", DC),
    attrNamespace("di", DI),
    attrNamespace("xsi", XSI),
  ];
  const foreign = extension["namespaces"];
  if (foreign && typeof foreign === "object")
    for (const [prefix, uri] of Object.entries(
      foreign as Record<string, unknown>,
    ).sort(([a], [b]) => a.localeCompare(b)))
      if (
        typeof uri === "string" &&
        prefix &&
        !["bpmn", "bpmndi", "dc", "di", "xsi"].includes(prefix)
      )
        namespaces.push(attrNamespace(prefix, uri));
  const participants = records.filter(
    (item) => item.type === "bpmn.participant",
  );
  const lanes = records.filter((item) => item.type === "bpmn.lane");
  const flows = records.filter((item) =>
    [
      "bpmn.sequenceFlow",
      "bpmn.messageFlow",
      "bpmn.association",
      "bpmn.dataAssociation",
    ].includes(item.type),
  );
  const flowNodes = records.filter((item) =>
    [
      "bpmn.task",
      "bpmn.subProcess",
      "bpmn.callActivity",
      "bpmn.event",
      "bpmn.boundaryEvent",
      "bpmn.gateway",
    ].includes(item.type),
  );
  const data = records.filter(
    (item) => item.type === "bpmn.dataObject" || item.type === "bpmn.dataStore",
  );
  const artifacts = records.filter(
    (item) => item.type === "bpmn.textAnnotation" || item.type === "bpmn.group",
  );
  const hasParticipants = participants.length > 0;
  const processFor = new Map<string, Element[]>();
  for (const participant of participants) {
    if (semantic(participant)["collapsed"] === true) continue;
    processFor.set(
      participant.id,
      records.filter(
        (item) =>
          item.id !== participant.id &&
          semantic(item)["parent"] === participant.id &&
          !item.type.includes("Flow") &&
          item.type !== "bpmn.association" &&
          item.type !== "bpmn.dataAssociation",
      ),
    );
  }
  const parentOf = (item: Element): string | undefined =>
    typeof semantic(item)["parent"] === "string"
      ? (semantic(item)["parent"] as string)
      : undefined;
  const ancestor = (item: Element, type: string): Element | undefined => {
    let parent = parentOf(item);
    while (parent) {
      const record = byId.get(parent);
      if (!record) return undefined;
      if (record.type === type) return record;
      parent = parentOf(record);
    }
    return undefined;
  };
  const ownerParticipant = (item: Element): string | undefined =>
    ancestor(item, "bpmn.participant")?.id;
  const subprocessScope = (item: Element): string | undefined =>
    ancestor(item, "bpmn.subProcess")?.id;
  const belongsToProcess = (item: Element, participantId: string): boolean => {
    if (participantId === "orphan") return ownerParticipant(item) === undefined;
    if (!hasParticipants) return ownerParticipant(item) === undefined;
    return ownerParticipant(item) === participantId;
  };
  const processNodes = new Map<string, Element[]>();
  if (!hasParticipants)
    processNodes.set(
      "",
      records.filter((item) => {
        if (!flowNodes.includes(item)) return false;
        const parent = parentOf(item);
        return (
          (!parent || byId.get(parent)?.type === "bpmn.lane") &&
          subprocessScope(item) === undefined
        );
      }),
    );
  else {
    for (const participant of participants)
      processNodes.set(
        participant.id,
        records.filter((item) => {
          if (!flowNodes.includes(item)) return false;
          return (
            ownerParticipant(item) === participant.id &&
            subprocessScope(item) === undefined
          );
        }),
      );
    const orphan = flowNodes.filter(
      (item) =>
        ownerParticipant(item) === undefined &&
        subprocessScope(item) === undefined,
    );
    const orphanContent = [...data, ...artifacts].some(
      (item) => ownerParticipant(item) === undefined && !parentOf(item),
    );
    if (orphan.length || orphanContent) {
      processNodes.set("orphan", orphan);
      warnings.push({
        message:
          "Pool-less elements were exported in an extra unreferenced process.",
      });
    }
    for (const participant of participants) {
      if (semantic(participant)["collapsed"] !== true) continue;
      const hiddenContent = records.filter(
        (item) =>
          item.id !== participant.id &&
          ownerParticipant(item) === participant.id,
      );
      if (hiddenContent.length)
        warnings.push({
          elementId: participant.id,
          message: "Content owned by a collapsed participant was not exported.",
        });
    }
  }
  const processId = (participantId: string): string => {
    if (participantId === "orphan") return `Process_orphan_${pageId}`;
    const participant = byId.get(participantId);
    const original = participant
      ? semantic(participant)["processRef"]
      : extension["processId"];
    if (typeof original === "string" && original.length > 0) return original;
    return `Process_${participantId || pageId}`;
  };
  const participantsXml = participants.map((item) => {
    const s = semantic(item);
    const id = bpmnExportId(item);
    const processRef = s["collapsed"] === true ? undefined : processId(item.id);
    return element("bpmn:participant", {
      id,
      name: typeof s["name"] === "string" ? s["name"] : undefined,
      processRef,
    });
  });
  const collaborationId =
    typeof extension["collaborationId"] === "string"
      ? extension["collaborationId"]
      : `Collaboration_${pageId}`;
  const collaborationXml = participants.length
    ? [
        element(
          "bpmn:collaboration",
          { id: collaborationId },
          participantsXml.concat(
            flows
              .filter((item) => item.type === "bpmn.messageFlow")
              .map((item) =>
                element("bpmn:messageFlow", {
                  id: bpmnExportId(item),
                  name:
                    typeof semantic(item)["name"] === "string"
                      ? (semantic(item)["name"] as string)
                      : undefined,
                  sourceRef: idOf(String(semantic(item)["from"])),
                  targetRef: idOf(String(semantic(item)["to"])),
                  messageRef: semantic(item)["messageRef"] as
                    | string
                    | undefined,
                }),
              ),
          ),
        ),
      ]
    : [];
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const flow of flows.filter(
    (item) => item.type === "bpmn.sequenceFlow",
  )) {
    const s = semantic(flow);
    const from = String(s["from"]);
    const to = String(s["to"]);
    outgoing.set(from, [...(outgoing.get(from) ?? []), bpmnExportId(flow)]);
    incoming.set(to, [...(incoming.get(to) ?? []), bpmnExportId(flow)]);
  }
  const definitionXml = (node: Element): XmlNode[] => {
    const s = semantic(node);
    const definitions = s["definitions"];
    if (!Array.isArray(definitions)) return [];
    return definitions.map((value) => {
      if (!value || typeof value !== "object")
        return element("bpmn:messageEventDefinition");
      const def = value as Record<string, unknown>;
      const kind = String(def["kind"]);
      const tag =
        (
          {
            message: "messageEventDefinition",
            timer: "timerEventDefinition",
            error: "errorEventDefinition",
            escalation: "escalationEventDefinition",
            cancel: "cancelEventDefinition",
            compensation: "compensateEventDefinition",
            conditional: "conditionalEventDefinition",
            link: "linkEventDefinition",
            signal: "signalEventDefinition",
            terminate: "terminateEventDefinition",
          } as Record<string, string>
        )[kind] ?? "messageEventDefinition";
      const attrs: Record<string, string | undefined> = {
        id: typeof def["id"] === "string" ? String(def["id"]) : undefined,
        messageRef:
          kind === "message" ? (def["ref"] as string | undefined) : undefined,
        signalRef:
          kind === "signal" ? (def["ref"] as string | undefined) : undefined,
        errorRef:
          kind === "error" ? (def["ref"] as string | undefined) : undefined,
        escalationRef:
          kind === "escalation"
            ? (def["ref"] as string | undefined)
            : undefined,
        name:
          kind === "link" ? (def["linkName"] as string | undefined) : undefined,
      };
      let content: XmlNode[] = [];
      if (
        kind === "timer" &&
        def["timer"] &&
        typeof def["timer"] === "object"
      ) {
        const timer = def["timer"] as Record<string, unknown>;
        const childTag =
          timer["type"] === "date"
            ? "timeDate"
            : timer["type"] === "cycle"
              ? "timeCycle"
              : "timeDuration";
        content = [
          element(
            `bpmn:${childTag}`,
            { "xsi:type": "bpmn:tFormalExpression" },
            [text(String(timer["value"] ?? ""))],
          ),
        ];
      }
      if (kind === "conditional" && typeof def["condition"] === "string")
        content = [
          element("bpmn:condition", {}, [text(def["condition"] as string)]),
        ];
      return element(`bpmn:${tag}`, attrs, content);
    });
  };
  const sequenceFlowXml = (item: Element): XmlElement =>
    element(
      "bpmn:sequenceFlow",
      {
        id: bpmnExportId(item),
        name: semantic(item)["name"] as string | undefined,
        sourceRef: idOf(String(semantic(item)["from"])),
        targetRef: idOf(String(semantic(item)["to"])),
      },
      typeof semantic(item)["condition"] === "string"
        ? [
            element("bpmn:conditionExpression", {}, [
              text(String(semantic(item)["condition"])),
            ]),
          ]
        : [],
    );
  const dataXmlElement = (item: Element): XmlNode[] => {
    const itemSemantic = semantic(item);
    const extensions = item.extensions?.["bpmnXml"];
    const dataObjectId =
      extensions && typeof extensions === "object"
        ? (extensions as Record<string, unknown>)["dataObjectId"]
        : undefined;
    const reference = element(`bpmn:${nodeTag(item)}`, {
      id: bpmnExportId(item),
      name: itemSemantic["name"] as string | undefined,
      dataObjectRef:
        itemSemantic["role"] === "reference" && typeof dataObjectId === "string"
          ? dataObjectId
          : undefined,
      isCollection: itemSemantic["collection"] === true ? "true" : undefined,
    });
    if (
      itemSemantic["role"] !== "reference" ||
      typeof dataObjectId !== "string"
    )
      return [reference];
    return [
      element("bpmn:dataObject", {
        id: dataObjectId,
        isCollection: itemSemantic["collection"] === true ? "true" : "false",
      }),
      reference,
    ];
  };
  const artifactXmlElement = (item: Element): XmlElement =>
    item.type === "bpmn.textAnnotation"
      ? element("bpmn:textAnnotation", { id: bpmnExportId(item) }, [
          element("bpmn:text", {}, [
            text(String(semantic(item)["text"] ?? "")),
          ]),
        ])
      : element("bpmn:group", { id: bpmnExportId(item) });
  const nodeXml = (item: Element): XmlElement => {
    const s = semantic(item);
    const id = bpmnExportId(item);
    const tag = nodeTag(item);
    const attrs: Record<string, string | undefined> = {
      id,
      name: typeof s["name"] === "string" ? s["name"] : undefined,
    };
    if (
      item.type === "bpmn.task" ||
      item.type === "bpmn.subProcess" ||
      item.type === "bpmn.callActivity"
    )
      attrs["isForCompensation"] =
        s["forCompensation"] === true ? "true" : undefined;
    if (item.type === "bpmn.subProcess")
      attrs["triggeredByEvent"] =
        s["triggeredByEvent"] === true ? "true" : undefined;
    if (item.type === "bpmn.boundaryEvent") {
      attrs["attachedToRef"] = idOf(String(s["attachedTo"]));
      attrs["cancelActivity"] =
        s["cancelActivity"] === false ? "false" : "true";
    }
    if (item.type === "bpmn.event" && s["position"] === "start")
      attrs["isInterrupting"] =
        s["interrupting"] === false ? "false" : undefined;
    const childrenXml: XmlNode[] = [];
    for (const flow of incoming.get(item.id) ?? [])
      childrenXml.push(element("bpmn:incoming", {}, [text(flow)]));
    for (const flow of outgoing.get(item.id) ?? [])
      childrenXml.push(element("bpmn:outgoing", {}, [text(flow)]));
    const taskData = data.filter(
      (record) =>
        parentOf(record) === item.id &&
        (semantic(record)["role"] === "input" ||
          semantic(record)["role"] === "output"),
    );
    if (
      taskData.length &&
      ["bpmn.task", "bpmn.subProcess", "bpmn.callActivity"].includes(item.type)
    ) {
      const inputs = taskData.filter(
        (record) => semantic(record)["role"] === "input",
      );
      const outputs = taskData.filter(
        (record) => semantic(record)["role"] === "output",
      );
      const ioElements: XmlNode[] = [
        ...inputs.map((record) =>
          element("bpmn:dataInput", {
            id: bpmnExportId(record),
            name: semantic(record)["name"] as string | undefined,
            isCollection:
              semantic(record)["collection"] === true ? "true" : undefined,
          }),
        ),
        ...outputs.map((record) =>
          element("bpmn:dataOutput", {
            id: bpmnExportId(record),
            name: semantic(record)["name"] as string | undefined,
            isCollection:
              semantic(record)["collection"] === true ? "true" : undefined,
          }),
        ),
        element(
          "bpmn:inputSet",
          {},
          inputs.map((record) =>
            element("bpmn:dataInputRefs", {}, [text(bpmnExportId(record))]),
          ),
        ),
        element(
          "bpmn:outputSet",
          {},
          outputs.map((record) =>
            element("bpmn:dataOutputRefs", {}, [text(bpmnExportId(record))]),
          ),
        ),
      ];
      childrenXml.push(element("bpmn:ioSpecification", {}, ioElements));
    }
    const dataAssociations = flows.filter(
      (flow) =>
        flow.type === "bpmn.dataAssociation" &&
        (semantic(flow)["to"] === item.id ||
          semantic(flow)["from"] === item.id),
    );
    for (const flow of dataAssociations) {
      const isInput = semantic(flow)["to"] === item.id;
      childrenXml.push(
        element(
          isInput ? "bpmn:dataInputAssociation" : "bpmn:dataOutputAssociation",
          {
            id: bpmnExportId(flow),
          },
          [
            element("bpmn:sourceRef", {}, [
              text(idOf(String(semantic(flow)["from"]))),
            ]),
            element("bpmn:targetRef", {}, [
              text(idOf(String(semantic(flow)["to"]))),
            ]),
          ],
        ),
      );
    }
    if (
      item.type === "bpmn.task" ||
      item.type === "bpmn.subProcess" ||
      item.type === "bpmn.callActivity"
    ) {
      const loop = s["loop"];
      if (loop === "standard")
        childrenXml.push(element("bpmn:standardLoopCharacteristics"));
      if (
        loop === "parallelMultiInstance" ||
        loop === "sequentialMultiInstance"
      )
        childrenXml.push(
          element("bpmn:multiInstanceLoopCharacteristics", {
            isSequential: loop === "sequentialMultiInstance" ? "true" : "false",
          }),
        );
    }
    childrenXml.push(...definitionXml(item));
    if (item.type === "bpmn.textAnnotation")
      childrenXml.push(
        element("bpmn:text", {}, [text(String(s["text"] ?? ""))]),
      );
    if (item.type === "bpmn.subProcess") {
      const children = flowNodes.filter((child) => parentOf(child) === item.id);
      childrenXml.push(...children.map(nodeXml));
      const nestedFlows = flows.filter((flow) => {
        if (flow.type !== "bpmn.sequenceFlow") return false;
        const from = byId.get(String(semantic(flow)["from"]));
        const to = byId.get(String(semantic(flow)["to"]));
        return (
          !!from &&
          !!to &&
          subprocessScope(from) === item.id &&
          subprocessScope(to) === item.id
        );
      });
      childrenXml.push(...nestedFlows.map(sequenceFlowXml));
      childrenXml.push(
        ...data
          .filter(
            (record) =>
              parentOf(record) === item.id &&
              semantic(record)["role"] !== "input" &&
              semantic(record)["role"] !== "output",
          )
          .flatMap(dataXmlElement),
      );
      childrenXml.push(
        ...artifacts
          .filter((record) => parentOf(record) === item.id)
          .map(artifactXmlElement),
      );
    }
    const result = element(`bpmn:${tag}`, attrs, childrenXml);
    const stored = item.extensions?.["bpmnXml"];
    if (stored && typeof stored === "object") {
      const foreign = stored as Record<string, unknown>;
      const attributes = foreign["attributes"];
      if (Array.isArray(attributes))
        for (const value of attributes) {
          if (!value || typeof value !== "object") continue;
          const attribute = value as Record<string, unknown>;
          if (
            typeof attribute["name"] !== "string" ||
            typeof attribute["value"] !== "string"
          )
            continue;
          if (
            !result.attributes.some(
              (existing) => existing.name === attribute["name"],
            )
          )
            (result.attributes as XmlAttribute[]).push({
              name: attribute["name"],
              prefix: String(attribute["name"]).includes(":")
                ? String(attribute["name"]).split(":")[0]
                : undefined,
              local:
                String(attribute["name"]).split(":").at(-1) ??
                String(attribute["name"]),
              value: attribute["value"],
            });
        }
      const children = foreign["children"];
      if (Array.isArray(children))
        for (const value of children)
          if (typeof value === "string")
            (result.children as XmlNode[]).push(parseXml(value));
    }
    return result;
  };
  const laneXml = (lane: Element): XmlElement => {
    const s = semantic(lane);
    const members = records.filter(
      (item) =>
        semantic(item)["parent"] === lane.id &&
        [
          "bpmn.task",
          "bpmn.subProcess",
          "bpmn.callActivity",
          "bpmn.event",
          "bpmn.boundaryEvent",
          "bpmn.gateway",
        ].includes(item.type),
    );
    const nested = lanes.filter((item) => semantic(item)["parent"] === lane.id);
    return element(
      "bpmn:lane",
      {
        id: bpmnExportId(lane),
        name: typeof s["name"] === "string" ? s["name"] : undefined,
      },
      [
        ...members.map((item) =>
          element("bpmn:flowNodeRef", {}, [text(bpmnExportId(item))]),
        ),
        ...(nested.length
          ? [
              element(
                "bpmn:childLaneSet",
                { id: `LaneSet_${bpmnExportId(lane)}` },
                nested.map(laneXml),
              ),
            ]
          : []),
      ],
    );
  };
  const processXml: XmlElement[] = [];
  for (const [participantId, nodes] of processNodes) {
    const participant = byId.get(participantId);
    if (participant && semantic(participant)["collapsed"] === true) continue;
    const pid = processId(participantId);
    const laneSet = lanes.filter(
      (item) =>
        semantic(item)["parent"] === participantId ||
        (!hasParticipants && semantic(item)["parent"] === undefined),
    );
    const members = nodes.slice();
    const semanticContents = members.map(nodeXml);
    const dataXml = data
      .filter((item) => belongsToProcess(item, participantId))
      .filter(
        (item) => !["input", "output"].includes(String(semantic(item)["role"])),
      )
      .filter((item) => subprocessScope(item) === undefined)
      .flatMap(dataXmlElement);
    const flowXml = flows
      .filter(
        (item) =>
          item.type === "bpmn.sequenceFlow" &&
          (() => {
            const from = byId.get(String(semantic(item)["from"]));
            const to = byId.get(String(semantic(item)["to"]));
            return (
              !!from &&
              !!to &&
              subprocessScope(from) === undefined &&
              subprocessScope(to) === undefined
            );
          })() &&
          (members.some((node) => node.id === semantic(item)["from"]) ||
            members.some((node) => node.id === semantic(item)["to"])),
      )
      .map((item) =>
        element(
          "bpmn:sequenceFlow",
          {
            id: bpmnExportId(item),
            name: semantic(item)["name"] as string | undefined,
            sourceRef: idOf(String(semantic(item)["from"])),
            targetRef: idOf(String(semantic(item)["to"])),
            ...(semantic(item)["isDefault"] === true ? {} : {}),
          },
          typeof semantic(item)["condition"] === "string"
            ? [
                element("bpmn:conditionExpression", {}, [
                  text(String(semantic(item)["condition"])),
                ]),
              ]
            : [],
        ),
      );
    for (const flow of flows.filter(
      (item) =>
        item.type === "bpmn.sequenceFlow" &&
        semantic(item)["isDefault"] === true,
    )) {
      const source = members.find((item) => item.id === semantic(flow)["from"]);
      if (source) {
        const sourceXml = semanticContents.find((item) =>
          item.attributes.some(
            (attribute) =>
              attribute.local === "id" &&
              attribute.value === bpmnExportId(source),
          ),
        );
        if (sourceXml)
          (sourceXml.attributes as XmlAttribute[]).push({
            name: "default",
            local: "default",
            value: bpmnExportId(flow),
          });
      }
    }
    const artifactXml = artifacts
      .filter((item) => belongsToProcess(item, participantId))
      .filter((item) => subprocessScope(item) === undefined)
      .map(artifactXmlElement);
    const associationXml = flows
      .filter((item) => item.type === "bpmn.association")
      .filter((item) => {
        const from = byId.get(String(semantic(item)["from"]));
        const to = byId.get(String(semantic(item)["to"]));
        const owner =
          (from && ownerParticipant(from)) || (to && ownerParticipant(to));
        return !hasParticipants || participantId === "orphan"
          ? owner === undefined
          : owner === participantId;
      })
      .map((item) =>
        element("bpmn:association", {
          id: bpmnExportId(item),
          sourceRef: idOf(String(semantic(item)["from"])),
          targetRef: idOf(String(semantic(item)["to"])),
          associationDirection:
            semantic(item)["direction"] === "one"
              ? "One"
              : semantic(item)["direction"] === "both"
                ? "Both"
                : undefined,
        }),
      );
    processXml.push(
      element("bpmn:process", { id: pid, isExecutable: "false" }, [
        ...(laneSet.length
          ? [
              element(
                "bpmn:laneSet",
                { id: `LaneSet_${participantId || pageId}` },
                laneSet.map(laneXml),
              ),
            ]
          : []),
        ...semanticContents,
        ...dataXml,
        ...flowXml,
        ...associationXml,
        ...artifactXml,
      ]),
    );
  }
  const rootExtras = Array.isArray(extension["rootElements"])
    ? (extension["rootElements"] as unknown[]).flatMap((item) =>
        typeof item === "string" ? [parseXml(item)] : [],
      )
    : [];
  const unsupported = Array.isArray(extension["unsupported"])
    ? (extension["unsupported"] as unknown[]).flatMap((item) =>
        typeof item === "string" ? [parseXml(item)] : [],
      )
    : [];
  const shapeRecords = records
    .filter(
      (item) =>
        item.type === "bpmn.participant" ||
        item.type === "bpmn.lane" ||
        !flows.includes(item),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const planeShapes = shapeRecords.map((item) => {
    const visual = item.visual;
    const attrs: Record<string, string | undefined> = {
      id: `${bpmnExportId(item)}_di`,
      bpmnElement: bpmnExportId(item),
      isHorizontal: item.type === "bpmn.participant" ? "true" : undefined,
      isExpanded:
        item.type === "bpmn.participant" && semantic(item)["collapsed"] === true
          ? "false"
          : item.type === "bpmn.subProcess" &&
              typeof semantic(item)["expanded"] === "boolean"
            ? semantic(item)["expanded"] === true
              ? "true"
              : "false"
            : undefined,
      isMarkerVisible:
        item.type === "bpmn.gateway" &&
        typeof semantic(item)["markerVisible"] === "boolean"
          ? semantic(item)["markerVisible"] === true
            ? "true"
            : "false"
          : undefined,
    };
    const bounds = element("dc:Bounds", {
      x: num(visual.x, 0),
      y: num(visual.y, 0),
      width: num(visual.width, 100),
      height: num(visual.height, 60),
    });
    const labels = visual.labelBounds
      ? [
          element("bpmndi:BPMNLabel", {}, [
            element("dc:Bounds", {
              x: num(visual.labelBounds.x, 0),
              y: num(visual.labelBounds.y, 0),
              width: num(visual.labelBounds.width, 90),
              height: num(visual.labelBounds.height, 20),
            }),
          ]),
        ]
      : [];
    return element("bpmndi:BPMNShape", attrs, [bounds, ...labels]);
  });
  const planeEdges = flows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((flow) => {
      let points = options.routeOf?.(flow);
      if (!points) {
        const s = semantic(flow);
        const from = byId.get(String(s["from"]));
        const to = byId.get(String(s["to"]));
        const fromBox = {
          x: from?.visual.x ?? 0,
          y: from?.visual.y ?? 0,
          width: from?.visual.width ?? 100,
          height: from?.visual.height ?? 60,
        };
        const toBox = {
          x: to?.visual.x ?? 0,
          y: to?.visual.y ?? 0,
          width: to?.visual.width ?? 100,
          height: to?.visual.height ?? 60,
        };
        const a = {
          x: fromBox.x + fromBox.width / 2,
          y: fromBox.y + fromBox.height / 2,
        };
        const b = {
          x: toBox.x + toBox.width / 2,
          y: toBox.y + toBox.height / 2,
        };
        const middle = Array.isArray(s["routingWaypoints"])
          ? (s["routingWaypoints"] as Array<{ u: number; v: number }>).map(
              (wp) => connectorWaypointToPage(wp, a, b),
            )
          : [];
        points = [border(fromBox, b), ...middle, border(toBox, a)];
      }
      const nodes = (points ?? []).map((point) =>
        element("di:waypoint", { x: num(point.x, 0), y: num(point.y, 0) }),
      );
      const label = flow.visual.labelBounds
        ? [
            element("bpmndi:BPMNLabel", {}, [
              element("dc:Bounds", {
                x: num(flow.visual.labelBounds.x, 0),
                y: num(flow.visual.labelBounds.y, 0),
                width: num(flow.visual.labelBounds.width, 90),
                height: num(flow.visual.labelBounds.height, 20),
              }),
            ]),
          ]
        : [];
      return element(
        "bpmndi:BPMNEdge",
        { id: `${bpmnExportId(flow)}_di`, bpmnElement: bpmnExportId(flow) },
        [...nodes, ...label],
      );
    });
  const diagram = element("bpmndi:BPMNDiagram", { id: `Diagram_${pageId}` }, [
    element(
      "bpmndi:BPMNPlane",
      {
        id: `Plane_${pageId}`,
        bpmnElement: participants.length ? collaborationId : processId(""),
      },
      [...planeShapes, ...planeEdges],
    ),
  ]);
  const rootAttrs = namespaces.concat([
    {
      name: "id",
      local: "id",
      value:
        typeof extension["definitionsId"] === "string"
          ? (extension["definitionsId"] as string)
          : `Definitions_${pageId}`,
    },
    {
      name: "targetNamespace",
      local: "targetNamespace",
      value:
        typeof extension["targetNamespace"] === "string"
          ? (extension["targetNamespace"] as string)
          : "http://bpmn.io/schema/bpmn",
    },
  ]);
  const root: XmlElement = {
    name: "bpmn:definitions",
    prefix: "bpmn",
    local: "definitions",
    ns: MODEL,
    attributes: rootAttrs,
    children: [
      ...collaborationXml,
      ...processXml,
      ...rootExtras,
      ...unsupported,
      diagram,
    ],
  };
  return { xml: serializeXml(root), warnings };
}
