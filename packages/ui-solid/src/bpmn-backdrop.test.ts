import { describe, expect, test } from "bun:test";
import { connectorBackdropIds, Editor, groupOf } from "@diagra/core";

function editorWithFlow() {
  const editor = new Editor();
  const pageId = editor.createPage({ kind: "bpmn", name: "Process" });
  const pool = editor.createElement("bpmn.participant", {
    semantic: { name: "Pool", collapsed: false },
    visual: { x: 0, y: 0, width: 600, height: 300 },
  });
  const lane1 = editor.createElement("bpmn.lane", {
    semantic: { name: "Requester", parent: pool },
    visual: { x: 30, y: 0, width: 570, height: 150 },
  });
  const lane2 = editor.createElement("bpmn.lane", {
    semantic: { name: "Approver", parent: pool },
    visual: { x: 30, y: 150, width: 570, height: 150 },
  });
  const task1 = editor.createElement("bpmn.task", {
    semantic: { name: "Submit", taskType: "none", loop: "none", parent: lane1 },
    visual: { x: 100, y: 50, width: 100, height: 80 },
  });
  const task2 = editor.createElement("bpmn.task", {
    semantic: { name: "Review", taskType: "none", loop: "none", parent: lane2 },
    visual: { x: 380, y: 200, width: 100, height: 80 },
  });
  return { editor, pageId, pool, lane1, lane2, task1, task2 };
}

describe("BPMN canvas connector backdrops", () => {
  test("partitions pools and lanes before connectors without changing z-order", () => {
    const { editor, pageId, pool, lane1, lane2, task1, task2 } =
      editorWithFlow();
    editor.createElement("bpmn.sequenceFlow", {
      semantic: { from: task1, to: task2 },
    });
    const elements = editor.store.getPageElements(pageId);
    const backdropIds = connectorBackdropIds(
      elements,
      (id) => groupOf(editor.store, id) !== null,
    );
    expect(backdropIds).toEqual(new Set([pool, lane1, lane2]));

    const backdropOrder = elements
      .filter((element) => backdropIds.has(element.id))
      .map((element) => element.id);
    expect(backdropOrder).toEqual([pool, lane1, lane2]);
    const visualRoots = elements
      .filter(
        (element) =>
          !backdropIds.has(element.id) &&
          element.type !== "bpmn.sequenceFlow" &&
          element.type !== "bpmn.messageFlow" &&
          element.type !== "bpmn.association" &&
          element.type !== "bpmn.dataAssociation" &&
          groupOf(editor.store, element.id) === null,
      )
      .map((element) => element.id);
    expect(visualRoots).toEqual([task1, task2]);
  });

  test("does not lower surfaces on a page without connectors", () => {
    const { editor, pageId } = editorWithFlow();
    const elements = editor.store
      .getPageElements(pageId)
      .filter((element) => element.type !== "bpmn.sequenceFlow");
    expect(
      connectorBackdropIds(
        elements,
        (id) => groupOf(editor.store, id) !== null,
      ),
    ).toEqual(new Set());
  });
});
