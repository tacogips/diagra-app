import { Tool, type ToolKind } from "./tools.ts";
import { workspaceById, type WorkspaceId } from "./workspaces.ts";

export const PALETTE_ICONS = {
  draw: "M4 25l3-8L22 2l8 8-15 15-8 3zM19 5l8 8",
  component: "M7 5h22v23H7zM3 10h8v5H3zM3 20h8v5H3z",
  provided: "M2 16h10m16 0a8 8 0 11-16 0 8 8 0 0116 0z",
  required: "M2 16h12m12-9a9 9 0 000 18",
  port: "M3 4h22v24H3zM21 12h8v8h-8z",
  rect: "M4 7h24v18H4z",
  ellipse: "M29 16a13 9 0 11-26 0 13 9 0 0126 0z",
  diamond: "M16 3l13 13-13 13L3 16z",
  cylinder: "M5 8a11 4 0 0022 0v16a11 4 0 01-22 0zm0 0a11 4 0 1122 0",
  triangle: "M16 4l13 24H3z",
  hexagon: "M9 5h14l8 11-8 11H9L1 16z",
  parallelogram: "M10 6h20l-8 20H2z",
  star: "M16 2l4 9 10 1-8 7 3 11-9-6-9 6 3-11-8-7 10-1z",
  text: "M5 6h22M16 6v21M11 27h10",
  node: "M7 6h18a4 4 0 014 4v12a4 4 0 01-4 4H7a4 4 0 01-4-4V10a4 4 0 014-4zM10 16h12",
  edge: "M3 25h9V8h16m-6-6l6 6-6 6",
  frame: "M3 10V3h7m12 0h7v7m0 12v7h-7m-12 0H3v-7M7 7h18v18H7z",
  table: "M3 4h26v24H3zM3 11h26M3 19h26M13 11v17",
  class: "M3 3h26v26H3zM3 11h26M3 20h26M9 7h14M8 16h9M8 25h12",
  actor: "M20 6a4 4 0 11-8 0 4 4 0 018 0zM16 10v12M7 15h18M16 22l-8 8m8-8l8 8",
  service: "M4 5h24v15H4zM16 20v10M11 25h10",
} as const;

export interface ShapePaletteItem {
  readonly tool: ToolKind;
  readonly label: string;
  readonly icon: keyof typeof PALETTE_ICONS;
}

export const COMMON_SHAPES: readonly ShapePaletteItem[] = [
  { tool: Tool.Rectangle, label: "Rectangle", icon: "rect" },
  { tool: Tool.Ellipse, label: "Ellipse", icon: "ellipse" },
  { tool: Tool.Diamond, label: "Diamond", icon: "diamond" },
  { tool: Tool.Cylinder, label: "Cylinder", icon: "cylinder" },
  { tool: Tool.Triangle, label: "Triangle", icon: "triangle" },
  { tool: Tool.Hexagon, label: "Hexagon", icon: "hexagon" },
  { tool: Tool.Parallelogram, label: "Parallelogram", icon: "parallelogram" },
  { tool: Tool.Star, label: "Star", icon: "star" },
  { tool: Tool.Text, label: "Text", icon: "text" },
  { tool: Tool.Node, label: "Node", icon: "node" },
  { tool: Tool.Connector, label: "Connector", icon: "edge" },
  { tool: Tool.Frame, label: "Frame", icon: "frame" },
];

export const DIAGRAM_SHAPES: readonly ShapePaletteItem[] = [
  { tool: Tool.Component, label: "Component", icon: "component" },
  {
    tool: Tool.ProvidedInterface,
    label: "Provided interface",
    icon: "provided",
  },
  {
    tool: Tool.RequiredInterface,
    label: "Required interface",
    icon: "required",
  },
  { tool: Tool.Port, label: "Port", icon: "port" },
  { tool: Tool.Dependency, label: "Dependency", icon: "edge" },
  { tool: Tool.Realization, label: "Realization", icon: "edge" },
  { tool: Tool.ComponentConnector, label: "Component connector", icon: "edge" },
  { tool: Tool.Table, label: "Table", icon: "table" },
  { tool: Tool.Class, label: "Class", icon: "class" },
  { tool: Tool.Actor, label: "Actor", icon: "actor" },
  { tool: Tool.Service, label: "Service", icon: "service" },
  { tool: Tool.Database, label: "Database", icon: "cylinder" },
];

export const BPMN_SHAPES: readonly ShapePaletteItem[] = [
  { tool: Tool.BpmnPool, label: "Pool", icon: "frame" },
  { tool: Tool.BpmnPoolCollapsed, label: "Pool collapsed", icon: "frame" },
  { tool: Tool.BpmnLane, label: "Lane", icon: "frame" },
  { tool: Tool.BpmnTask, label: "Task", icon: "rect" },
  { tool: Tool.BpmnUserTask, label: "User task", icon: "rect" },
  { tool: Tool.BpmnServiceTask, label: "Service task", icon: "rect" },
  { tool: Tool.BpmnStartEvent, label: "Start event", icon: "ellipse" },
  { tool: Tool.BpmnMessageCatch, label: "Message catch", icon: "ellipse" },
  { tool: Tool.BpmnMessageThrow, label: "Message throw", icon: "ellipse" },
  { tool: Tool.BpmnTimerCatch, label: "Timer catch", icon: "ellipse" },
  { tool: Tool.BpmnEndEvent, label: "End event", icon: "ellipse" },
  {
    tool: Tool.BpmnExclusiveGateway,
    label: "Exclusive gateway",
    icon: "diamond",
  },
  {
    tool: Tool.BpmnParallelGateway,
    label: "Parallel gateway",
    icon: "diamond",
  },
  { tool: Tool.BpmnSubProcess, label: "Sub process", icon: "frame" },
  {
    tool: Tool.BpmnSubProcessExpanded,
    label: "Sub process expanded",
    icon: "frame",
  },
  { tool: Tool.BpmnCallActivity, label: "Call activity", icon: "rect" },
  { tool: Tool.BpmnDataObject, label: "Data object", icon: "rect" },
  { tool: Tool.BpmnDataStore, label: "Data store", icon: "cylinder" },
  { tool: Tool.BpmnTextAnnotation, label: "Text annotation", icon: "text" },
  { tool: Tool.BpmnGroup, label: "Group", icon: "frame" },
];

