import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { importBpmnXml } from "./import.ts";
import { BpmnParseError } from "./xml.ts";
import { exportBpmnXml } from "./export.ts";
import { bpmnSemanticProjection } from "./equivalence.ts";

const fixture = readFileSync(
  new URL("../__fixtures__/bpmn/purchase-request.bpmn", import.meta.url),
  "utf8",
);
const bpmn = (body: string, diagram = "", collaboration = ""): string =>
  `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"><bpmn:process id="Process">${body}</bpmn:process>${collaboration}${diagram}</bpmn:definitions>`;
const semantic = (report: ReturnType<typeof importBpmnXml>, id: string) =>
  report.document.elements.find((item) => item.id === id)?.semantic as
    | Record<string, unknown>
    | undefined;

test("imports original purchase-request BPMN semantics, lanes, flows and DI", () => {
  const report = importBpmnXml(fixture, { documentId: "purchase-request" });
  const elements = report.document.elements;
  expect(report.document.pages[0]?.kind).toBe("bpmn");
  expect(
    elements.filter((item) =>
      ["bpmn.task", "bpmn.event", "bpmn.gateway"].includes(item.type),
    ),
  ).toHaveLength(13);
  expect(elements.filter((item) => item.type === "bpmn.lane")).toHaveLength(3);
  expect(
    elements.filter((item) => item.type === "bpmn.participant"),
  ).toHaveLength(1);
  expect(
    elements.filter((item) => item.type === "bpmn.sequenceFlow"),
  ).toHaveLength(12);
  expect(report.warnings).toEqual([]);
  expect(
    elements.find((item) => item.id === "Flow_ToOrder")?.semantic,
  ).toMatchObject({
    routing: "manual",
    routingWaypoints: [{ u: expect.any(Number), v: expect.any(Number) }],
  });
});

test("rejects a missing or incorrectly namespaced definitions root", () => {
  expect(() => importBpmnXml("<definitions />")).toThrow(BpmnParseError);
  expect(() =>
    importBpmnXml('<bpmn:definitions xmlns:bpmn="urn:wrong" />'),
  ).toThrow(BpmnParseError);
});

test("resolves default sequence flows inside nested subprocess scopes", () => {
  const source =
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="Process"><bpmn:subProcess id="Sub" default="Flow_Default"><bpmn:task id="Task_A" /><bpmn:task id="Task_B" /><bpmn:sequenceFlow id="Flow_Default" sourceRef="Task_A" targetRef="Task_B" /></bpmn:subProcess></bpmn:process></bpmn:definitions>';
  const imported = importBpmnXml(source);
  expect(
    imported.document.elements.find((item) => item.id === "Flow_Default")
      ?.semantic,
  ).toMatchObject({ isDefault: true });
});

test("preserves unsupported BPMN and foreign XML content with warnings", () => {
  const source =
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:ext="urn:extension" id="Defs"><bpmn:process id="Process"><bpmn:task id="Task_A" camunda:async="true"><bpmn:extensionElements><ext:metadata ext:value="kept" /></bpmn:extensionElements></bpmn:task><bpmn:transaction id="Transaction_A"><bpmn:task id="Nested_A" /></bpmn:transaction></bpmn:process></bpmn:definitions>';
  const imported = importBpmnXml(source);
  const task = imported.document.elements.find((item) => item.id === "Task_A");
  const stored = task?.extensions?.["bpmnXml"] as
    | {
        attributes?: readonly { name: string; value: string }[];
        children?: readonly string[];
      }
    | undefined;
  expect(stored?.attributes?.[0]?.name).toBe("camunda:async");
  expect(stored?.attributes?.[0]?.value).toBe("true");
  expect(stored?.children?.[0]).toContain("ext:metadata");
  expect(
    imported.warnings.some((warning) =>
      warning.message.includes("camunda:async"),
    ),
  ).toBe(true);
  expect(
    imported.warnings.some((warning) => warning.element === "transaction"),
  ).toBe(true);
  const exported = exportBpmnXml(imported.document, imported.pageId).xml;
  expect(exported).toContain('camunda:async="true"');
  expect(exported).toContain("ext:metadata");
  expect(exported).toContain("bpmn:transaction");
  expect(
    importBpmnXml(exported).warnings.some(
      (warning) => warning.element === "transaction",
    ),
  ).toBe(true);
});

