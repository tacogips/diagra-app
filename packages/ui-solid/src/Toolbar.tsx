import { Icon } from "./Icon.tsx";
import {
  type Editor,
  insertUiBlock,
  UI_BLOCKS,
  type UiBlock,
} from "@nodetto/core";
import {
  createEffect,
  createSignal,
  For,
  lazy,
  onCleanup,
  onMount,
  type JSX,
  Show,
  Suspense,
} from "solid-js";
import { ImageImport } from "./ImageImport.tsx";
import { createEditorSignals } from "./adapter.ts";
import { clampToHost } from "./menu-geometry.ts";
import { stepMenuIndex } from "./menu-navigation.ts";
import {
  type ActionContext,
  type ActionId,
  actionTitle,
  getAction,
  runAction,
} from "./shortcuts.ts";
import { canUseTool, Tool, type ToolKind } from "./tools.ts";
import "./Toolbar.css";
import { WORKSPACES, workspaceById, type WorkspaceId } from "./workspaces.ts";

const PrototypePreview = lazy(() =>
  import("./PrototypePreview.tsx").then((module) => ({
    default: module.PrototypePreview,
  })),
);
export interface ToolbarProps {
  readonly leadingContent?: JSX.Element;
  readonly toolsContent?: JSX.Element;
  readonly utilitiesContent?: JSX.Element;
  readonly workspace?: WorkspaceId;
  readonly onWorkspaceChange?: (id: WorkspaceId) => void;
  readonly editor: Editor;
  readonly tool: ToolKind;
  readonly onToolChange: (tool: ToolKind) => void;
  readonly context: ActionContext;
}
export interface ToolbarTool {
  readonly tool: ToolKind;
  readonly label: string;
  readonly title: string;
}
export interface ToolbarAction {
  readonly id: ActionId;
  readonly label: string;
}
const tools = (
  items: readonly [ToolKind, string, string][],
): readonly ToolbarTool[] =>
  items.map(([tool, label, title]) => ({ tool, label, title }));
