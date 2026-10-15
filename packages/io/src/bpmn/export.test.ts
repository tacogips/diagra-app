import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { importBpmnXml } from "./import.ts";
import { exportBpmnXml } from "./export.ts";
import { bpmnExportId } from "./ids.ts";
import { parseXml } from "./xml.ts";

test("exports a deterministic BPMN document with standard namespaces and diagram interchange", () => {
  const source = readFileSync(
    new URL("../__fixtures__/bpmn/purchase-request.bpmn", import.meta.url),
    "utf8",
  );
  const imported = importBpmnXml(source, { documentId: "purchase-request" });
  const first = exportBpmnXml(imported.document, imported.pageId).xml;
  expect(exportBpmnXml(imported.document, imported.pageId).xml).toBe(first);
  expect(first).toContain(
    'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
  );
  expect(first).toContain(
    'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
  );
  expect(first).toContain('xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"');
  expect(first).toContain('xmlns:di="http://www.omg.org/spec/DD/20100524/DI"');
  expect(first).toContain(
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  );
  expect(first).toContain("<bpmn:incoming>");
  expect(first).toContain("<bpmn:outgoing>");
  expect(first).toContain(
    'id="Gateway_Approve_di" bpmnElement="Gateway_Approve" isMarkerVisible="true"',
  );
  expect(first).toContain('<dc:Bounds x="655" y="352" width="90" height="14"');
  expect(parseXml(first).local).toBe("definitions");
  expect(first).toContain("BPMNPlane");
});

test("exports pool-less processes and uses routeOf points rounded to two decimals", () => {
  const poolLess = importBpmnXml(
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="Process"><bpmn:task id="A"/><bpmn:task id="B"/><bpmn:sequenceFlow id="F" sourceRef="A" targetRef="B"/></bpmn:process></bpmn:definitions>',
  );
  const poolLessXml = exportBpmnXml(poolLess.document, poolLess.pageId).xml;
  expect((poolLessXml.match(/<bpmn:process\b/g) ?? []).length).toBe(1);
  expect(poolLessXml).not.toContain("bpmn:collaboration");

  const source = readFileSync(
    new URL("../__fixtures__/bpmn/purchase-request.bpmn", import.meta.url),
    "utf8",
  );
  const imported = importBpmnXml(source);
  const routed = exportBpmnXml(imported.document, imported.pageId, {
    routeOf: (edge) =>
      edge.id === "Flow_ToOrder"
        ? [
            { x: 1.234, y: 2 },
            { x: 3, y: 4.567 },
          ]
        : undefined,
  }).xml;
  const edge = routed.match(
    /<bpmndi:BPMNEdge id="Flow_ToOrder_di"[\s\S]*?<\/bpmndi:BPMNEdge>/,
  )?.[0];
  expect(edge).toContain('<di:waypoint x="1.23" y="2"');
  expect(edge).toContain('<di:waypoint x="3" y="4.57"');
});

test("maps invalid element ids to stable BPMN NCNames", () => {
  const id = bpmnExportId({ id: "01HXYZ-ABC", type: "bpmn.task" });
  expect(id).toBe("Activity_01HXYZ-ABC");
  expect(bpmnExportId({ id, type: "bpmn.task" })).toBe(id);
});