test("maps gateway marker visibility to semantic data for both values", () => {
  const imported = importBpmnXml(fixture);
  const gateway = imported.document.elements.find(
    (item) => item.id === "Gateway_Approve",
  );
  expect(semantic(imported, "Gateway_Approve")?.["markerVisible"]).toBe(true);
  expect(
    (gateway?.visual as Record<string, unknown> | undefined)?.["markerVisible"],
  ).toBeUndefined();

  const source = bpmn(
    '<bpmn:exclusiveGateway id="Gateway" />',
    '<bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="Process"><bpmndi:BPMNShape id="Gateway_di" bpmnElement="Gateway" isMarkerVisible="false"><dc:Bounds x="0" y="0" width="50" height="50" /></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>',
  );
  const falseMarker = importBpmnXml(source);
  expect(semantic(falseMarker, "Gateway")?.["markerVisible"]).toBe(false);
  expect(exportBpmnXml(falseMarker.document, falseMarker.pageId).xml).toContain(
    'isMarkerVisible="false"',
  );
});

test("imports nested lanes and assigns flow nodes to the innermost lane", () => {
  const source = bpmn(
    '<bpmn:laneSet id="LaneSet"><bpmn:lane id="L1"><bpmn:flowNodeRef>UT</bpmn:flowNodeRef><bpmn:flowNodeRef>T2</bpmn:flowNodeRef><bpmn:childLaneSet id="Nested"><bpmn:lane id="L1a"><bpmn:flowNodeRef>UT</bpmn:flowNodeRef></bpmn:lane><bpmn:lane id="L1b"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef></bpmn:lane></bpmn:childLaneSet></bpmn:lane></bpmn:laneSet><bpmn:userTask id="UT"/><bpmn:task id="T2"/>',
    '<bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="Process"><bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool"><dc:Bounds x="0" y="0" width="400" height="200"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="L1_di" bpmnElement="L1"><dc:Bounds x="0" y="0" width="400" height="200"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="L1a_di" bpmnElement="L1a"><dc:Bounds x="0" y="0" width="200" height="100"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="L1b_di" bpmnElement="L1b"><dc:Bounds x="200" y="0" width="200" height="100"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="UT_di" bpmnElement="UT"><dc:Bounds x="10" y="10" width="80" height="40"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="T2_di" bpmnElement="T2"><dc:Bounds x="210" y="10" width="80" height="40"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>',
    '<bpmn:collaboration id="Collaboration"><bpmn:participant id="Pool" processRef="Process"/></bpmn:collaboration>',
  );
  const imported = importBpmnXml(source);
  expect(imported.warnings).toEqual([]);
  expect(semantic(imported, "L1a")?.["parent"]).toBe("L1");
  expect(semantic(imported, "L1b")?.["parent"]).toBe("L1");
  expect(semantic(imported, "UT")?.["parent"]).toBe("L1a");
  expect(semantic(imported, "T2")?.["parent"]).toBe("L1b");
  const exported = exportBpmnXml(imported.document, imported.pageId).xml;
  expect(exported).toContain("<bpmn:childLaneSet");
  const reimported = importBpmnXml(exported);
  expect(semantic(reimported, "L1a")?.["parent"]).toBe("L1");
  expect(semantic(reimported, "UT")?.["parent"]).toBe("L1a");
  expect(
    bpmnSemanticProjection(reimported.document, reimported.pageId),
  ).toEqual(bpmnSemanticProjection(imported.document, imported.pageId));
  expect(exportBpmnXml(reimported.document, reimported.pageId).xml).toBe(
    exported,
  );
});

test("resolves dataObjectReference collection and preserves its source id", () => {
  const source = bpmn(
    '<bpmn:dataObjectReference id="DOR" dataObjectRef="DO"/><bpmn:dataObject id="DO" isCollection="true"/>',
    '<bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="Process"><bpmndi:BPMNShape id="DOR_di" bpmnElement="DOR"><dc:Bounds x="0" y="0" width="36" height="50"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>',
  );
  const imported = importBpmnXml(source);
  expect(imported.warnings).toEqual([]);
  expect(semantic(imported, "DOR")?.["collection"]).toBe(true);
  expect(
    imported.document.elements.find((item) => item.id === "DOR")?.extensions?.[
      "bpmnXml"
    ],
  ).toMatchObject({ dataObjectId: "DO" });
  const exported = exportBpmnXml(imported.document, imported.pageId).xml;
  expect(exported).toContain('<bpmn:dataObject id="DO" isCollection="true"');
  expect(exported).toContain('dataObjectRef="DO"');
  const roundTrip = importBpmnXml(exported);
  expect(semantic(roundTrip, "DOR")?.["collection"]).toBe(true);
  expect(roundTrip.warnings).toEqual([]);
});

