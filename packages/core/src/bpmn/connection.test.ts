import { describe, expect, test } from "bun:test";
import { resolveBpmnConnection } from "./connection.ts";
import { document, element } from "../test-helpers.ts";

const task = (id: string, parent = "pool", index = "a1") =>
  element({
    id,
    type: "bpmn.task",
    index,
    semantic: { name: id, taskType: "user", loop: "none", parent },
    visual: { x: 40, y: 40, width: 100, height: 60 },
  });
const pool = (id: string, index: string) =>
  element({
    id,
    type: "bpmn.participant",
    index,
    semantic: { collapsed: false },
    visual: { x: 0, y: 0, width: 500, height: 300 },
  });

describe("resolveBpmnConnection", () => {
  test("corrects requested flow types to the pool relationship", () => {
    const doc = document(
      [
        pool("pool", "a1"),
        task("a", "pool", "a2"),
        task("b", "pool", "a3"),
        pool("other", "a4"),
        task("c", "other", "a5"),
      ],
      [{ id: "page-1", name: "BPMN", kind: "bpmn" }],
    );
    expect(resolveBpmnConnection(doc, "a", "b", "bpmn.messageFlow")).toEqual({
      ok: true,
      type: "bpmn.sequenceFlow",
      corrected: true,
    });
    expect(resolveBpmnConnection(doc, "a", "c", "bpmn.sequenceFlow")).toEqual({
      ok: true,
      type: "bpmn.messageFlow",
      corrected: true,
    });
  });

  test("rejects invalid sequence-flow endpoints and scopes", () => {
    const doc = document(
      [
        pool("pool", "a1"),
        task("task", "pool", "a2"),
        element({
          id: "start",
          type: "bpmn.event",
          index: "a3",
          semantic: { position: "start", definitions: [], parent: "pool" },
          visual: { x: 0, y: 0, width: 36, height: 36 },
        }),
        element({
          id: "end",
          type: "bpmn.event",
          index: "a4",
          semantic: { position: "end", definitions: [], parent: "pool" },
          visual: { x: 0, y: 0, width: 36, height: 36 },
        }),
      ],
      [{ id: "page-1", name: "BPMN", kind: "bpmn" }],
    );
    expect(resolveBpmnConnection(doc, "task", "start")).toMatchObject({
      ok: false,
      code: "bpmn.connection.startEventIncoming",
    });
    expect(resolveBpmnConnection(doc, "end", "task")).toMatchObject({
      ok: false,
      code: "bpmn.connection.endEventOutgoing",
    });
  });

  test("pool-less pages use sequence flow and reject message flow", () => {
    const doc = document(
      [
        element({
          id: "a",
          type: "bpmn.task",
          index: "a1",
          semantic: { taskType: "user", loop: "none" },
        }),
        element({
          id: "b",
          type: "bpmn.task",
          index: "a2",
          semantic: { taskType: "user", loop: "none" },
        }),
      ],
      [{ id: "page-1", name: "BPMN", kind: "bpmn" }],
    );
    expect(resolveBpmnConnection(doc, "a", "b", "bpmn.messageFlow")).toEqual({
      ok: true,
      type: "bpmn.sequenceFlow",
      corrected: true,
    });
    expect(resolveBpmnConnection(doc, "a", "a")).toMatchObject({
      ok: false,
      code: "bpmn.connection.invalidEndpoint",
    });
  });

  test("allows message events across pools and rejects gateways as endpoints", () => {
    const doc = document(
      [
        pool("p1", "a1"),
        element({
          id: "throw",
          type: "bpmn.event",
          index: "a2",
          semantic: {
            position: "intermediateThrow",
            definitions: [],
            parent: "p1",
          },
          visual: { x: 0, y: 0, width: 36, height: 36 },
        }),
        pool("p2", "a3"),
        element({
          id: "start",
          type: "bpmn.event",
          index: "a4",
          semantic: { position: "start", definitions: [], parent: "p2" },
          visual: { x: 0, y: 0, width: 36, height: 36 },
        }),
        element({
          id: "gateway",
          type: "bpmn.gateway",
          index: "a5",
          semantic: { gatewayType: "exclusive", parent: "p1" },
          visual: { x: 0, y: 0, width: 50, height: 50 },
        }),
        task("other-task", "p2", "a6"),
      ],
      [{ id: "page-1", name: "BPMN", kind: "bpmn" }],
    );
    expect(resolveBpmnConnection(doc, "throw", "start")).toEqual({
      ok: true,
      type: "bpmn.messageFlow",
      corrected: false,
    });
    expect(resolveBpmnConnection(doc, "gateway", "other-task")).toMatchObject({
      ok: false,
      code: "bpmn.connection.invalidEndpoint",
    });
  });

  test("connects a collapsed black-box pool to another pool by message flow", () => {
    const doc = document(
      [
        element({
          id: "black-box",
          type: "bpmn.participant",
          index: "a1",
          semantic: { name: "External", collapsed: true },
          visual: { x: 0, y: 0, width: 500, height: 60 },
        }),
        pool("other", "a2"),
        task("activity", "other", "a3"),
      ],
      [{ id: "page-1", name: "BPMN", kind: "bpmn" }],
    );
    expect(resolveBpmnConnection(doc, "black-box", "activity")).toEqual({
      ok: true,
      type: "bpmn.messageFlow",
      corrected: false,
    });
  });

  test("resolves annotations, data associations, boundary and subprocess rules", () => {
    const doc = document(
      [
        pool("pool", "a1"),
        element({
          id: "sub",
          type: "bpmn.subProcess",
          index: "a2",
          semantic: {
            parent: "pool",
            expanded: true,
            triggeredByEvent: false,
            adHoc: false,
            loop: "none",
          },
          visual: { x: 0, y: 0, width: 300, height: 200 },
        }),
        task("outer", "pool", "a3"),
        task("inner", "sub", "a4"),
        element({
          id: "boundary",
          type: "bpmn.boundaryEvent",
          index: "a5",
          semantic: {
            attachedTo: "outer",
            cancelActivity: true,
            definitions: [],
          },
          visual: { x: 0, y: 0, width: 36, height: 36 },
        }),
        element({
          id: "data",
          type: "bpmn.dataObject",
          index: "a6",
          semantic: { role: "reference", collection: false },
          visual: { x: 0, y: 0, width: 40, height: 50 },
        }),
        element({
          id: "note",
          type: "bpmn.textAnnotation",
          index: "a7",
          semantic: { text: "Note" },
          visual: { x: 0, y: 0, width: 80, height: 40 },
        }),
      ],
      [{ id: "page-1", name: "BPMN", kind: "bpmn" }],
    );
    expect(resolveBpmnConnection(doc, "outer", "boundary")).toMatchObject({
      ok: false,
      code: "bpmn.connection.boundaryIncoming",
    });
    expect(resolveBpmnConnection(doc, "inner", "outer")).toMatchObject({
      ok: false,
      code: "bpmn.connection.crossScope",
    });
    expect(resolveBpmnConnection(doc, "data", "outer")).toMatchObject({
      ok: true,
      type: "bpmn.dataAssociation",
    });
    expect(resolveBpmnConnection(doc, "note", "outer")).toMatchObject({
      ok: true,
      type: "bpmn.association",
    });
  });
});