export const BPMN_TOOL_MENU: Readonly<{
  id: "bpmn";
  label: "BPMN";
  tools: readonly ToolbarTool[];
}> = {
  id: "bpmn",
  label: "BPMN",
  tools: tools([
    [Tool.BpmnPool, "Pool", "Pool"],
    [Tool.BpmnPoolCollapsed, "Collapsed pool", "Collapsed pool"],
    [Tool.BpmnLane, "Lane", "Lane"],
    [Tool.BpmnTask, "Task", "Task"],
    [Tool.BpmnUserTask, "User task", "User task"],
    [Tool.BpmnServiceTask, "Service task", "Service task"],
    [Tool.BpmnStartEvent, "Start event", "Start event"],
    [Tool.BpmnMessageCatch, "Message catch", "Message catch event"],
    [Tool.BpmnMessageThrow, "Message throw", "Message throw event"],
    [Tool.BpmnTimerCatch, "Timer catch", "Timer catch event"],
    [Tool.BpmnEndEvent, "End event", "End event"],
    [Tool.BpmnExclusiveGateway, "Exclusive gateway", "Exclusive gateway"],
    [Tool.BpmnParallelGateway, "Parallel gateway", "Parallel gateway"],
    [Tool.BpmnSubProcess, "Collapsed sub-process", "Collapsed sub-process"],
    [
      Tool.BpmnSubProcessExpanded,
      "Expanded sub-process",
      "Expanded sub-process",
    ],
    [Tool.BpmnCallActivity, "Call activity", "Call activity"],
    [Tool.BpmnDataObject, "Data object", "Data object"],
    [Tool.BpmnDataStore, "Data store", "Data store"],
    [Tool.BpmnTextAnnotation, "Text annotation", "Text annotation"],
    [Tool.BpmnGroup, "Group", "Group"],
  ]),
};
export const TOOL_MENUS: readonly Readonly<{
  id: string;
  label: string;
  tools: readonly ToolbarTool[];
}>[] = [
  {
    id: "insert",
    label: "Insert",
    tools: tools([
      ["draw.freehand", "Draw", "Draw a freehand stroke"],
      ["text.note", "Text", "Text (T)"],
      ["node.generic", "Node", "Generic node (N)"],
      ["edge", "Edge", "Connect two shapes (L)"],
    ]),
  },
  {
    id: "shapes",
    label: "Shapes",
    tools: tools([
      ["geo:rect", "Rectangle", "Rectangle (R)"],
      ["geo:ellipse", "Ellipse", "Ellipse (O)"],
      ["geo:diamond", "Diamond", "Diamond (D)"],
      ["geo:cylinder", "Cylinder", "Cylinder"],
    ]),
  },
  {
    id: "diagram",
    label: "Diagram",
    tools: tools([
      ["erd.table", "Table", "ERD table"],
      ["uml.class", "Class", "UML class"],
      ["sequence.actor", "Actor", "Sequence actor"],
      ["sequence.service", "Service", "Sequence service participant"],
      [
        "sequence.database",
        "Sequence database",
        "Sequence database participant",
      ],
    ]),
  },
  {
    id: "frames",
    label: "Frames",
    tools: tools([
      ["frame:web", "Web", "Web artboard (1440 × 900)"],
      ["frame:iphone", "iPhone", "iPhone artboard (390 × 844)"],
      ["frame:android", "Android", "Android artboard (360 × 800)"],
      ["frame:tablet", "Tablet", "Tablet artboard (768 × 1024)"],
      ["frame:paper", "Document", "A4 document artboard"],
    ]),
  },
  {
    id: "edit",
    label: "Edit",
    tools: tools([
      ["edit.points", "Edit anchors", "Edit anchors"],
      ["crop", "Crop", "Trim the selected image"],
      ["edit.paint", "Fill gradient", "Edit fill gradient"],
      ["edit.stroke-paint", "Stroke gradient", "Edit stroke gradient"],
    ]),
  },
];
const actions = (
  items: readonly [ActionId, string][],
): readonly ToolbarAction[] => items.map(([id, label]) => ({ id, label }));
export const ACTION_MENUS: readonly Readonly<{
  id: string;
  label: string;
  actions: readonly ToolbarAction[];
}>[] = [
  {
    id: "arrange",
    label: "Arrange",
    actions: actions([
      ["frameSelection", "Frame selection"],
      ["group", "Group"],
      ["booleanUnion", "Union"],
      ["booleanSubtract", "Subtract"],
      ["booleanIntersect", "Intersect"],
      ["booleanExclude", "Exclude"],
      ["flattenBoolean", "Flatten Boolean"],
      ["ungroup", "Ungroup"],
      ["alignLeft", "Align left"],
      ["alignHCenter", "Align centre"],
      ["alignRight", "Align right"],
      ["alignTop", "Align top"],
      ["alignVCenter", "Align middle"],
      ["alignBottom", "Align bottom"],
      ["tidyLayout", "Tidy layout"],
      ["removeOverlaps", "Remove overlaps"],
    ]),
  },
  {
    id: "export",
    label: "Export",
    actions: actions([["exportSvg", "Export…"]]),
  },
];
const DIAGRAM_TOOLS = [
  ...(TOOL_MENUS.find((menu) => menu.id === "insert")?.tools.filter(
    (item) => item.tool !== "draw.freehand" && item.tool !== "text.note",
  ) ?? []),
  ...(TOOL_MENUS.find((menu) => menu.id === "diagram")?.tools ?? []),
];
const ADVANCED_TOOLS =
  TOOL_MENUS.find((menu) => menu.id === "edit")?.tools ?? [];

