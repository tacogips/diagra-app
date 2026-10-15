import { describe, expect, test } from "bun:test";
import { buildBpmnModel } from "./model.ts";
import { document, element } from "../test-helpers.ts";

function model(items: Parameters<typeof element>[0][]) {
  return buildBpmnModel(
    document(
      items.map((item) => element(item)),
      [{ id: "page-1", name: "BPMN", kind: "bpmn" }],
    ),
    "page-1",
  );
}

describe("BpmnModel", () => {
  test("resolves lanes, participant, nested subprocess and boundary host scope", () => {
    const view = model([
      {
        id: "pool",
        type: "bpmn.participant",
        index: "a1",
        semantic: { collapsed: false },
      },
      {
        id: "lane",
        type: "bpmn.lane",
        index: "a2",
        semantic: { parent: "pool" },
      },
      {
        id: "sub",
        type: "bpmn.subProcess",
        index: "a3",
        semantic: { parent: "lane", expanded: true },
      },
      {
        id: "task",
        type: "bpmn.task",
        index: "a4",
        semantic: { parent: "sub" },
      },
      {
        id: "boundary",
        type: "bpmn.boundaryEvent",
        index: "a5",
        semantic: { attachedTo: "task" },
      },
    ]);
    expect(view.participantOf("task")).toBe("pool");
    expect(view.scopeOf("task")).toBe("sub");
    expect(view.scopeOf("boundary")).toBe("sub");
    expect(view.descendantsOf("pool")).toEqual([
      "lane",
      "sub",
      "task",
      "boundary",
    ]);
    expect(view.scopes()).toEqual(["pool", "sub"]);
  });
  test("uses page scope without a pool, filters sequence flows, and stops cycles", () => {
    const view = model([
      { id: "a", type: "bpmn.lane", index: "a1", semantic: { parent: "a" } },
      {
        id: "task",
        type: "bpmn.task",
        index: "a2",
        semantic: { taskType: "none", loop: "none" },
      },
      {
        id: "seq",
        type: "bpmn.sequenceFlow",
        index: "a3",
        semantic: { from: "task", to: "task" },
      },
      {
        id: "msg",
        type: "bpmn.messageFlow",
        index: "a4",
        semantic: { from: "task", to: "task" },
      },
      {
        id: "assoc",
        type: "bpmn.association",
        index: "a5",
        semantic: { from: "task", to: "task", direction: "none" },
      },
    ]);
    expect(view.scopeOf("task")).toBe("page-1");
    expect(view.scopes()).toContain("page-1");
    expect(view.participantOf("a")).toBeUndefined();
    expect(view.incoming("task").map((flow) => flow.id)).toEqual(["seq"]);
    expect(view.outgoing("task").map((flow) => flow.id)).toEqual(["seq"]);
  });
  test("includes collapsed sub-process scopes and excludes collapsed participants", () => {
    const view = model([
      {
        id: "expanded-pool",
        type: "bpmn.participant",
        index: "a1",
        semantic: { collapsed: false },
      },
      {
        id: "expanded-lane",
        type: "bpmn.lane",
        index: "a2",
        semantic: { parent: "expanded-pool" },
      },
      {
        id: "collapsed-sub",
        type: "bpmn.subProcess",
        index: "a3",
        semantic: {
          parent: "expanded-lane",
          expanded: false,
          triggeredByEvent: false,
          adHoc: false,
          loop: "none",
        },
      },
      {
        id: "task-in-sub",
        type: "bpmn.task",
        index: "a4",
        semantic: { parent: "collapsed-sub", taskType: "none", loop: "none" },
      },
      {
        id: "collapsed-pool",
        type: "bpmn.participant",
        index: "a5",
        semantic: { collapsed: true },
      },
      {
        id: "sub-in-collapsed-pool",
        type: "bpmn.subProcess",
        index: "a6",
        semantic: {
          parent: "collapsed-pool",
          expanded: false,
          triggeredByEvent: false,
          adHoc: false,
          loop: "none",
        },
      },
      {
        id: "task-in-collapsed-pool",
        type: "bpmn.task",
        index: "a7",
        semantic: {
          parent: "sub-in-collapsed-pool",
          taskType: "none",
          loop: "none",
        },
      },
    ]);
    expect(view.scopeOf("task-in-sub")).toBe("collapsed-sub");
    expect(view.scopeOf("task-in-collapsed-pool")).toBe(
      "sub-in-collapsed-pool",
    );
    expect(view.scopes()).toEqual([
      "expanded-pool",
      "collapsed-sub",
      "sub-in-collapsed-pool",
    ]);
  });
});
