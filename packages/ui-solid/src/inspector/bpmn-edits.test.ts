import { describe, expect, test } from "bun:test";
import { Editor, buildBpmnModel } from "@nodetto/core";
import {
  disabledEventPositions,
  withDefinitionKinds,
  withField,
} from "./bpmn-edits.ts";

const page = { id: "page", name: "Flow", kind: "bpmn" as const };

function editorFixture(): Editor {
  return new Editor({
    document: {
      schemaVersion: 1,
      id: "doc",
      title: "Flow",
      pages: [page],
      elements: [
        {
          id: "pool",
          page: "page",
          type: "bpmn.participant",
          index: "a1",
          semantic: { name: "Pool", collapsed: false },
          visual: {},
        },
        {
          id: "task",
          page: "page",
          type: "bpmn.task",
          index: "a2",
          semantic: {
            name: "Task",
            taskType: "user",
            loop: "none",
            parent: "pool",
          },
          visual: {},
        },
        {
          id: "event",
          page: "page",
          type: "bpmn.event",
          index: "a3",
          semantic: {
            name: "Catch",
            position: "intermediateCatch",
            definitions: [{ id: "message-id", kind: "message" }],
            parent: "pool",
          },
          visual: {},
        },
        {
          id: "flow",
          page: "page",
          type: "bpmn.sequenceFlow",
          index: "a4",
          semantic: { from: "task", to: "event", routing: "orthogonal" },
          visual: {},
        },
      ],
    },
  });
}

describe("BPMN inspector semantic edits", () => {
  test("withField removes an optional field when it is cleared", () => {
    expect(
      withField({ name: "a", parent: "lane" }, "parent", undefined),
    ).toEqual({
      name: "a",
    });
  });

  test("definition selection preserves ids and initializes new timers", () => {
    const semantic = {
      definitions: [{ id: "d1", kind: "message" }],
    };
    const next = withDefinitionKinds(semantic, ["message", "timer"], "event-1");
    const definitions = next["definitions"] as {
      id: string;
      kind: string;
      timer?: { type: string; value: string };
    }[];
    expect(definitions[0]).toEqual({ id: "d1", kind: "message" });
    expect(definitions[1]).toMatchObject({
      id: "def-event-1-1",
      kind: "timer",
      timer: { type: "duration", value: "" },
    });
    expect(withDefinitionKinds(next, [], "event-1")["definitions"]).toEqual([]);
  });

  test("disabled positions reflect incoming and outgoing sequence flows", () => {
    const editor = editorFixture();
    const disabled = disabledEventPositions(
      buildBpmnModel(editor.store.getSnapshot(), "page"),
      "event",
    );
    expect(disabled.has("start")).toBe(true);
    expect(disabled.has("end")).toBe(false);
  });

  test("event and task type switches update the same element and keep flows", () => {
    const editor = editorFixture();
    const oldFlow = structuredClone(editor.store.get("flow")?.semantic);
    const event = editor.store.get("event");
    expect(event).toBeDefined();
    const switchedEvent = editor.updateBpmnSemantic(
      "event",
      withField(event?.semantic, "position", "intermediateThrow"),
    );
    expect(switchedEvent).toMatchObject({ ok: true, id: "event" });
    expect(editor.store.get("event")?.id).toBe("event");
    expect(editor.store.get("flow")?.semantic).toEqual(oldFlow);

    const task = editor.store.get("task");
    expect(task).toBeDefined();
    const switchedTask = editor.updateBpmnSemantic(
      "task",
      withField(task?.semantic, "taskType", "service"),
    );
    expect(switchedTask).toMatchObject({ ok: true, id: "task" });
    expect(editor.store.get("task")?.id).toBe("task");
    expect(editor.store.get("task")?.semantic).toMatchObject({
      taskType: "service",
    });
    expect(editor.store.get("flow")?.semantic).toEqual(oldFlow);
  });

  test("incoming sequence flow prevents changing an event to start", () => {
    const editor = editorFixture();
    const before = structuredClone(editor.store.get("event")?.semantic);
    const result = editor.updateBpmnSemantic(
      "event",
      withField(editor.store.get("event")?.semantic, "position", "start"),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "bpmn.connection.startEventIncoming",
    });
    expect(editor.store.get("event")?.semantic).toEqual(before);
  });
});