export function rememberedTool(
  tools: readonly ToolbarTool[],
  active: ToolKind,
  remembered: ToolKind,
  fallback: ToolKind,
): ToolKind {
  return tools.some((item) => item.tool === active)
    ? active
    : tools.some((item) => item.tool === remembered)
      ? remembered
      : fallback;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const [preview, setPreview] = createSignal(false);
  const [open, setOpen] = createSignal<string | null>(null);
  const [menuPosition, setMenuPosition] = createSignal({ x: 8, y: 44 });
  const signals = createEditorSignals(props.editor);
  const workspace = () => workspaceById(props.workspace ?? "flow");
  const comprehensive = () =>
    workspace().id === "flow" || workspace().id === "all";
  createEffect(() => {
    workspace().id;
    setOpen(null);
    setPreview(false);
  });
  let root: HTMLDivElement | undefined;
  const closePreview = () => {
    setPreview(false);
    queueMicrotask(() =>
      root?.querySelector<HTMLButtonElement>('[aria-label="Preview"]')?.focus(),
    );
  };
  onMount(() => {
    const dismiss = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", dismiss);
    onCleanup(() => document.removeEventListener("pointerdown", dismiss));
  });
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const undo = () => {
    signals.rev();
    return props.editor.canUndo();
  };
  const redo = () => {
    signals.rev();
    return props.editor.canRedo();
  };
  const enabled = (id: ActionId) => {
    signals.rev();
    signals.selection();
    signals.camera();
    return getAction(id).enabled(props.context);
  };
  const closeMenu = (restoreFocus = false) => {
    const trigger = root?.querySelector<HTMLButtonElement>(
      "[aria-expanded=true]",
    );
    setOpen(null);
    if (restoreFocus) queueMicrotask(() => trigger?.focus());
  };
  const menuItems = (menu: HTMLElement) =>
    [
      ...menu.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select:not(:disabled), summary",
      ),
    ].filter((item) => item.getClientRects().length > 0);
  const focusMenuItem = (menu: HTMLElement, index: number) => {
    const items = menuItems(menu);
    items[index < 0 ? items.length - 1 : index]?.focus({
      preventScroll: true,
    });
  };
  const menuKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.target instanceof HTMLSelectElement && event.key !== "Escape")
      return;
    const menu = event.currentTarget as HTMLElement;
    const items = menuItems(menu);
    const active = items.indexOf(document.activeElement as HTMLElement);
    const order = items.map((_, index) => index);
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        return;
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const next = stepMenuIndex(
          order,
          active === -1 ? null : active,
          event.key === "ArrowDown" ? 1 : -1,
        );
        if (next !== null) focusMenuItem(menu, next);
        return;
      }
      case "Home":
      case "End":
        event.preventDefault();
        focusMenuItem(menu, event.key === "Home" ? 0 : items.length - 1);
        return;
      default:
        return;
    }
  };
  const chooseTool = (tool: ToolKind) => {
    props.onToolChange(tool);
    setOpen(null);
  };
  const chooseAction = (id: ActionId) => {
    runAction(getAction(id), props.context);
    setOpen(null);
  };
  const trigger = (id: string, target: HTMLElement) => {
    // WebKit on macOS does not necessarily focus buttons on pointer clicks.
    // Keep subsequent Escape/arrow keys in this menu's keyboard scope.
    target.focus({ preventScroll: true });
    if (open() === id) {
      setOpen(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setMenuPosition(
      clampToHost(
        { x: rect.left, y: rect.bottom + 4 },
        { width: 260, height: 360 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    setOpen(id);
  };
  const triggerKey = (id: string, event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape" && open() === id) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (open() !== id) trigger(id, event.currentTarget as HTMLElement);
    queueMicrotask(() => {
      const menu = root?.querySelector<HTMLElement>('[role="menu"]');
      if (menu) focusMenuItem(menu, event.key === "ArrowDown" ? 0 : -1);
    });
  };
  const menuStyle = () => ({
    left: `${menuPosition().x}px`,
    top: `${menuPosition().y}px`,
    "max-height": `calc(100dvh - ${menuPosition().y + 8}px)`,
  });
  const toolItems = (items: readonly ToolbarTool[]) => (
    <For each={items}>
      {(item) => (
        <button
          type="button"
          role="menuitem"
          title={item.title}
          classList={{ "nodetto-active": props.tool === item.tool }}
          disabled={!canUseTool(item.tool, readOnly())}
          onClick={() => chooseTool(item.tool)}
        >
          {item.label}
        </button>
      )}
    </For>
  );
  const uiBlocks = () => (
    <select
      aria-label="Insert UI block"
      disabled={readOnly()}
      value=""
      onChange={(event) => {
        const kind = event.currentTarget.value;
        if (!props.editor.readOnly && UI_BLOCKS.includes(kind as UiBlock)) {
          insertUiBlock(
            props.editor,
            kind as UiBlock,
            props.editor.camera.screenToPage({ x: 40, y: 40 }),
          );
          props.onToolChange("select");
        }
        event.currentTarget.value = "";
      }}
    >
      <option value="" disabled selected>
        Insert UI block…
      </option>
      <option value="button">Primary button</option>
      <option value="input">Text input</option>
      <option value="card">Content card</option>
      <option value="navigation">Navigation bar</option>
    </select>
  );
  const toolbar = () => (
    <div
      ref={root}
      class="nodetto-compact-toolbar"
      role="toolbar"
      aria-label="Editor tools"
    >
      <div class="nodetto-toolbar-primary" inert={preview()}>
        {props.leadingContent}
        <Show when={props.onWorkspaceChange}>
          <label class="nodetto-workspace-label">
            Mode
            <select
              class="nodetto-workspace-select"
              aria-label="Mode"
              value={workspace().id}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) =>
                props.onWorkspaceChange?.(
                  workspaceById(event.currentTarget.value).id,
                )
              }
            >
              <For each={WORKSPACES}>
                {(entry) => <option value={entry.id}>{entry.label}</option>}
              </For>
            </select>
          </label>
        </Show>
        {props.toolsContent}
        <button
          type="button"
          class="nodetto-toolbar-icon"
          aria-label="Export"
          title={actionTitle(getAction("exportSvg"))}
          disabled={!enabled("exportSvg")}
          onClick={() => chooseAction("exportSvg")}
        >
          <Icon name="export" />
        </button>
        <div class="nodetto-toolbar-menu-wrap">
          <button
            type="button"
            class="nodetto-toolbar-icon"
            aria-label="Actions"
            title="Arrange and access all tools"
            aria-haspopup="menu"
            aria-expanded={open() === "more"}
            onClick={(event) => trigger("more", event.currentTarget)}
            onKeyDown={(event) => triggerKey("more", event)}
          >
            <Icon name="more" />
          </button>
          <Show when={open() === "more"}>
            <div
              class="nodetto-toolbar-menu nodetto-toolbar-more-menu"
              role="menu"
              aria-label="Actions"
              style={menuStyle()}
              onKeyDown={menuKey}
            >
              <Show when={workspace().design}>
                {" "}
                <ImageImport
                  hiddenWhenIdle={!workspace().design}
                  editor={props.editor}
                  compact
                  label={<Icon name="image" />}
                />
                {uiBlocks()}
              </Show>
              <Show when={props.onWorkspaceChange && !comprehensive()}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    props.onWorkspaceChange?.("all");
                    queueMicrotask(() =>
                      root
                        ?.querySelector<HTMLSelectElement>(
                          ".nodetto-workspace-select",
                        )
                        ?.focus(),
                    );
                  }}
                >
                  Switch to All tools
                </button>
              </Show>
              <Show when={comprehensive()}>
                <section>
                  <h2>Diagram</h2>
                  {toolItems(DIAGRAM_TOOLS)}
                </section>
                <section>
                  <h2>Advanced</h2>
                  {toolItems(ADVANCED_TOOLS)}
                </section>
                <section>
                  <h2>UI blocks</h2>
                  {uiBlocks()}
                </section>
              </Show>
              <For each={ACTION_MENUS}>
                {(menu) => (
                  <section>
                    <h2>{menu.label}</h2>
                    <For
                      each={menu.actions.filter(
                        (item) =>
                          comprehensive() ||
                          (!item.id.startsWith("boolean") &&
                            item.id !== "flattenBoolean" &&
                            item.id !== "frameSelection"),
                      )}
                    >
                      {(item) => (
                        <button
                          type="button"
                          role="menuitem"
                          title={actionTitle(getAction(item.id))}
                          disabled={!enabled(item.id)}
                          onClick={() => chooseAction(item.id)}
                        >
                          {item.label}
                        </button>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <div class="nodetto-toolbar-utilities">
        <div style={{ display: "contents" }} inert={preview()}>
          {props.utilitiesContent}
        </div>
        <Show when={workspace().design}>
          <button
            type="button"
            class="nodetto-toolbar-icon"
            aria-label={preview() ? "Close preview" : "Preview"}
            aria-pressed={preview()}
            title={preview() ? "Close preview" : "Preview prototype"}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              if (preview()) closePreview();
              else setPreview(true);
            }}
          >
            <Icon name="preview" />
          </button>
        </Show>
        <div
          class="nodetto-local-history"
          aria-label="History"
          inert={preview()}
        >
          <button
            type="button"
            class="nodetto-toolbar-icon"
            aria-label="Undo"
            title="Undo (Cmd/Ctrl+Z)"
            disabled={!undo()}
            onClick={() => props.editor.undo()}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            class="nodetto-toolbar-icon"
            aria-label="Redo"
            title="Redo (Cmd/Ctrl+Shift+Z)"
            disabled={!redo()}
            onClick={() => props.editor.redo()}
          >
            <Icon name="redo" />
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <Show when={!preview()}>{toolbar()}</Show>
      <Show when={preview()}>
        <Suspense>
          <PrototypePreview
            editor={props.editor}
            toolbar={toolbar()}
            onClose={closePreview}
          />
        </Suspense>
      </Show>
    </>
  );
}