test("maps task types, loops and compensation flags", () => {
  const mappings = [
    ["task", "none"],
    ["userTask", "user"],
    ["serviceTask", "service"],
    ["manualTask", "manual"],
    ["sendTask", "send"],
    ["receiveTask", "receive"],
    ["scriptTask", "script"],
    ["businessRuleTask", "businessRule"],
  ] as const;
  for (const [tag, taskType] of mappings) {
    const report = importBpmnXml(bpmn(`<bpmn:${tag} id="Task"/>`));
    expect(semantic(report, "Task")).toMatchObject({ taskType, loop: "none" });
  }
  expect(
    semantic(
      importBpmnXml(
        bpmn(
          '<bpmn:task id="Standard"><bpmn:standardLoopCharacteristics/></bpmn:task>',
        ),
      ),
      "Standard",
    ),
  ).toMatchObject({ loop: "standard" });
  expect(
    semantic(
      importBpmnXml(
        bpmn(
          '<bpmn:task id="Parallel"><bpmn:multiInstanceLoopCharacteristics isSequential="false"/></bpmn:task>',
        ),
      ),
      "Parallel",
    ),
  ).toMatchObject({ loop: "parallelMultiInstance" });
  expect(
    semantic(
      importBpmnXml(
        bpmn(
          '<bpmn:task id="Sequential" isForCompensation="true"><bpmn:multiInstanceLoopCharacteristics isSequential="true"/></bpmn:task>',
        ),
      ),
      "Sequential",
    ),
  ).toMatchObject({ loop: "sequentialMultiInstance", forCompensation: true });
});

test("maps event positions, definitions and boundary cancellation", () => {
  const cases = [
    [
      "startEvent",
      "start",
      "messageEventDefinition",
      { kind: "message", ref: "Message" },
    ],
    [
      "intermediateCatchEvent",
      "intermediateCatch",
      "timerEventDefinition",
      { kind: "timer", timer: { type: "duration", value: "PT1H" } },
    ],
    [
      "intermediateThrowEvent",
      "intermediateThrow",
      "linkEventDefinition",
      { kind: "link", linkName: "Next" },
    ],
    [
      "endEvent",
      "end",
      "conditionalEventDefinition",
      { kind: "conditional", condition: "ready" },
    ],
  ] as const;
  for (const [tag, position, definitionTag, definition] of cases) {
    const definitionXml =
      definitionTag === "messageEventDefinition"
        ? '<bpmn:messageEventDefinition messageRef="Message"/>'
        : definitionTag === "timerEventDefinition"
          ? "<bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>"
          : definitionTag === "linkEventDefinition"
            ? '<bpmn:linkEventDefinition name="Next"/>'
            : "<bpmn:conditionalEventDefinition><bpmn:condition>ready</bpmn:condition></bpmn:conditionalEventDefinition>";
    const report = importBpmnXml(
      bpmn(`<bpmn:${tag} id="Event">${definitionXml}</bpmn:${tag}>`),
    );
    expect(semantic(report, "Event")).toMatchObject({
      position,
      definitions: [definition],
    });
  }
  const boundary = importBpmnXml(
    bpmn(
      '<bpmn:task id="Task"/><bpmn:boundaryEvent id="Boundary" attachedToRef="Task" cancelActivity="false"/>',
    ),
  );
  expect(semantic(boundary, "Boundary")).toMatchObject({
    attachedTo: "Task",
    cancelActivity: false,
  });
});

test("maps every remaining event definition kind and timer value", () => {
  const cases = [
    [
      "timerEventDefinition",
      "<bpmn:timeDate>2026-10-13</bpmn:timeDate>",
      { kind: "timer", timer: { type: "date", value: "2026-10-13" } },
    ],
    [
      "timerEventDefinition",
      "<bpmn:timeCycle>R3/PT1H</bpmn:timeCycle>",
      { kind: "timer", timer: { type: "cycle", value: "R3/PT1H" } },
    ],
    [
      "errorEventDefinition",
      ' errorRef="Error"',
      { kind: "error", ref: "Error" },
    ],
    [
      "escalationEventDefinition",
      ' escalationRef="Escalation"',
      { kind: "escalation", ref: "Escalation" },
    ],
    ["cancelEventDefinition", "", { kind: "cancel" }],
    ["compensateEventDefinition", "", { kind: "compensation" }],
    [
      "signalEventDefinition",
      ' signalRef="Signal"',
      { kind: "signal", ref: "Signal" },
    ],
    ["terminateEventDefinition", "", { kind: "terminate" }],
  ] as const;
  for (const [tag, content, expected] of cases) {
    const xml = content.startsWith(" ")
      ? `<bpmn:${tag}${content}/>`
      : `<bpmn:${tag}>${content}</bpmn:${tag}>`;
    const report = importBpmnXml(
      bpmn(`<bpmn:startEvent id="Event">${xml}</bpmn:startEvent>`),
    );
    expect(semantic(report, "Event")?.["definitions"]).toMatchObject([
      expected,
    ]);
  }
});

