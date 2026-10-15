import { describe, expect, test } from "bun:test";
import { Editor } from "../editor.ts";
import {
  counterIds,
  document,
  element,
  makeEditor,
  seededRng,
} from "../test-helpers.ts";

const page = { id: "page-1", name: "BPMN", kind: "bpmn" as const };
const pool = (id: string, index: string) =>
  element({
    id,
    type: "bpmn.participant",
    index,
    semantic: { name: id, collapsed: false },
    visual: { x: 0, y: 0, width: 400, height: 300 },
  });
const task = (id: string, parent: string, index: string) =>
  element({
    id,
    type: "bpmn.task",
    index,
    semantic: { name: id, taskType: "user", loop: "none", parent },
    visual: { x: 40, y: 40, width: 100, height: 60 },
  });
const illegalEndFlowFixture = () => {
  const participant = pool("p", "a1");
  const end = element({
    id: "end",
    type: "bpmn.event",
    index: "a2",
    semantic: { name: "End", position: "end", definitions: [], parent: "p" },
    visual: { x: 240, y: 40, width: 36, height: 36 },
  });
  const activity = task("activity", "p", "a3");
  const flow = element({
    id: "illegal-flow",
    type: "bpmn.sequenceFlow",
    index: "a4",
    semantic: {
      from: "end",
      to: "activity",
      routing: "orthogonal",
    },
    visual: { width: 0, height: 0 },
  });
  return {
    participant,
    end,
    activity,
    flow,
    document: document([participant, end, activity, flow], [page]),
  };
};