export const ARTBOARD_SHAPES: readonly ShapePaletteItem[] = [
  { tool: Tool.WebFrame, label: "Web", icon: "frame" },
  { tool: Tool.IPhoneFrame, label: "iPhone", icon: "frame" },
  { tool: Tool.AndroidFrame, label: "Android", icon: "frame" },
  { tool: Tool.TabletFrame, label: "Tablet", icon: "frame" },
  { tool: Tool.PaperFrame, label: "Document", icon: "frame" },
];

/** Ordered authoring priorities; every workspace must make an explicit choice. */
const PRIMARY_TOOLS = {
  bpmn: [
    Tool.BpmnStartEvent,
    Tool.BpmnTask,
    Tool.BpmnExclusiveGateway,
    Tool.BpmnEndEvent,
    Tool.BpmnPool,
    Tool.BpmnLane,
    Tool.Connector,
    Tool.Text,
    Tool.Frame,
  ],
  component: [
    Tool.Component,
    Tool.ProvidedInterface,
    Tool.RequiredInterface,
    Tool.Port,
    Tool.Dependency,
    Tool.Realization,
    Tool.ComponentConnector,
    Tool.Text,
    Tool.Frame,
  ],
  erd: [Tool.Table, Tool.Connector, Tool.Text, Tool.Frame],
  class: [Tool.Class, Tool.Connector, Tool.Text, Tool.Frame],
  sequence: [
    Tool.Actor,
    Tool.Service,
    Tool.Database,
    Tool.Connector,
    Tool.Text,
    Tool.Frame,
  ],
  flow: [...COMMON_SHAPES, ...DIAGRAM_SHAPES].map((item) => item.tool),
  app: [
    Tool.IPhoneFrame,
    Tool.AndroidFrame,
    Tool.TabletFrame,
    Tool.Rectangle,
    Tool.Text,
    Tool.Ellipse,
    Tool.Frame,
  ],
  web: [Tool.WebFrame, Tool.Rectangle, Tool.Text, Tool.Ellipse, Tool.Frame],
  all: [...COMMON_SHAPES, ...DIAGRAM_SHAPES].map((item) => item.tool),
} as const satisfies Record<WorkspaceId, readonly ToolKind[]>;

const PALETTE_SHAPES = [
  ...COMMON_SHAPES,
  ...DIAGRAM_SHAPES,
  ...ARTBOARD_SHAPES,
  ...BPMN_SHAPES,
];

/** Preserve semantic workspace labels, such as Relationship or Message. */
export function workspaceShapes(id: WorkspaceId): readonly ShapePaletteItem[] {
  const workspace = workspaceById(id);
  return PRIMARY_TOOLS[id].map((tool) => {
    const item = PALETTE_SHAPES.find((candidate) => candidate.tool === tool);
    if (!item) throw new Error(`Missing palette shape for ${tool}`);
    const label = workspace.tools.find((entry) => entry.tool === tool)?.label;
    return label ? { ...item, label } : item;
  });
}

/** Secondary sections never repeat a tool already shown in the primary grid. */
export function additionalShapes(id: WorkspaceId): readonly ShapePaletteItem[] {
  const primary = new Set<ToolKind>(PRIMARY_TOOLS[id]);
  return (
    id === "bpmn" ? [...BPMN_SHAPES, ...COMMON_SHAPES] : COMMON_SHAPES
  ).filter((item) => !primary.has(item.tool));
}

export function artboardShapes(id: WorkspaceId): readonly ShapePaletteItem[] {
  if (!workspaceById(id).design) return [];
  const primary = new Set<ToolKind>(PRIMARY_TOOLS[id]);
  return ARTBOARD_SHAPES.filter((item) => !primary.has(item.tool));
}

export interface ShapePaletteGroup {
  readonly label: string;
  readonly items: readonly ShapePaletteItem[];
}

/** Group available tools by notation, keeping the active mode's category first. */
export function shapePaletteGroups(
  id: WorkspaceId,
): readonly ShapePaletteGroup[] {
  const items = [
    ...workspaceShapes(id),
    ...additionalShapes(id),
    ...artboardShapes(id),
    ...(workspaceById(id).design
      ? [{ tool: Tool.Freehand, label: "Freehand", icon: "draw" } as const]
      : []),
  ];
  const category = (tool: ToolKind): string => {
    if (tool === Tool.Table) return "ERD";
    if (tool === Tool.Actor || tool === Tool.Service || tool === Tool.Database)
      return "Sequence";
    if (DIAGRAM_SHAPES.some((item) => item.tool === tool)) return "UML";
    if (BPMN_SHAPES.some((item) => item.tool === tool)) return "BPMN";
    if (ARTBOARD_SHAPES.some((item) => item.tool === tool)) return "Artboards";
    return "General";
  };
  const groups = new Map<string, ShapePaletteItem[]>();
  for (const item of items) {
    const label = category(item.tool);
    const group = groups.get(label) ?? [];
    group.push(item);
    groups.set(label, group);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}
