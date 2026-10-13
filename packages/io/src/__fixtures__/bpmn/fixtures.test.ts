import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = [
  "purchase-request.bpmn",
  "purchase-request-draft.bpmn",
  "purchase-request-swapped.bpmn",
  "purchase-request-inverted.bpmn",
] as const;

function read(name: (typeof FIXTURES)[number]): string {
  return readFileSync(join(import.meta.dir, name), "utf8");
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function withoutDefinitionsLine(text: string): string {
  return text.replace(/id="Definitions_[^"]+"/, 'id="Definitions_NORMALIZED"');
}

function differingLines(
  left: string,
  right: string,
): Array<{ index: number; left: string; right: string }> {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const length = Math.max(leftLines.length, rightLines.length);
  const differences: Array<{ index: number; left: string; right: string }> = [];

  for (let index = 0; index < length; index += 1) {
    if (leftLines[index] !== rightLines[index]) {
      differences.push({
        index,
        left: leftLines[index] ?? "",
        right: rightLines[index] ?? "",
      });
    }
  }

  return differences;
}

function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) {
      return false;
    }
  }

  return true;
}

function tagBalance(text: string): { stack: string[]; mismatches: string[] } {
  const stack: string[] = [];
  const mismatches: string[] = [];
  const tags = /<\/?([A-Za-z][\w:.-]*)[^>]*?>/g;
  let match = tags.exec(text);

  while (match !== null) {
    const token = match[0];
    const name = match[1];
    if (token.startsWith("</")) {
      const open = stack.pop();
      if (open !== name) {
        mismatches.push(`expected </${open ?? ""}>, found </${name}>`);
      }
    } else if (!token.endsWith("/>")) {
      stack.push(name);
    }

    match = tags.exec(text);
  }

  return { stack, mismatches };
}

describe("original BPMN fixtures", () => {
  test("have the XML root, namespaces, balanced tags, and ASCII text", () => {
    for (const name of FIXTURES) {
      const text = read(name);
      expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(
        true,
      );
      const root = text.split("\n")[1] ?? "";
      expect(root.startsWith("<bpmn:definitions ")).toBe(true);
      expect(text.endsWith("</bpmn:definitions>\n")).toBe(true);
      expect(count(text, "<bpmn:definitions ")).toBe(1);
      expect(count(root, "xmlns:")).toBe(5);
      for (const namespace of [
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
        'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
        'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
        'xmlns:di="http://www.omg.org/spec/DD/20100524/DI"',
        'targetNamespace="http://bpmn.io/schema/bpmn"',
      ]) {
        expect(root).toContain(namespace);
      }

      expect(text.endsWith("\n")).toBe(true);
      expect(tagBalance(text)).toEqual({ stack: [], mismatches: [] });
      expect(isAscii(text)).toBe(true);
    }
  });

  test("complete fixture has the required BPMN and diagram counts", () => {
    const complete = read("purchase-request.bpmn");
    expect(count(complete, "<bpmn:sequenceFlow ")).toBe(12);
    expect(count(complete, "<bpmn:flowNodeRef>")).toBe(13);
    expect(count(complete, "<bpmn:messageEventDefinition ")).toBe(6);
    expect(count(complete, "<bpmndi:BPMNShape ")).toBe(17);
    expect(count(complete, "<bpmndi:BPMNEdge ")).toBe(12);
    expect(count(complete, "<bpmn:lane ")).toBe(3);
    expect(count(complete, "<bpmn:userTask ")).toBe(3);
  });

  test("draft fixture removes the order handoff and order task label", () => {
    const draft = read("purchase-request-draft.bpmn");
    expect(count(draft, "<bpmn:sequenceFlow ")).toBe(11);
    expect(count(draft, "<bpmndi:BPMNEdge ")).toBe(11);
    expect(draft).toContain('<bpmn:userTask id="Task_PlaceOrder">');
    expect(draft).not.toContain("Flow_OrderToNotice");
  });

  test("swapped fixture changes only the two request notice event tags", () => {
    const complete = withoutDefinitionsLine(read("purchase-request.bpmn"));
    const swapped = withoutDefinitionsLine(
      read("purchase-request-swapped.bpmn"),
    );
    expect(swapped.split("\n").length).toBe(complete.split("\n").length);
    const differences = differingLines(complete, swapped);
    expect(differences.map(({ left, right }) => [left, right])).toEqual([
      [
        '    <bpmn:intermediateThrowEvent id="Event_RequestNoticeRequester" name="Send request notice">',
        '    <bpmn:intermediateCatchEvent id="Event_RequestNoticeRequester" name="Send request notice">',
      ],
      [
        "    </bpmn:intermediateThrowEvent>",
        "    </bpmn:intermediateCatchEvent>",
      ],
      [
        '    <bpmn:intermediateCatchEvent id="Event_RequestNoticeApprover" name="Receive request notice">',
        '    <bpmn:intermediateThrowEvent id="Event_RequestNoticeApprover" name="Receive request notice">',
      ],
      [
        "    </bpmn:intermediateCatchEvent>",
        "    </bpmn:intermediateThrowEvent>",
      ],
    ]);
  });

  test("inverted fixture changes only the YES and NO flow names", () => {
    const complete = withoutDefinitionsLine(read("purchase-request.bpmn"));
    const inverted = withoutDefinitionsLine(
      read("purchase-request-inverted.bpmn"),
    );
    expect(inverted.split("\n").length).toBe(complete.split("\n").length);
    const differences = differingLines(complete, inverted);
    expect(differences.map(({ left, right }) => [left, right])).toEqual([
      [
        '    <bpmn:sequenceFlow id="Flow_ToRejection" name="NO" sourceRef="Gateway_Approve" targetRef="Event_RejectionNoticeApprover" />',
        '    <bpmn:sequenceFlow id="Flow_ToRejection" name="YES" sourceRef="Gateway_Approve" targetRef="Event_RejectionNoticeApprover" />',
      ],
      [
        '    <bpmn:sequenceFlow id="Flow_ToOrder" name="YES" sourceRef="Gateway_Approve" targetRef="Task_PlaceOrder" />',
        '    <bpmn:sequenceFlow id="Flow_ToOrder" name="NO" sourceRef="Gateway_Approve" targetRef="Task_PlaceOrder" />',
      ],
    ]);
  });

  test("Definitions ids identify the four fixture variants in order", () => {
    expect(
      FIXTURES.map((name) => read(name).match(/id="(Definitions_[^"]+)"/)?.[1]),
    ).toEqual([
      "Definitions_OfficeSupply",
      "Definitions_OfficeSupplyDraft",
      "Definitions_OfficeSupplySwapped",
      "Definitions_OfficeSupplyInverted",
    ]);
  });
});
