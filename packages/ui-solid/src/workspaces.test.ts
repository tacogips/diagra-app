import { expect, test } from "bun:test";
import { canUseTool, creationFor, isConnectorTool } from "./tools.ts";
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
    "edge",
  ]);
  expect(workspaceById("class").tools.map((entry) => entry.tool)).toEqual([
    "uml.class",
    "edge",
  ]);
  expect(workspaceById("sequence").tools.map((entry) => entry.tool)).toEqual([
    "sequence.actor",
    "sequence.service",
    "sequence.database",
    "edge",
  ]);
  for (const workspace of WORKSPACES.filter((entry) => !entry.design)) {
    for (const { tool } of workspace.tools) {
      expect(canUseTool(tool, true)).toBe(false);
      expect(canUseTool(tool, false)).toBe(true);
      if (!isConnectorTool(tool)) expect(creationFor(tool)).not.toBeNull();
    }
  }
});
