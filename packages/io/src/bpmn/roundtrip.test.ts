import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { importBpmnXml } from "./import.ts";
import { exportBpmnXml } from "./export.ts";
import { bpmnSemanticProjection } from "./equivalence.ts";
import { serializeDocument } from "../jsonl/serialize.ts";

const fixture = readFileSync(
  new URL("../__fixtures__/bpmn/purchase-request.bpmn", import.meta.url),
  "utf8",
);
const fixtures = [
  "purchase-request.bpmn",
  "purchase-request-draft.bpmn",
  "purchase-request-swapped.bpmn",
  "purchase-request-inverted.bpmn",
].map((name) => ({
  name,
  source: readFileSync(
    new URL(`../__fixtures__/bpmn/${name}`, import.meta.url),
    "utf8",
  ),
}));
const canonicalFixture = readFileSync(
  new URL("../__fixtures__/bpmn/purchase-request.jsonl", import.meta.url),
  "utf8",
);

test("BPMN import-export-import preserves semantic projection and export bytes", () => {
  const first = importBpmnXml(fixture, { documentId: "purchase-request" });
  expect(serializeDocument(first.document)).toBe(canonicalFixture);
  const exported = exportBpmnXml(first.document, first.pageId).xml;
  const second = importBpmnXml(exported, { documentId: "purchase-request" });
  expect(bpmnSemanticProjection(second.document, second.pageId)).toEqual(
    bpmnSemanticProjection(first.document, first.pageId),
  );
  expect(exportBpmnXml(second.document, second.pageId).xml).toBe(exported);
});

test("all four original BPMN fixtures preserve projection, bounds and routes", () => {
  for (const { name, source } of fixtures) {
    const first = importBpmnXml(source, { documentId: name });
    const firstExport = exportBpmnXml(first.document, first.pageId).xml;
    const second = importBpmnXml(firstExport, { documentId: name });
    expect(bpmnSemanticProjection(second.document, second.pageId)).toEqual(
      bpmnSemanticProjection(first.document, first.pageId),
    );
    expect(exportBpmnXml(second.document, second.pageId).xml).toBe(firstExport);
    const secondById = new Map(
      second.document.elements.map((item) => [item.id, item]),
    );
    for (const original of first.document.elements) {
      const restored = secondById.get(original.id);
      expect(restored).toBeDefined();
      expect(restored?.visual.x).toBe(original.visual.x);
      expect(restored?.visual.y).toBe(original.visual.y);
      expect(restored?.visual.width).toBe(original.visual.width);
      expect(restored?.visual.height).toBe(original.visual.height);
      expect(restored?.visual.labelBounds).toEqual(original.visual.labelBounds);
      const originalSemantic = original.semantic as Record<string, unknown>;
      const restoredSemantic = restored?.semantic as
        | Record<string, unknown>
        | undefined;
      const originalWaypoints = originalSemantic["routingWaypoints"];
      const restoredWaypoints = restoredSemantic?.["routingWaypoints"];
      if (
        Array.isArray(originalWaypoints) &&
        Array.isArray(restoredWaypoints)
      ) {
        expect(restoredWaypoints).toHaveLength(originalWaypoints.length);
        for (const [index, waypoint] of originalWaypoints.entries()) {
          const restoredWaypoint = restoredWaypoints[index];
          if (
            waypoint &&
            typeof waypoint === "object" &&
            restoredWaypoint &&
            typeof restoredWaypoint === "object"
          ) {
            const originalRecord = waypoint as Record<string, number>;
            const restoredRecord = restoredWaypoint as Record<string, number>;
            expect(
              Math.abs(restoredRecord["u"] - originalRecord["u"]),
            ).toBeLessThanOrEqual(0.5);
            expect(
              Math.abs(restoredRecord["v"] - originalRecord["v"]),
            ).toBeLessThanOrEqual(0.5);
          }
        }
      }
    }
  }
});

