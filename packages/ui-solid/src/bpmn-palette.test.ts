import { describe, expect, test } from "bun:test";
import { Editor } from "@nodetto/core";
import { validateDocument } from "@nodetto/ir";
import { createInteraction, type Interaction } from "./interaction.ts";
import { ACTION_MENUS, BPMN_TOOL_MENU, TOOL_MENUS } from "./Toolbar.tsx";
import {
  BPMN_TOOLS,
  canUseTool,
  creationFor,
  type BpmnToolKind,
  type CreationTool,
  type ToolKind,
} from "./tools.ts";

function editorOnBpmnPage(): Editor {
  const editor = new Editor();
  editor.createPage({ kind: "bpmn", name: "Process" });
  return editor;
}

function interactionFor(
  editor: Editor,
  initialTool: ToolKind,
): {
  interaction: Interaction;
  tool: () => ToolKind;
  setTool: (tool: ToolKind) => void;
} {
  let tool = initialTool;
  const interaction = createInteraction(editor, {
    tool: () => tool,
    setTool: (next) => {
      tool = next;
    },
    container: () => undefined,
  });
  return {
    interaction,
    tool: () => tool,
    setTool: (next) => {
      tool = next;
    },
  };
}

function pointer(clientX: number, clientY: number): PointerEvent {
  return {
    clientX,
    clientY,
    button: 0,
    pointerId: 1,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as unknown as PointerEvent;
}

function place(interaction: Interaction, x: number, y: number): void {
  interaction.onPointerDown(pointer(x, y));
}

describe("BPMN palette", () => {
  test("maps every BPMN tool to an ordered BPMN menu entry and creation", () => {
    const expected: Record<BpmnToolKind, CreationTool> = {
      "bpmn:pool": {
        type: "bpmn.participant",
        semantic: { name: "Pool", collapsed: false },
        visual: { width: 600, height: 250 },
      },
      "bpmn:pool-collapsed": {
        type: "bpmn.participant",
        semantic: { name: "Pool", collapsed: true },
        visual: { width: 600, height: 60 },
      },
      "bpmn:lane": { type: "bpmn.lane" },
      "bpmn:task": {
        type: "bpmn.task",
        semantic: { name: "Task", taskType: "none", loop: "none" },
      },
      "bpmn:user-task": {
        type: "bpmn.task",
        semantic: { name: "Task", taskType: "user", loop: "none" },
      },
      "bpmn:service-task": {
        type: "bpmn.task",
        semantic: { name: "Task", taskType: "service", loop: "none" },
      },
      "bpmn:start-event": {
        type: "bpmn.event",
        semantic: { name: "", position: "start", definitions: [] },
      },
      "bpmn:message-catch": {
        type: "bpmn.event",
        semantic: {
          name: "",
          position: "intermediateCatch",
          definitions: [{ id: "def-1", kind: "message" }],
        },
      },
      "bpmn:message-throw": {
        type: "bpmn.event",
        semantic: {
          name: "",
          position: "intermediateThrow",
          definitions: [{ id: "def-1", kind: "message" }],
        },
      },
      "bpmn:timer-catch": {
        type: "bpmn.event",
        semantic: {
          name: "",
          position: "intermediateCatch",
          definitions: [
            {
              id: "def-1",
              kind: "timer",
              timer: { type: "duration", value: "PT1H" },
            },
          ],
        },
      },
      "bpmn:end-event": {
        type: "bpmn.event",
        semantic: { name: "", position: "end", definitions: [] },
      },
      "bpmn:exclusive-gateway": {
        type: "bpmn.gateway",
        semantic: { name: "", gatewayType: "exclusive" },
      },
      "bpmn:parallel-gateway": {
        type: "bpmn.gateway",
        semantic: { name: "", gatewayType: "parallel" },
      },
      "bpmn:sub-process": {
        type: "bpmn.subProcess",
        semantic: {
          name: "Sub-process",
          expanded: false,
          triggeredByEvent: false,
          adHoc: false,
          loop: "none",
        },
      },
      "bpmn:sub-process-expanded": {
        type: "bpmn.subProcess",
        semantic: {
          name: "Sub-process",
          expanded: true,
          triggeredByEvent: false,
          adHoc: false,
          loop: "none",
        },
        visual: { width: 350, height: 200 },
      },
      "bpmn:call-activity": {
        type: "bpmn.callActivity",
        semantic: { name: "Call activity", loop: "none" },
      },
      "bpmn:data-object": {
        type: "bpmn.dataObject",
        semantic: { name: "Data object", role: "reference", collection: false },
      },
      "bpmn:data-store": {
        type: "bpmn.dataStore",
        semantic: { name: "Data store" },
      },
      "bpmn:text-annotation": {
        type: "bpmn.textAnnotation",
        semantic: { text: "" },
      },
      "bpmn:group": { type: "bpmn.group", semantic: { name: "" } },
    };
    expect(BPMN_TOOL_MENU.tools.map((item) => item.tool)).toEqual([
      ...BPMN_TOOLS,
    ]);
    expect(
      BPMN_TOOLS.every((tool) => {
        expect(creationFor(tool)).toEqual(expected[tool]);
        return creationFor(tool)?.type.startsWith("bpmn.");
      }),
    ).toBe(true);
    expect(canUseTool("bpmn:pool", true)).toBe(false);
    expect(canUseTool("bpmn:pool", false)).toBe(true);

    expect(
      TOOL_MENUS.map((menu) => [menu.id, menu.tools.map((item) => item.tool)]),
    ).toEqual([
      ["insert", ["draw.freehand", "text.note", "node.generic", "edge"]],
      ["shapes", ["geo:rect", "geo:ellipse", "geo:diamond", "geo:cylinder"]],
      [
        "diagram",
        [
          "erd.table",
          "uml.class",
          "sequence.actor",
          "sequence.service",
          "sequence.database",
        ],
      ],
      [
        "frames",
        [
          "frame:web",
          "frame:iphone",
          "frame:android",
          "frame:tablet",
          "frame:paper",
        ],
      ],
      ["edit", ["edit.points", "crop", "edit.paint", "edit.stroke-paint"]],
    ]);
    expect(
      ACTION_MENUS.map((menu) => [
        menu.id,
        menu.actions.map((item) => item.id),
      ]),
    ).toEqual([
      [
        "arrange",
        [
          "frameSelection",
          "group",
          "booleanUnion",
          "booleanSubtract",
          "booleanIntersect",
          "booleanExclude",
          "flattenBoolean",
          "ungroup",
          "alignLeft",
          "alignHCenter",
          "alignRight",
          "alignTop",
          "alignVCenter",
          "alignBottom",
          "tidyLayout",
          "removeOverlaps",
        ],
      ],
      ["export", ["exportSvg"]],
    ]);
  });

  test("every non-lane tool places one valid BPMN element", () => {
    for (const tool of BPMN_TOOLS) {
      if (tool === "bpmn:lane") continue;
      const editor = editorOnBpmnPage();
      const { interaction } = interactionFor(editor, tool);
      place(interaction, 300, 200);
      const elements = editor.store.getPageElements(editor.currentPageId);
      expect(elements).toHaveLength(1);
      expect(elements[0]?.type.startsWith("bpmn.")).toBe(true);
      expect(
        validateDocument(editor.getSnapshot()).filter(
          (issue) => issue.severity === "error",
        ),
      ).toEqual([]);
    }
  });

  test("lane placement adds a child to the innermost container and ignores empty canvas", () => {
    const editor = editorOnBpmnPage();
    const { interaction, tool, setTool } = interactionFor(editor, "bpmn:pool");
    place(interaction, 300, 200);
    const pool = editor.store.getPageElements(editor.currentPageId)[0];
    expect(pool?.type).toBe("bpmn.participant");
    if (!pool) throw new Error("expected pool");

    setTool("bpmn:lane");
    place(interaction, 300, 200);
    const lane = editor.store
      .getPageElements(editor.currentPageId)
      .find((element) => element.type === "bpmn.lane");
    expect(lane?.semantic).toMatchObject({ parent: pool.id });
    if (!lane) throw new Error("expected lane");
    const laneBounds = editor.getBounds(lane.id);
    if (!laneBounds) throw new Error("expected lane bounds");
    setTool("bpmn:lane");
    place(
      interaction,
      laneBounds.x + laneBounds.width / 2,
      laneBounds.y + laneBounds.height / 2,
    );
    const nestedLane = editor.store
      .getPageElements(editor.currentPageId)
      .find(
        (element) =>
          element.type === "bpmn.lane" &&
          (element.semantic as { parent?: string }).parent === lane.id,
      );
    expect(nestedLane?.semantic).toMatchObject({ parent: lane.id });
    if (!nestedLane) throw new Error("expected nested lane");
    const nestedBounds = editor.getBounds(nestedLane.id);
    if (!nestedBounds) throw new Error("expected nested lane bounds");
    setTool("bpmn:user-task");
    place(
      interaction,
      nestedBounds.x + nestedBounds.width / 2,
      nestedBounds.y + nestedBounds.height / 2,
    );
    const task = editor.store
      .getPageElements(editor.currentPageId)
      .find((element) => element.type === "bpmn.task");
    expect(task?.semantic).toMatchObject({ parent: nestedLane.id });

    const beforeEmptyPlacement = editor.store.getPageElements(
      editor.currentPageId,
    ).length;
    setTool("bpmn:lane");
    place(interaction, 1200, 900);
    expect(editor.store.getPageElements(editor.currentPageId)).toHaveLength(
      beforeEmptyPlacement,
    );
    expect(tool()).toBe("select");
  });

  test("message event definitions receive unique ids per placement", () => {
    const editor = editorOnBpmnPage();
    const { interaction, setTool } = interactionFor(
      editor,
      "bpmn:message-catch",
    );
    place(interaction, 100, 100);
    setTool("bpmn:message-catch");
    place(interaction, 300, 100);
    const ids = editor.store
      .getPageElements(editor.currentPageId)
      .flatMap((element) => {
        const semantic = element.semantic as {
          definitions?: readonly { id: string }[];
        };
        return semantic.definitions?.map((definition) => definition.id) ?? [];
      });
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  test("BPMN reconnect delegates and preserves the flow id when type changes", () => {
    const editor = editorOnBpmnPage();
    const poolA = editor.createElement("bpmn.participant", {
      semantic: { name: "A", collapsed: false },
      visual: { x: 0, y: 0, width: 400, height: 250 },
    });
    const poolB = editor.createElement("bpmn.participant", {
      semantic: { name: "B", collapsed: false },
      visual: { x: 500, y: 0, width: 400, height: 250 },
    });
    const taskA = editor.createElement("bpmn.task", {
      semantic: { name: "A", taskType: "user", loop: "none", parent: poolA },
      visual: { x: 50, y: 90, width: 100, height: 80 },
    });
    const oldTarget = editor.createElement("bpmn.task", {
      semantic: { name: "Old", taskType: "user", loop: "none", parent: poolA },
      visual: { x: 250, y: 90, width: 100, height: 80 },
    });
    const newTarget = editor.createElement("bpmn.task", {
      semantic: { name: "New", taskType: "user", loop: "none", parent: poolB },
      visual: { x: 650, y: 90, width: 100, height: 80 },
    });
    const flow = editor.createElement("bpmn.sequenceFlow", {
      semantic: { from: taskA, to: oldTarget, routing: "orthogonal" },
    });
    const { interaction } = interactionFor(editor, "select");
    interaction.startReconnect(flow, "to", pointer(300, 130));
    interaction.onPointerUp(pointer(700, 130));
    expect(editor.store.get(flow)?.type).toBe("bpmn.messageFlow");
    expect(editor.store.get(flow)?.semantic).toMatchObject({
      from: taskA,
      to: newTarget,
    });
    expect(editor.store.get(flow)?.id).toBe(flow);
  });

  test("connecting from an end event rejects without creating an element", () => {
    const editor = editorOnBpmnPage();
    const end = editor.createElement("bpmn.event", {
      semantic: { name: "", position: "end", definitions: [] },
      visual: { x: 0, y: 0, width: 36, height: 36 },
    });
    const task = editor.createElement("bpmn.task", {
      semantic: { name: "Task", taskType: "user", loop: "none" },
      visual: { x: 200, y: 0, width: 100, height: 80 },
    });
    const { interaction } = interactionFor(editor, "edge");
    const before = editor.store.getPageElements(editor.currentPageId).length;
    interaction.onPointerDown(pointer(18, 18));
    interaction.onPointerUp(pointer(250, 40));
    expect(editor.store.has(end)).toBe(true);
    expect(editor.store.has(task)).toBe(true);
    expect(editor.store.getPageElements(editor.currentPageId)).toHaveLength(
      before,
    );
  });

  test("generic edge reconnect keeps its existing endpoint update path", () => {
    const editor = new Editor();
    const source = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const oldTarget = editor.createElement("shape.geo", {
      visual: { x: 250, y: 0, width: 100, height: 100 },
    });
    const newTarget = editor.createElement("shape.geo", {
      visual: { x: 500, y: 0, width: 100, height: 100 },
    });
    const edge = editor.connect(source, oldTarget);
    if (!edge) throw new Error("expected generic edge");
    const { interaction } = interactionFor(editor, "select");
    interaction.startReconnect(edge, "to", pointer(300, 50));
    interaction.onPointerUp(pointer(550, 50));
    expect(editor.store.get(edge)?.type).toBe("edge.generic");
    expect(editor.store.get(edge)?.semantic).toMatchObject({
      from: source,
      to: newTarget,
    });
  });

  test("editor page creation supports the PageTabs BPMN action", () => {
    const editor = new Editor();
    const pageId = editor.createPage({ kind: "bpmn", name: "Process" });
    expect(editor.currentPageId).toBe(pageId);
    expect(editor.store.getPage(pageId)).toMatchObject({
      kind: "bpmn",
      name: "Process",
    });
  });
});
