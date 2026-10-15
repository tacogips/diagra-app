import { describe, expect, test } from "bun:test";
import { Editor } from "../editor.ts";
import { bpmnRouteResolver } from "./routes.ts";
import { document, element, TEST_PAGE } from "../test-helpers.ts";

describe("bpmnRouteResolver", () => {
  test("returns connector waypoints between BPMN shape boundaries", () => {
    const source = element({
      id: "source",
      type: "bpmn.task",
      index: "a1",
      semantic: { name: "Start", taskType: "user", loop: "none" },
      visual: { x: 0, y: 0, width: 100, height: 80 },
    });
    const target = element({
      id: "target",
      type: "bpmn.task",
      index: "a2",
      semantic: { name: "Finish", taskType: "user", loop: "none" },
      visual: { x: 240, y: 0, width: 100, height: 80 },
    });
    const edge = element({
      id: "edge",
      type: "bpmn.sequenceFlow",
      index: "a3",
      semantic: { from: source.id, to: target.id },
    });
    const editor = new Editor({
      document: document(
        [source, target, edge],
        [{ ...TEST_PAGE, kind: "bpmn" }],
      ),
    });
    const points = bpmnRouteResolver(editor)(edge);
    expect(points?.length).toBeGreaterThanOrEqual(2);
    expect(points?.[0]?.x).toBe(100);
    expect(points?.at(-1)?.x).toBe(240);
  });
});