describe("BPMN Editor intent methods", () => {
  test("undo and redo restore an illegal stored end-event flow without validation", () => {
    const fixture = illegalEndFlowFixture();
    const editor = new Editor({
      document: fixture.document,
      idSource: counterIds(),
      rng: seededRng(),
    });
    const originalEnd = structuredClone(editor.store.get("end"));
    const originalFlow = structuredClone(editor.store.get("illegal-flow"));
    editor.deleteElements(["end"]);
    expect(editor.store.get("end")).toBeUndefined();
    expect(editor.store.get("illegal-flow")).toBeUndefined();
    expect(() => editor.undo()).not.toThrow();
    expect(editor.store.get("end")).toEqual(originalEnd);
    expect(editor.store.get("illegal-flow")).toEqual(originalFlow);
    expect(() => editor.redo()).not.toThrow();
    expect(editor.store.get("end")).toBeUndefined();
    expect(editor.store.get("illegal-flow")).toBeUndefined();
  });

  test("clipboard paste and duplicate preserve an illegal flow and endpoints", () => {
    const fixture = illegalEndFlowFixture();
    const editor = new Editor({
      document: fixture.document,
      idSource: counterIds(),
      rng: seededRng(),
    });
    const selection = ["p", "end", "activity", "illegal-flow"];
    const expectedTypes = [
      "bpmn.event",
      "bpmn.participant",
      "bpmn.sequenceFlow",
      "bpmn.task",
    ];
    editor.selection.set(selection);
    expect(editor.copySelection()).toBe(true);
    const pasted = editor.paste();
    expect(pasted.map((id) => editor.store.get(id)?.type).sort()).toEqual(
      expectedTypes,
    );
    editor.selection.set(selection);
    const duplicated = editor.duplicateSelection();
    expect(duplicated.map((id) => editor.store.get(id)?.type).sort()).toEqual(
      expectedTypes,
    );
  });

  test("legal connect undo and redo retain the created flow id", () => {
    const editor = new Editor({
      document: document(
        [pool("p", "a1"), task("a", "p", "a2"), task("b", "p", "a3")],
        [page],
      ),
      idSource: counterIds(),
      rng: seededRng(),
    });
    const result = editor.connectBpmn("a", "b");
    expect(result).toMatchObject({ ok: true, type: "bpmn.sequenceFlow" });
    if (!result.ok) return;
    expect(editor.store.get(result.id)?.type).toBe("bpmn.sequenceFlow");
    expect(editor.undo()).toBe(true);
    expect(editor.store.get(result.id)).toBeUndefined();
    expect(editor.redo()).toBe(true);
    expect(editor.store.get(result.id)?.type).toBe("bpmn.sequenceFlow");
  });

  test("corrects cross-pool flow requests and rejects start/end violations", () => {
    const editor = makeEditor({
      document: document(
        [
          pool("p1", "a1"),
          task("a", "p1", "a2"),
          task("b", "p1", "a3"),
          element({
            id: "start",
            type: "bpmn.event",
            index: "a4",
            semantic: { position: "start", definitions: [], parent: "p1" },
            visual: { x: 0, y: 0, width: 36, height: 36 },
          }),
          element({
            id: "end",
            type: "bpmn.event",
            index: "a5",
            semantic: { position: "end", definitions: [], parent: "p1" },
            visual: { x: 0, y: 0, width: 36, height: 36 },
          }),
          pool("p2", "a6"),
          task("c", "p2", "a7"),
        ],
        [page],
      ),
    });
    const samePool = editor.connectBpmn("a", "b", "bpmn.messageFlow");
    expect(samePool).toMatchObject({
      ok: true,
      type: "bpmn.sequenceFlow",
    });
    const crossPool = editor.connectBpmn("a", "c", "bpmn.sequenceFlow");
    expect(crossPool).toMatchObject({
      ok: true,
      type: "bpmn.messageFlow",
    });
    const count = editor.store.listElements().length;
    expect(editor.connectBpmn("a", "start")).toMatchObject({
      ok: false,
      code: "bpmn.connection.startEventIncoming",
    });
    expect(editor.connectBpmn("end", "a")).toMatchObject({
      ok: false,
      code: "bpmn.connection.endEventOutgoing",
    });
    expect(editor.connectSmart("a", "start")).toBeNull();
    expect(editor.store.listElements()).toHaveLength(count);
  });

  test("corrects connections, reports rejections and connectSmart delegates", () => {
    const editor = makeEditor({
      document: document(
        [pool("p1", "a1"), task("a", "p1", "a2"), task("b", "p1", "a3")],
        [page],
      ),
    });
    const rejected: string[] = [];
    const unsubscribe = editor.onBpmnRejection((entry) =>
      rejected.push(entry.code),
    );
    const connected = editor.connectBpmn("a", "b", "bpmn.messageFlow");
    expect(connected).toMatchObject({ ok: true, type: "bpmn.sequenceFlow" });
    const smart = editor.connectSmart("a", "b");
    expect(smart).not.toBeNull();
    if (smart) expect(editor.store.get(smart)?.type).toBe("bpmn.sequenceFlow");
    const duplicate = editor.connectSmart("missing", "b");
    expect(duplicate).toBeNull();
    const start = editor.createElement("bpmn.event", {
      page: page.id,
      semantic: { position: "start", definitions: [], parent: "p1" },
      visual: { x: 0, y: 0, width: 36, height: 36 },
    });
    expect(editor.connectBpmn("a", start)).toMatchObject({
      ok: false,
      code: "bpmn.connection.startEventIncoming",
    });
    expect(rejected).toEqual(["bpmn.connection.startEventIncoming"]);
    unsubscribe();
    expect(editor.connectBpmn("a", start)).toMatchObject({ ok: false });
    expect(rejected).toHaveLength(1);
  });

  test("reconnects a sequence flow across pools as a message flow with the same id", () => {
    const editor = new Editor({
      document: document(
        [
          pool("p1", "a1"),
          task("a", "p1", "a2"),
          task("b", "p1", "a3"),
          pool("p2", "a4"),
          task("c", "p2", "a5"),
          element({
            id: "note",
            type: "bpmn.textAnnotation",
            index: "a6",
            semantic: { text: "Flow note" },
            visual: { x: 240, y: 40, width: 80, height: 30 },
          }),
        ],
        [page],
      ),
      idSource: counterIds(),
    });
    const flow = editor.connectBpmn("a", "b");
    expect(flow.ok).toBe(true);
    if (!flow.ok) return;
    const association = editor.connectBpmn("note", flow.id);
    expect(association).toMatchObject({ ok: true, type: "bpmn.association" });
    if (!association.ok) return;
    const associationSemantic = editor.store.get(association.id)?.semantic;
    const updated = editor.reconnectBpmnFlow(flow.id, "to", "c");
    expect(updated).toMatchObject({
      ok: true,
      id: flow.id,
      type: "bpmn.messageFlow",
    });
    expect(editor.store.get(flow.id)?.semantic).toMatchObject({
      from: "a",
      to: "c",
    });
    expect(editor.store.get(association.id)?.semantic).toEqual(
      associationSemantic,
    );
    editor.undo();
    expect(editor.store.get(flow.id)).toMatchObject({
      type: "bpmn.sequenceFlow",
      semantic: { from: "a", to: "b" },
    });
    expect(editor.store.get(association.id)?.semantic).toEqual(
      associationSemantic,
    );
  });

  test("semantic edits retain identity and event flow guards; BPMN text fields map", () => {
    const editor = makeEditor({
      document: document(
        [
          pool("p", "a1"),
          task("task", "p", "a2"),
          element({
            id: "event",
            type: "bpmn.event",
            index: "a3",
            semantic: {
              name: "Catch",
              position: "intermediateCatch",
              definitions: [],
              parent: "p",
            },
            visual: { x: 160, y: 40, width: 36, height: 36 },
          }),
          element({
            id: "note",
            type: "bpmn.textAnnotation",
            index: "a4",
            semantic: { text: "Note" },
            visual: { x: 0, y: 0, width: 40, height: 30 },
          }),
        ],
        [page],
      ),
    });
    const flow = editor.connectBpmn("task", "event");
    expect(flow.ok).toBe(true);
    if (!flow.ok) return;
    const originalFlowSemantic = structuredClone(
      editor.store.get(flow.id)?.semantic,
    );
    const result = editor.updateBpmnSemantic("event", {
      name: "Throw",
      position: "intermediateThrow",
      definitions: [],
      parent: "p",
    });
    expect(result).toMatchObject({ ok: true, id: "event" });
    expect(editor.store.get("event")?.id).toBe("event");
    expect(editor.store.get(flow.id)?.semantic).toEqual(originalFlowSemantic);
    const originalEventSemantic = structuredClone(
      editor.store.get("event")?.semantic,
    );
    expect(editor.editableField("task")).toBe("name");
    expect(editor.editableField("note")).toBe("text");
    expect(
      editor.updateBpmnSemantic("event", {
        position: "start",
        definitions: [],
        parent: "p",
      }),
    ).toMatchObject({ ok: false, code: "bpmn.connection.startEventIncoming" });
    expect(editor.store.get("event")?.semantic).toEqual(originalEventSemantic);

    const taskSemantic = editor.store.get("task")?.semantic as Record<
      string,
      unknown
    >;
    const serviceEdit = editor.updateBpmnSemantic("task", {
      ...taskSemantic,
      taskType: "service",
    });
    expect(serviceEdit).toMatchObject({
      ok: true,
      id: "task",
      type: "bpmn.task",
    });
    expect(editor.store.get("task")?.id).toBe("task");
    expect(editor.store.get("task")?.semantic).toMatchObject({
      taskType: "service",
    });
    expect(editor.store.get(flow.id)?.semantic).toMatchObject({
      from: "task",
      to: "event",
    });
  });
});
