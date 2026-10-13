import { describe, expect, test } from "bun:test";
import { Editor } from "../editor.ts";
import { compareFractional } from "../fractional.ts";
import {
  counterIds,
  document,
  element,
  makeEditor,
  seededRng,
} from "../test-helpers.ts";

const page = { id: "page-1", name: "BPMN", kind: "bpmn" as const };
const pool = element({
  id: "pool",
  type: "bpmn.participant",
  index: "a1",
  semantic: { name: "Pool", collapsed: false },
  visual: { x: 0, y: 0, width: 600, height: 360 },
});
const lane = (id: string, index: string, parent = "pool", y = 0) =>
  element({
    id,
    type: "bpmn.lane",
    index,
    semantic: { name: id, parent },
    visual: { x: 30, y, width: 570, height: 120 },
  });
const task = (id: string, index: string, parent: string, y: number) =>
  element({
    id,
    type: "bpmn.task",
    index,
    semantic: { name: id, taskType: "user", loop: "none", parent },
    visual: { x: 60, y, width: 100, height: 60 },
  });

describe("BPMN containment planning", () => {
  test("lane resize restacks siblings, translates members, clamps and undoes together", () => {
    const editor = makeEditor({
      document: document(
        [
          pool,
          lane("a", "a2", "pool", 0),
          lane("b", "a3", "pool", 120),
          lane("c", "a4", "pool", 240),
          task("task", "a5", "b", 140),
        ],
        [page],
      ),
    });
    const originalPool = structuredClone(editor.store.get("pool"));
    const originalA = structuredClone(editor.store.get("a"));
    const originalB = structuredClone(editor.store.get("b"));
    const originalC = structuredClone(editor.store.get("c"));
    const originalTask = structuredClone(editor.store.get("task"));
    editor.apply([{ type: "updateVisual", id: "a", visual: { height: 200 } }]);
    expect(editor.store.get("pool")?.visual.height).toBe(440);
    expect(editor.store.get("b")?.visual.y).toBe(200);
    expect(editor.store.get("c")?.visual.y).toBe(320);
    expect(editor.store.get("task")?.visual.y).toBe(220);
    expect(editor.store.get("task")?.semantic).toMatchObject({ parent: "b" });
    editor.undo();
    expect(editor.store.get("a")?.visual.height).toBe(120);
    expect(editor.store.get("b")?.visual.y).toBe(120);
    expect(editor.store.get("pool")?.visual.height).toBe(360);
    expect(editor.store.get("task")?.visual.y).toBe(140);
    expect(editor.store.get("pool")).toEqual(originalPool);
    expect(editor.store.get("a")).toEqual(originalA);
    expect(editor.store.get("b")).toEqual(originalB);
    expect(editor.store.get("c")).toEqual(originalC);
    expect(editor.store.get("task")).toEqual(originalTask);
    editor.apply([{ type: "updateVisual", id: "a", visual: { height: 10 } }]);
    expect(editor.store.get("a")?.visual.height).toBe(30);
    expect(editor.store.get("pool")?.visual.height).toBe(270);
  });

  test("adding lanes places them above the container and below its members", () => {
    const editor = new Editor({
      document: document([pool, task("task", "a2", "pool", 100)], [page]),
      idSource: counterIds(),
      rng: seededRng(),
    });
    const first = editor.addBpmnLane("pool");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(editor.store.get(first.id)?.visual).toMatchObject({
      x: 30,
      y: 0,
      width: 570,
      height: 360,
    });
    expect(editor.store.get("task")?.semantic).toMatchObject({
      parent: first.id,
    });
    expect(
      compareFractional(
        editor.store.get("pool")!.index,
        editor.store.get(first.id)!.index,
      ),
    ).toBeLessThan(0);
    expect(
      compareFractional(
        editor.store.get(first.id)!.index,
        editor.store.get("task")!.index,
      ),
    ).toBeLessThan(0);
    expect(editor.hitTest({ x: 70, y: 110 })).toBe("task");
    const second = editor.addBpmnLane("pool");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(
      compareFractional(
        editor.store.get(first.id)!.index,
        editor.store.get(second.id)!.index,
      ),
    ).toBeLessThan(0);
    expect(
      compareFractional(
        editor.store.get(second.id)!.index,
        editor.store.get("task")!.index,
      ),
    ).toBeLessThan(0);
    expect(editor.store.get("pool")?.visual.height).toBe(480);
  });

  test("moving a task between lanes updates membership and undoes together", () => {
    const editor = makeEditor({
      document: document(
        [
          pool,
          lane("a", "a2", "pool", 0),
          lane("b", "a3", "pool", 120),
          task("task", "a4", "b", 140),
        ],
        [page],
      ),
    });
    editor.apply([{ type: "updateVisual", id: "task", visual: { y: 20 } }]);
    expect(editor.store.get("task")?.semantic).toMatchObject({ parent: "a" });
    expect(editor.store.get("task")?.visual.y).toBe(20);
    editor.undo();
    expect(editor.store.get("task")?.semantic).toMatchObject({ parent: "b" });
    expect(editor.store.get("task")?.visual.y).toBe(140);
  });

  test("creates membership from the center and removes parent outside the pool", () => {
    const editor = makeEditor({
      document: document(
        [pool, lane("l1", "a2", "pool", 0), lane("l2", "a3", "pool", 180)],
        [page],
      ),
    });
    const id = editor.createElement("bpmn.task", {
      page: page.id,
      semantic: { taskType: "user", loop: "none" },
      visual: { x: 80, y: 200, width: 100, height: 60 },
    });
    expect(editor.store.get(id)?.semantic).toMatchObject({ parent: "l2" });
    editor.apply([{ type: "updateVisual", id, visual: { x: 900, y: 900 } }]);
    const semantic = editor.store.get(id)?.semantic as Record<string, unknown>;
    expect("parent" in semantic).toBe(false);
  });

  test("keeps membership and deletion scoped to the element page", () => {
    const secondPage = { id: "page-2", name: "BPMN 2", kind: "bpmn" as const };
    const secondPool = element({ ...pool, id: "pool-2", page: secondPage.id });
    const editor = makeEditor({
      document: document(
        [pool, lane("lane-1", "a2", "pool", 0), secondPool],
        [page, secondPage],
      ),
    });
    const taskId = editor.createElement("bpmn.task", {
      page: secondPage.id,
      semantic: { taskType: "user", loop: "none" },
      visual: { x: 60, y: 100, width: 100, height: 60 },
    });
    expect(editor.store.get(taskId)?.semantic).toMatchObject({
      parent: "pool-2",
    });

    editor.deleteElements(["lane-1"]);
    expect(editor.store.get(taskId)?.semantic).toMatchObject({
      parent: "pool-2",
    });
    expect(editor.store.get(taskId)).toBeDefined();
    editor.deletePage(page.id);
    expect(editor.store.get(taskId)).toBeDefined();

    const withoutSecondPool = makeEditor({
      document: document(
        [pool, lane("lane-1", "a2", "pool", 0)],
        [page, secondPage],
      ),
    });
    const uncontainedTaskId = withoutSecondPool.createElement("bpmn.task", {
      page: secondPage.id,
      semantic: { taskType: "user", loop: "none" },
      visual: { x: 60, y: 100, width: 100, height: 60 },
    });
    const uncontainedSemantic = withoutSecondPool.store.get(uncontainedTaskId)
      ?.semantic as Record<string, unknown>;
    expect("parent" in uncontainedSemantic).toBe(false);
  });

  test("pool height resize restacks child lanes edge to edge", () => {
    const editor = makeEditor({
      document: document(
        [
          pool,
          element({
            id: "l1",
            type: "bpmn.lane",
            index: "a2",
            semantic: { name: "l1", parent: "pool" },
            visual: { x: 30, y: 0, width: 570, height: 180 },
          }),
          element({
            id: "l2",
            type: "bpmn.lane",
            index: "a3",
            semantic: { name: "l2", parent: "pool" },
            visual: { x: 30, y: 180, width: 570, height: 180 },
          }),
        ],
        [page],
      ),
    });
    editor.apply([
      { type: "updateVisual", id: "pool", visual: { height: 500 } },
    ]);
    expect(editor.store.get("l1")?.visual).toMatchObject({
      x: 30,
      y: 0,
      width: 570,
      height: 180,
    });
    expect(editor.store.get("l2")?.visual).toMatchObject({
      x: 30,
      y: 180,
      width: 570,
      height: 320,
    });
    const laneBottom =
      (editor.store.get("l2")?.visual.y ?? 0) +
      (editor.store.get("l2")?.visual.height ?? 0);
    expect(laneBottom).toBe(500);
    expect(editor.store.get("pool")?.visual.height).toBe(500);
  });

  test("moving a pool translates its lanes, contents and attached boundary events", () => {
    const flow = element({
      id: "flow",
      type: "bpmn.sequenceFlow",
      index: "a7",
      semantic: { from: "task", to: "nested-task", routing: "orthogonal" },
      visual: { width: 0, height: 0 },
    });
    const editor = makeEditor({
      document: document(
        [
          element({
            ...pool,
            visual: { x: 0, y: 0, width: 600, height: 300 },
          }),
          lane("lane", "a2", "pool", 0),
          element({
            ...task("task", "a3", "lane", 100),
            visual: { x: 60, y: 100, width: 100, height: 60 },
          }),
          element({
            id: "boundary",
            type: "bpmn.boundaryEvent",
            index: "a4",
            semantic: {
              attachedTo: "task",
              cancelActivity: true,
              definitions: [],
            },
            visual: { x: 142, y: 112, width: 36, height: 36 },
          }),
          element({
            id: "sub",
            type: "bpmn.subProcess",
            index: "a5",
            semantic: {
              name: "Subprocess",
              expanded: true,
              triggeredByEvent: false,
              adHoc: false,
              loop: "none",
              parent: "lane",
            },
            visual: { x: 200, y: 100, width: 200, height: 120 },
          }),
          element({
            ...task("nested-task", "a6", "sub", 130),
            visual: { x: 220, y: 130, width: 100, height: 60 },
          }),
          flow,
        ],
        [page],
      ),
    });
    editor.apply([
      { type: "updateVisual", id: "pool", visual: { x: 100, y: 50 } },
    ]);
    expect(editor.store.get("lane")?.visual).toMatchObject({ x: 130, y: 50 });
    expect(editor.store.get("task")?.visual).toMatchObject({ x: 160, y: 150 });
    expect(editor.store.get("sub")?.visual).toMatchObject({ x: 300, y: 150 });
    expect(editor.store.get("nested-task")?.visual).toMatchObject({
      x: 320,
      y: 180,
    });
    expect(editor.store.get("boundary")?.visual).toMatchObject({
      x: 242,
      y: 162,
    });
    expect(editor.store.get("flow")?.semantic).toEqual(flow.semantic);
  });

  test("nested lane resize restacks inner and outer siblings exactly once", () => {
    const editor = makeEditor({
      document: document(
        [
          pool,
          element({
            id: "outer-a",
            type: "bpmn.lane",
            index: "a2",
            semantic: { name: "outer-a", parent: "pool" },
            visual: { x: 30, y: 0, width: 570, height: 240 },
          }),
          lane("outer-b", "a3", "pool", 240),
          lane("inner-a", "a4", "outer-a", 0),
          lane("inner-b", "a5", "outer-a", 120),
          task("nested-task", "a6", "inner-b", 140),
        ],
        [page],
      ),
    });
    editor.apply([
      { type: "updateVisual", id: "inner-a", visual: { height: 160 } },
    ]);
    expect(editor.store.get("inner-b")?.visual.y).toBe(160);
    expect(editor.store.get("outer-a")?.visual.height).toBe(280);
    expect(editor.store.get("outer-b")?.visual.y).toBe(280);
    expect(editor.store.get("pool")?.visual.height).toBe(400);
    expect(editor.store.get("nested-task")?.visual.y).toBe(180);
    editor.undo();
    expect(editor.store.get("inner-a")?.visual.height).toBe(120);
    expect(editor.store.get("inner-b")?.visual.y).toBe(120);
    expect(editor.store.get("outer-a")?.visual.height).toBe(240);
    expect(editor.store.get("outer-b")?.visual.y).toBe(240);
    expect(editor.store.get("pool")?.visual.height).toBe(360);
    expect(editor.store.get("nested-task")?.visual.y).toBe(140);
  });
});