const inlineDefinitions = (body: string, withMessageFlow = true): string =>
  `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"><bpmn:collaboration id="C"><bpmn:participant id="Pa" processRef="P"/><bpmn:participant id="Pb" processRef="Q"/>${withMessageFlow ? '<bpmn:messageFlow id="M" sourceRef="A" targetRef="B"/>' : ""}</bpmn:collaboration>${body}</bpmn:definitions>`;
const shapes = (ids: string): string =>
  ids
    .split(" ")
    .map(
      (id) =>
        `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="0" y="0" width="100" height="60"/></bpmndi:BPMNShape>`,
    )
    .join("");
const edges = (ids: string): string =>
  ids
    .split(" ")
    .map(
      (id) =>
        `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}"><di:waypoint x="100" y="30"/><di:waypoint x="200" y="30"/></bpmndi:BPMNEdge>`,
    )
    .join("");
const assertStableRoundtrip = (source: string, id: string) => {
  const first = importBpmnXml(source, { documentId: id });
  const firstXml = exportBpmnXml(first.document, first.pageId).xml;
  const second = importBpmnXml(firstXml, { documentId: id });
  expect(bpmnSemanticProjection(second.document, second.pageId)).toEqual(
    bpmnSemanticProjection(first.document, first.pageId),
  );
  expect(exportBpmnXml(second.document, second.pageId).xml).toBe(firstXml);
  return { first, firstXml };
};

test("inline associations, subprocesses and task IO round-trip losslessly", () => {
  const source = inlineDefinitions(
    `<bpmn:process id="P"><bpmn:task id="A"><bpmn:ioSpecification><bpmn:dataInput id="I"/><bpmn:dataOutput id="O"/><bpmn:inputSet><bpmn:dataInputRefs>I</bpmn:dataInputRefs></bpmn:inputSet><bpmn:outputSet><bpmn:dataOutputRefs>O</bpmn:dataOutputRefs></bpmn:outputSet></bpmn:ioSpecification><bpmn:dataInputAssociation id="DAI"><bpmn:sourceRef>DR</bpmn:sourceRef></bpmn:dataInputAssociation><bpmn:dataOutputAssociation id="DAO"><bpmn:targetRef>DR</bpmn:targetRef></bpmn:dataOutputAssociation></bpmn:task><bpmn:textAnnotation id="T"><bpmn:text>Note</bpmn:text></bpmn:textAnnotation><bpmn:association id="As" sourceRef="A" targetRef="T" associationDirection="Both"/><bpmn:dataObject id="DO" isCollection="true"/><bpmn:dataObjectReference id="DR" dataObjectRef="DO"/><bpmn:subProcess id="S"><bpmn:startEvent id="S1"/><bpmn:task id="T1"/><bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T1"/></bpmn:subProcess></bpmn:process><bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">${shapes("Pa Pb A T DR S S1 T1 I O")}${edges("As DAI DAO F1")}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`,
    false,
  );
  const { first, firstXml } = assertStableRoundtrip(
    source,
    "inline-constructs",
  );
  expect(first.warnings).toHaveLength(0);
  for (const [id, from, to] of [
    ["DAI", "DR", "A"],
    ["DAO", "A", "DR"],
  ]) {
    const association = first.document.elements.find((item) => item.id === id);
    expect(association?.semantic).toMatchObject({ from, to });
  }
  const xmlIds = new Set(first.document.elements.map((item) => item.id));
  for (const id of ["As", "DAI", "DAO", "S1", "T1", "F1", "I", "O"])
    expect(xmlIds.has(id)).toBe(true);
  expect(firstXml).toContain('<bpmn:association id="As"');
  expect(firstXml).toContain('<bpmn:dataInputAssociation id="DAI"');
  expect(firstXml).toContain('<bpmn:dataOutputAssociation id="DAO"');
  expect(firstXml).toContain('<bpmn:subProcess id="S"');
});