test("maps gateway types and flow defaults", () => {
  const mappings = [
    ["exclusiveGateway", "exclusive"],
    ["parallelGateway", "parallel"],
    ["inclusiveGateway", "inclusive"],
    ["eventBasedGateway", "eventBased"],
    ["complexGateway", "complex"],
  ] as const;
  for (const [tag, gatewayType] of mappings)
    expect(
      semantic(importBpmnXml(bpmn(`<bpmn:${tag} id="Gateway"/>`)), "Gateway"),
    ).toMatchObject({ gatewayType });
  const report = importBpmnXml(
    bpmn(
      '<bpmn:task id="A" default="F"/><bpmn:task id="B"/><bpmn:sequenceFlow id="F" sourceRef="A" targetRef="B"/>',
    ),
  );
  expect(semantic(report, "F")?.["isDefault"]).toBe(true);
});

test("imports collapsed pools, data artifacts, and assigns children to subprocesses", () => {
  const source =
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:collaboration id="C"><bpmn:participant id="Pool"/></bpmn:collaboration><bpmn:process id="Process"><bpmn:subProcess id="Sub" isExpanded="false"><bpmn:task id="Child"/></bpmn:subProcess><bpmn:dataStoreReference id="Store"/><bpmn:textAnnotation id="Annotation"><bpmn:text>note</bpmn:text></bpmn:textAnnotation><bpmn:group id="Group"><bpmn:categoryValue id="Category" value="Category"/></bpmn:group><bpmn:association id="Association" sourceRef="Child" targetRef="Annotation"/><bpmn:dataInput id="Input"/><bpmn:dataOutput id="Output"/></bpmn:process></bpmn:definitions>';
  const report = importBpmnXml(source);
  expect(semantic(report, "Pool")?.["collapsed"]).toBe(true);
  expect(semantic(report, "Sub")).toMatchObject({ expanded: false });
  expect(semantic(report, "Child")?.["parent"]).toBe("Sub");
  expect(semantic(report, "Store")).toBeDefined();
  expect(semantic(report, "Annotation")).toMatchObject({ text: "note" });
  expect(semantic(report, "Group")).toMatchObject({ name: "Category" });
  expect(semantic(report, "Association")).toMatchObject({
    from: "Child",
    to: "Annotation",
  });
  expect(semantic(report, "Input")).toMatchObject({ role: "input" });
  expect(semantic(report, "Output")).toMatchObject({ role: "output" });
});

test("imports IO specification records and data association endpoints", () => {
  const source = bpmn(
    '<bpmn:task id="Task"><bpmn:ioSpecification><bpmn:dataInput id="Input"/><bpmn:dataOutput id="Output"/></bpmn:ioSpecification></bpmn:task><bpmn:dataInputAssociation id="InputAssociation"><bpmn:sourceRef>Input</bpmn:sourceRef><bpmn:targetRef>Task</bpmn:targetRef></bpmn:dataInputAssociation><bpmn:dataOutputAssociation id="OutputAssociation"><bpmn:sourceRef>Task</bpmn:sourceRef><bpmn:targetRef>Output</bpmn:targetRef></bpmn:dataOutputAssociation>',
  );
  const report = importBpmnXml(source);
  expect(semantic(report, "Input")).toMatchObject({
    role: "input",
    parent: "Task",
  });
  expect(semantic(report, "Output")).toMatchObject({
    role: "output",
    parent: "Task",
  });
  expect(semantic(report, "InputAssociation")).toMatchObject({
    from: "Input",
    to: "Task",
  });
  expect(semantic(report, "OutputAssociation")).toMatchObject({
    from: "Task",
    to: "Output",
  });
});

test("marks children from a secondary subprocess plane hidden", () => {
  const source =
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"><bpmn:process id="Process"><bpmn:subProcess id="Sub" isExpanded="false"><bpmn:task id="Child"/></bpmn:subProcess></bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="Process"><bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub"><dc:Bounds x="0" y="0" width="100" height="80"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="Sub"><bpmndi:BPMNShape id="Child_di" bpmnElement="Child"><dc:Bounds x="900" y="900" width="80" height="40"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>';
  const report = importBpmnXml(source);
  const child = report.document.elements.find((item) => item.id === "Child");
  expect(child?.visual.hidden).toBe(true);
  expect(child?.visual.x).not.toBe(900);
});

test("reports missing DI and assigns deterministic positions", () => {
  const report = importBpmnXml(bpmn('<bpmn:task id="Missing"/>'));
  expect(report.missingDi).toContain("Missing");
  expect(report.warnings.some((warning) => warning.xmlId === "Missing")).toBe(
    true,
  );
  const item = report.document.elements.find(
    (element) => element.id === "Missing",
  );
  expect(item?.visual).toMatchObject({ x: 0, y: 40, width: 100, height: 60 });
});
