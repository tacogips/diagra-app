import {
  workspaceShapes,
  additionalShapes,
  artboardShapes,
  shapePaletteGroups,
} from "./shape-palette.ts";
import { expect, test } from "bun:test";
import {
  canUseTool,
  creationFor,
  isConnectorTool,
  BPMN_TOOLS,
  Tool,
} from "./tools.ts";
import {
  WORKSPACES,
  WORKSPACE_STORAGE_KEY,
  readWorkspacePreference,
  workspaceById,
  writeWorkspacePreference,
} from "./workspaces.ts";

test("missing, stale and inaccessible preferences use the general diagram workspace", () => {
  expect(readWorkspacePreference(undefined)).toBe("flow");
  expect(readWorkspacePreference({ getItem: () => "removed-mode" })).toBe(
    "flow",
  );
  expect(
    readWorkspacePreference({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
  ).toBe("flow");
  expect(() =>
    writeWorkspacePreference(
      {
        setItem: () => {
          throw new Error("quota");
        },
      },
      "erd",
    ),
  ).not.toThrow();
});

test("every workspace preference round-trips", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  for (const workspace of WORKSPACES) {
    writeWorkspacePreference(storage, workspace.id);
    expect(values.get(WORKSPACE_STORAGE_KEY)).toBe(workspace.id);
    expect(readWorkspacePreference(storage)).toBe(workspace.id);
  }
});

test("semantic workspaces promote their own authoring tools and share endpoint-aware connectors", () => {
  expect(workspaceById("erd").tools.map((entry) => entry.tool)).toEqual([
    "erd.table",
    Tool.ForeignKey,
  ]);
  expect(workspaceById("class").tools.map((entry) => entry.tool)).toEqual([
    "uml.class",
    Tool.Association,
  ]);
  expect(workspaceById("sequence").tools.map((entry) => entry.tool)).toEqual([
    "sequence.actor",
    "sequence.service",
    "sequence.database",
    Tool.SequenceMessage,
  ]);
  for (const workspace of WORKSPACES.filter((entry) => !entry.design)) {
    for (const { tool } of workspace.tools) {
      expect(canUseTool(tool, true)).toBe(false);
      expect(canUseTool(tool, false)).toBe(true);
      if (!isConnectorTool(tool)) expect(creationFor(tool)).not.toBeNull();
    }
  }
});

test("BPMN workspace prioritizes common process tools and retains every template", () => {
  const primary = workspaceShapes("bpmn").map((item) => item.tool);
  expect(primary).toEqual([
    Tool.BpmnStartEvent,
    Tool.BpmnTask,
    Tool.BpmnExclusiveGateway,
    Tool.BpmnEndEvent,
    Tool.BpmnPool,
    Tool.BpmnLane,
    Tool.Connector,
    Tool.Text,
    Tool.Frame,
  ]);
  const all = [
    ...primary,
    ...additionalShapes("bpmn").map((item) => item.tool),
  ];
  expect(new Set(all).size).toBe(all.length);
  for (const tool of BPMN_TOOLS) expect(all).toContain(tool);
});

test("General is first and provides cross-diagram drawing without a mode switch", () => {
  expect(WORKSPACES[0].id).toBe("flow");
  expect(WORKSPACES[0].label).toBe("General");
  expect(workspaceById(undefined).id).toBe("flow");
  expect(workspaceById("flow").design).toBe(true);
  const tools = workspaceShapes("flow").map((shape) => shape.tool);
  for (const tool of [
    Tool.Rectangle,
    Tool.Table,
    Tool.Class,
    Tool.Actor,
    Tool.Component,
  ])
    expect(tools).toContain(tool);
});

test("palette categories separate notations without losing or duplicating tools", () => {
  for (const { id } of WORKSPACES) {
    const groups = shapePaletteGroups(id);
    const tools = groups.flatMap((group) =>
      group.items.map((item) => item.tool),
    );
    expect(new Set(tools).size).toBe(tools.length);
    for (const item of [
      ...workspaceShapes(id),
      ...additionalShapes(id),
      ...artboardShapes(id),
    ])
      expect(tools).toContain(item.tool);
  }
  const general = shapePaletteGroups("flow");
  expect(general[0]?.label).toBe("General");
  expect(
    general
      .find((group) => group.label === "General")
      ?.items.map((item) => item.tool),
  ).not.toContain(Tool.Component);
  expect(
    general
      .find((group) => group.label === "UML")
      ?.items.map((item) => item.tool),
  ).toEqual(expect.arrayContaining([Tool.Component, Tool.Class, Tool.Port]));
  expect(shapePaletteGroups("component")[0]?.label).toBe("UML");
  expect(shapePaletteGroups("erd")[0]?.label).toBe("ERD");
  expect(shapePaletteGroups("sequence")[0]?.label).toBe("Sequence");
});

test("ERD foreign keys stay beside tables and General provides a separate Note tool", () => {
  const erd = shapePaletteGroups("erd").find((group) => group.label === "ERD");
  expect(erd?.items.map((item) => item.label)).toEqual([
    "Table",
    "View",
    "Materialized view",
    "Function",
    "Procedure",
    "Foreign key",
  ]);
  const general = shapePaletteGroups("flow").find(
    (group) => group.label === "General",
  );
  expect(general?.items.map((item) => item.tool)).toEqual(
    expect.arrayContaining([Tool.Text, Tool.Note]),
  );
  const note = creationFor(Tool.Note);
  expect(note?.type).toBe("text.note");
  expect(note?.visual?.style?.fill).toBe("#fff1c9");
});
