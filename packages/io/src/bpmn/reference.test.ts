import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importBpmnXml } from "./import.ts";
import { bpmnSemanticProjection } from "./equivalence.ts";
import { exportBpmnXml } from "./export.ts";
import { parseXml, type XmlElement } from "./xml.ts";

const children = (xml: XmlElement): XmlElement[] =>
  xml.children.filter((node): node is XmlElement => !("kind" in node));
const attr = (xml: XmlElement, name: string): string | undefined =>
  xml.attributes.find((item) => item.local === name)?.value;
const descendants = (xml: XmlElement, local: string): XmlElement[] =>
  children(xml).flatMap((child) => [
    ...(child.local === local ? [child] : []),
    ...descendants(child, local),
  ]);

const root = new URL("../../../..", import.meta.url).pathname;
const referenceDir = join(root, ".reference/bpmn-article/docs");
test.skipIf(!existsSync(referenceDir))(
  "imports all four local reference BPMN files",
  () => {
    const files = [
      "purchase_request/purchase_request.bpmn",
      "purchase_request_draft/purchase_request_draft.bpmn",
      "purchase_request_swapped/purchase_request_swapped.bpmn",
      "purchase_request_inverted/purchase_request_inverted.bpmn",
    ];
    for (const file of files) {
      const source = readFileSync(join(referenceDir, file), "utf8");
      const xml = parseXml(source);
      const first = importBpmnXml(source);
      expect(first.warnings).toEqual([]);
      const importedById = new Map(
        first.document.elements.map((item) => [item.id, item]),
      );
      const typeByTag: Record<string, string> = {
        task: "bpmn.task",
        userTask: "bpmn.task",
        serviceTask: "bpmn.task",
        manualTask: "bpmn.task",
        sendTask: "bpmn.task",
        receiveTask: "bpmn.task",
        scriptTask: "bpmn.task",
        businessRuleTask: "bpmn.task",
        startEvent: "bpmn.event",
        intermediateCatchEvent: "bpmn.event",
        intermediateThrowEvent: "bpmn.event",
        endEvent: "bpmn.event",
        exclusiveGateway: "bpmn.gateway",
        parallelGateway: "bpmn.gateway",
        inclusiveGateway: "bpmn.gateway",
        eventBasedGateway: "bpmn.gateway",
        complexGateway: "bpmn.gateway",
        boundaryEvent: "bpmn.boundaryEvent",
        participant: "bpmn.participant",
        lane: "bpmn.lane",
        sequenceFlow: "bpmn.sequenceFlow",
        messageFlow: "bpmn.messageFlow",
        dataObjectReference: "bpmn.dataObject",
        dataStoreReference: "bpmn.dataStore",
        textAnnotation: "bpmn.textAnnotation",
        group: "bpmn.group",
        association: "bpmn.association",
        dataInputAssociation: "bpmn.dataAssociation",
        dataOutputAssociation: "bpmn.dataAssociation",
      };
      for (const [tag, type] of Object.entries(typeByTag)) {
        const sourceIds = descendants(xml, tag)
          .map((item) => attr(item, "id"))
          .filter((id): id is string => Boolean(id));
        const importedIds = first.document.elements
          .filter((item) => item.type === type && sourceIds.includes(item.id))
          .map((item) => item.id);
        expect(importedIds.length).toBe(sourceIds.length);
      }
      for (const lane of descendants(xml, "lane")) {
        const laneId = attr(lane, "id");
        if (!laneId) continue;
        for (const ref of descendants(lane, "flowNodeRef")) {
          const nodeId = ref.children
            .filter(
              (node): node is { kind: "text"; text: string } => "kind" in node,
            )
            .map((node) => node.text)
            .join("")
            .trim();
          const element = importedById.get(nodeId);
          const semantic = element?.semantic as
            | Record<string, unknown>
            | undefined;
          expect(semantic?.["parent"]).toBe(laneId);
        }
      }
      for (const shape of descendants(xml, "BPMNShape")) {
        const elementId = attr(shape, "bpmnElement");
        const bounds = descendants(shape, "Bounds")[0];
        if (!elementId || !bounds) continue;
        const imported = importedById.get(elementId);
        expect(imported?.visual.x).toBe(Number(attr(bounds, "x")));
        expect(imported?.visual.y).toBe(Number(attr(bounds, "y")));
        expect(imported?.visual.width).toBe(Number(attr(bounds, "width")));
        expect(imported?.visual.height).toBe(Number(attr(bounds, "height")));
      }
      const second = importBpmnXml(
        exportBpmnXml(first.document, first.pageId).xml,
      );
      expect(bpmnSemanticProjection(second.document, second.pageId)).toEqual(
        bpmnSemanticProjection(first.document, first.pageId),
      );
    }
  },
);