test("multi-pool artifacts and data references are emitted once", () => {
  const source = inlineDefinitions(
    `<bpmn:process id="P"><bpmn:laneSet id="LS"><bpmn:lane id="L"><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:task id="A"/><bpmn:textAnnotation id="TA"><bpmn:text>Note</bpmn:text></bpmn:textAnnotation><bpmn:dataObject id="DO"/><bpmn:dataObjectReference id="DR" dataObjectRef="DO"/></bpmn:process><bpmn:process id="Q"><bpmn:task id="B"/></bpmn:process><bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">${shapes("Pa Pb L A B TA DR")}${edges("M")}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`,
  );
  const { firstXml } = assertStableRoundtrip(source, "two-pools");
  const importReport = importBpmnXml(source, {
    documentId: "two-pools-parent",
  });
  for (const id of ["TA", "DR"])
    expect(
      importReport.document.elements.find((item) => item.id === id)?.semantic,
    ).toMatchObject({ parent: "Pa" });
  for (const id of ["TA", "DO", "DR", "A", "B"])
    expect(firstXml.match(new RegExp(`\\bid=\\"${id}\\"`, "g"))?.length).toBe(
      1,
    );
});

test("subprocess expansion state comes from and returns to BPMNDI", () => {
  const source = inlineDefinitions(
    `<bpmn:process id="P"><bpmn:subProcess id="S"><bpmn:task id="C"/></bpmn:subProcess></bpmn:process><bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">${shapes("Pa Pb S C").replace('id="S_di" bpmnElement="S"', 'id="S_di" bpmnElement="S" isExpanded="false"')}${edges("M")}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`,
    false,
  );
  const { first, firstXml } = assertStableRoundtrip(
    source,
    "collapsed-subprocess",
  );
  const subprocess = first.document.elements.find((item) => item.id === "S");
  expect((subprocess?.semantic as Record<string, unknown>)?.["expanded"]).toBe(
    false,
  );
  expect(firstXml).toContain('bpmnElement="S" isExpanded="false"');
});

test("boundary events and groups retain their computed process parents", () => {
  const source = inlineDefinitions(
    `<bpmn:process id="P"><bpmn:laneSet id="LS"><bpmn:lane id="L"><bpmn:flowNodeRef>T</bpmn:flowNodeRef><bpmn:flowNodeRef>B</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet><bpmn:task id="T"/><bpmn:boundaryEvent id="B" attachedToRef="T" cancelActivity="false"><bpmn:timerEventDefinition id="TD"/></bpmn:boundaryEvent></bpmn:process><bpmn:process id="Q"><bpmn:group id="G"/></bpmn:process><bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="C">${shapes("Pa Pb L T B G")}${edges("M")}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`,
    false,
  );
  const { first, firstXml } = assertStableRoundtrip(source, "boundary-parent");
  const boundary = first.document.elements.find((item) => item.id === "B");
  const group = first.document.elements.find((item) => item.id === "G");
  expect((boundary?.semantic as Record<string, unknown>)?.["parent"]).toBe("L");
  expect((group?.semantic as Record<string, unknown>)?.["parent"]).toBe("Pb");
  expect(firstXml).toContain('<bpmn:boundaryEvent id="B"');
  expect(firstXml).not.toContain("Process_orphan");
});

test("pool-less associations and subprocess contents survive export", () => {
  const source = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"><bpmn:process id="P"><bpmn:task id="A"/><bpmn:textAnnotation id="T"><bpmn:text>Note</bpmn:text></bpmn:textAnnotation><bpmn:association id="As" sourceRef="A" targetRef="T"/><bpmn:subProcess id="S"><bpmn:startEvent id="S1"/><bpmn:task id="T1"/><bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T1"/></bpmn:subProcess></bpmn:process><bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="P">${shapes("A T S S1 T1")}${edges("As F1")}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
  const { firstXml } = assertStableRoundtrip(source, "pool-less-nested");
  expect(firstXml).toContain('<bpmn:association id="As"');
  expect(firstXml).toContain('<bpmn:task id="T1"');
  expect(firstXml).toContain('<bpmn:sequenceFlow id="F1"');
});
