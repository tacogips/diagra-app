import { Tool, type ToolKind } from "./tools.ts";

export type WorkspaceId =
  | "app"
  | "web"
  | "erd"
  | "class"
  | "component"
  | "sequence"
  | "flow"
  | "bpmn"
  | "all";
export interface Workspace {
  readonly id: WorkspaceId;
  readonly label: string;
  readonly design: boolean;
  readonly shapes: boolean;
  readonly tools: readonly {
    readonly tool: ToolKind;
    readonly label: string;
  }[];
}
export const WORKSPACES = [
  {
    id: "flow",
    label: "General",
    design: true,
    shapes: true,
    tools: [
      { tool: "node.generic", label: "Node" },
      { tool: "edge", label: "Connector" },
    ],
  },
  { id: "app", label: "App design", design: true, shapes: true, tools: [] },
  { id: "web", label: "Web design", design: true, shapes: true, tools: [] },
  {
    id: "erd",
    label: "ERD",
    design: false,
    shapes: false,
    tools: [
      { tool: "erd.table", label: "Table" },
      { tool: Tool.ForeignKey, label: "Foreign key" },
    ],
  },
  {
    id: "class",
    label: "UML class",
    design: false,
    shapes: false,
    tools: [
      { tool: "uml.class", label: "Class" },
      { tool: Tool.Association, label: "Association" },
    ],
  },
  {
    id: "sequence",
    label: "Sequence",
    design: false,
    shapes: false,
    tools: [
      { tool: "sequence.actor", label: "Actor" },
      { tool: "sequence.service", label: "Service" },
      { tool: "sequence.database", label: "Database" },
      { tool: Tool.SequenceMessage, label: "Message" },
    ],
  },
  {
    id: "component",
    label: "UML component",
    design: false,
    shapes: false,
    tools: [
      { tool: Tool.Component, label: "Component" },
      { tool: Tool.ProvidedInterface, label: "Provided interface" },
      { tool: Tool.RequiredInterface, label: "Required interface" },
      { tool: Tool.Port, label: "Port" },
      { tool: Tool.Dependency, label: "Dependency" },
      { tool: Tool.Realization, label: "Realization" },
      { tool: Tool.ComponentConnector, label: "Connector" },
    ],
  },
  {
    id: "bpmn",
    label: "BPMN",
    design: false,
    shapes: false,
    tools: [
      { tool: Tool.BpmnTask, label: "Task" },
      { tool: Tool.BpmnStartEvent, label: "Start event" },
      { tool: Tool.BpmnEndEvent, label: "End event" },
      { tool: Tool.BpmnExclusiveGateway, label: "Exclusive gateway" },
      { tool: Tool.Connector, label: "Connector" },
    ],
  },
  { id: "all", label: "All tools", design: true, shapes: true, tools: [] },
] as const satisfies readonly Workspace[];
export const WORKSPACE_STORAGE_KEY = "nodetto.workspace.v1";
export function workspaceById(value: unknown): Workspace {
  return WORKSPACES.find((entry) => entry.id === value) ?? WORKSPACES[0];
}
export function readWorkspacePreference(
  storage: Pick<Storage, "getItem"> | undefined,
): WorkspaceId {
  try {
    return workspaceById(storage?.getItem(WORKSPACE_STORAGE_KEY)).id;
  } catch {
    return "flow";
  }
}
export function writeWorkspacePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  id: WorkspaceId,
): void {
  try {
    storage?.setItem(WORKSPACE_STORAGE_KEY, id);
  } catch {
    /* Optional UI preference. */
  }
}
