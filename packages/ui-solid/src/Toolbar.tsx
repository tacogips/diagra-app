import {
  type Editor,
  insertUiBlock,
  UI_BLOCKS,
  type UiBlock,
} from "@diagra/core";
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
import { canUseTool, type ToolKind } from "./tools.ts";
import "./Toolbar.css";

const PrototypePreview = lazy(() =>
  import("./PrototypePreview.tsx").then((module) => ({
    default: module.PrototypePreview,
  })),
);
export interface ToolbarProps {
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
    ]),
  },
  {
    id: "export",
    label: "Export",
    actions: actions([["exportSvg", "Export SVG"]]),
  },
];
const FRAME_TOOLS =
  TOOL_MENUS.find((menu) => menu.id === "frames")?.tools ?? [];
const SHAPE_TOOLS =
  TOOL_MENUS.find((menu) => menu.id === "shapes")?.tools ?? [];
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

function Icon(props: {
  readonly name:
    | "select"
    | "hand"
    | "undo"
    | "redo"
    | "preview"
    | "frame"
    | "rect"
    | "ellipse"
    | "diamond"
    | "cylinder"
    | "draw"
    | "text"
    | "image"
    | "more"
    | "chevron";
}): JSX.Element {
  const paths = {
    select: "M5 3l11 8-6 1 3 7-2 1-3-7-4 4z",
    hand: "M7 11V5a1 1 0 012 0v5V3a1 1 0 012 0v7V4a1 1 0 012 0v6V6a1 1 0 012 0v7c0 3-2 5-5 5-3 0-5-2-5-5v-3a1 1 0 012 0v1z",
    undo: "M8 6l-5 5 5 5v-3c5 0 7 2 8 5 0-6-3-9-8-9z",
    redo: "M12 6l5 5-5 5v-3c-5 0-7 2-8 5 0-6 3-9 8-9z",
    preview:
      "M2 11s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zm8 3a3 3 0 100-6 3 3 0 000 6z",
    frame: "M3 3h14v14H3zM5 5v10h10V5z",
    rect: "M3 5h14v10H3z",
    ellipse: "M3 10a7 4 0 1014 0 7 4 0 10-14 0z",
    diamond: "M10 2l8 8-8 8-8-8z",
    cylinder: "M4 5a6 3 0 0012 0v10a6 3 0 01-12 0zm0 0a6 3 0 0012 0",
    draw: "M4 15l1-4 8-8 3 3-8 8zm8-12l3 3",
    text: "M4 4h12M10 4v12",
    image: "M3 4h14v12H3zm2 9l3-3 2 2 2-3 3 4M6 7h.01",
    more: "M4 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm4.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm4.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z",
    chevron: "M6 8l4 4 4-4z",
  } as const;
  const outlined = new Set([
    "preview",
    "frame",
    "rect",
    "ellipse",
    "diamond",
    "cylinder",
    "text",
    "image",
  ]);
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d={paths[props.name]}
        fill={outlined.has(props.name) ? "none" : "currentColor"}
        stroke={outlined.has(props.name) ? "currentColor" : undefined}
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width={outlined.has(props.name) ? "1.5" : undefined}
      />
    </svg>
  );
}
export function Toolbar(props: ToolbarProps): JSX.Element {
  const [preview, setPreview] = createSignal(false);
  const [open, setOpen] = createSignal<string | null>(null);
  const [menuPosition, setMenuPosition] = createSignal({ x: 8, y: 44 });
  const [lastFrame, setLastFrame] = createSignal<ToolKind>("frame:web");
  const [lastShape, setLastShape] = createSignal<ToolKind>("geo:rect");
  const signals = createEditorSignals(props.editor);
  let root: HTMLDivElement | undefined;
  createEffect(() => {
    if (FRAME_TOOLS.some((item) => item.tool === props.tool)) {
      setLastFrame(props.tool);
    }
    if (SHAPE_TOOLS.some((item) => item.tool === props.tool)) {
      setLastShape(props.tool);
    }
  });
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
  const focusMenuItem = (menu: HTMLElement, index: number) => {
    const items = [
      ...menu.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select:not(:disabled)",
      ),
    ];
    items[index < 0 ? items.length - 1 : index]?.focus({
      preventScroll: true,
    });
  };
  const menuKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.target instanceof HTMLSelectElement && event.key !== "Escape")
      return;
    const menu = event.currentTarget as HTMLElement;
    const items = [
      ...menu.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select:not(:disabled)",
      ),
    ];
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
  const currentFrame = () =>
    rememberedTool(FRAME_TOOLS, props.tool, lastFrame(), "frame:web");
  const currentShape = () =>
    rememberedTool(SHAPE_TOOLS, props.tool, lastShape(), "geo:rect");
  const currentFrameInfo = () =>
    FRAME_TOOLS.find((item) => item.tool === currentFrame());
  const currentShapeInfo = () =>
    SHAPE_TOOLS.find((item) => item.tool === currentShape());
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
          classList={{ "diagra-active": props.tool === item.tool }}
          disabled={!canUseTool(item.tool, readOnly())}
          onClick={() => chooseTool(item.tool)}
        >
          {item.label}
        </button>
      )}
    </For>
  );
  return (
    <div
      ref={root}
      class="diagra-compact-toolbar"
      role="toolbar"
      aria-label="Editor tools"
    >
      <div class="diagra-toolbar-primary">
        <button
          type="button"
          class="diagra-toolbar-icon"
          aria-label="Select"
          title="Select and move (V)"
          aria-pressed={props.tool === "select"}
          disabled={!canUseTool("select", readOnly())}
          onClick={() => chooseTool("select")}
        >
          <Icon name="select" />
        </button>
        <button
          type="button"
          class="diagra-toolbar-icon"
          aria-label="Hand"
          title="Pan the canvas (H, or hold Space)"
          aria-pressed={props.tool === "hand"}
          disabled={!canUseTool("hand", readOnly())}
          onClick={() => chooseTool("hand")}
        >
          <Icon name="hand" />
        </button>
        <div class="diagra-toolbar-split">
          <button
            type="button"
            class="diagra-toolbar-icon"
            aria-label={`Insert ${currentFrameInfo()?.label ?? "frame"} frame`}
            title={`Insert ${currentFrameInfo()?.title ?? "current frame"}`}
            aria-pressed={FRAME_TOOLS.some((item) => item.tool === props.tool)}
            disabled={!canUseTool(currentFrame(), readOnly())}
            onClick={() => chooseTool(currentFrame())}
          >
            <Icon name="frame" />
          </button>
          <button
            type="button"
            class="diagra-toolbar-chevron"
            aria-label="Choose frame"
            title="Choose frame"
            aria-haspopup="menu"
            aria-expanded={open() === "frames"}
            onClick={(event) => trigger("frames", event.currentTarget)}
            onKeyDown={(event) => triggerKey("frames", event)}
          >
            <Icon name="chevron" />
          </button>
        </div>
        <div class="diagra-toolbar-split">
          <button
            type="button"
            class="diagra-toolbar-icon"
            aria-label={`Insert ${currentShapeInfo()?.label ?? "shape"} shape`}
            title={`Insert ${currentShapeInfo()?.title ?? "current shape"}`}
            aria-pressed={SHAPE_TOOLS.some((item) => item.tool === props.tool)}
            disabled={!canUseTool(currentShape(), readOnly())}
            onClick={() => chooseTool(currentShape())}
          >
            <Icon
              name={
                currentShape().replace("geo:", "") as
                  | "rect"
                  | "ellipse"
                  | "diamond"
                  | "cylinder"
              }
            />
          </button>
          <button
            type="button"
            class="diagra-toolbar-chevron"
            aria-label="Choose shape"
            title="Choose shape"
            aria-haspopup="menu"
            aria-expanded={open() === "shapes"}
            onClick={(event) => trigger("shapes", event.currentTarget)}
            onKeyDown={(event) => triggerKey("shapes", event)}
          >
            <Icon name="chevron" />
          </button>
        </div>
        <button
          type="button"
          class="diagra-toolbar-icon"
          aria-label="Draw"
          title="Draw a freehand stroke"
          aria-pressed={props.tool === "draw.freehand"}
          disabled={!canUseTool("draw.freehand", readOnly())}
          onClick={() => chooseTool("draw.freehand")}
        >
          <Icon name="draw" />
        </button>
        <button
          type="button"
          class="diagra-toolbar-icon"
          aria-label="Text"
          title="Text (T)"
          aria-pressed={props.tool === "text.note"}
          disabled={!canUseTool("text.note", readOnly())}
          onClick={() => chooseTool("text.note")}
        >
          <Icon name="text" />
        </button>
        <Show when={open() === "frames" || open() === "shapes"}>
          <div
            class="diagra-toolbar-menu"
            role="menu"
            aria-label={open() === "frames" ? "Frames" : "Shapes"}
            style={menuStyle()}
            onKeyDown={menuKey}
          >
            {toolItems(open() === "frames" ? FRAME_TOOLS : SHAPE_TOOLS)}
          </div>
        </Show>
        <div class="diagra-toolbar-menu-wrap">
          <button
            type="button"
            class="diagra-toolbar-icon"
            aria-label="More tools"
            title="More tools"
            aria-haspopup="menu"
            aria-expanded={open() === "more"}
            onClick={(event) => trigger("more", event.currentTarget)}
            onKeyDown={(event) => triggerKey("more", event)}
          >
            <Icon name="more" />
          </button>
          <Show when={open() === "more"}>
            <div
              class="diagra-toolbar-menu diagra-toolbar-more-menu"
              role="menu"
              aria-label="More tools"
              style={menuStyle()}
              onKeyDown={menuKey}
            >
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
                <select
                  aria-label="Insert UI block"
                  disabled={readOnly()}
                  value=""
                  onChange={(event) => {
                    const kind = event.currentTarget.value;
                    if (
                      !props.editor.readOnly &&
                      UI_BLOCKS.includes(kind as UiBlock)
                    ) {
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
                  <option value="" disabled>
                    Insert UI block…
                  </option>
                  <option value="button">Primary button</option>
                  <option value="input">Text input</option>
                  <option value="card">Content card</option>
                  <option value="navigation">Navigation bar</option>
                </select>
              </section>
              <For each={ACTION_MENUS}>
                {(menu) => (
                  <section>
                    <h2>{menu.label}</h2>
                    <For each={menu.actions}>
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
      <div class="diagra-toolbar-utilities">
        <ImageImport
          editor={props.editor}
          compact
          label={<Icon name="image" />}
        />
        <button
          type="button"
          class="diagra-toolbar-icon"
          aria-label="Preview"
          title="Preview prototype"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setPreview(true);
          }}
        >
          <Icon name="preview" />
        </button>
        <div class="diagra-local-history" aria-label="History">
          <button
            type="button"
            class="diagra-toolbar-icon"
            aria-label="Undo"
            title="Undo (Cmd/Ctrl+Z)"
            disabled={!undo()}
            onClick={() => props.editor.undo()}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            class="diagra-toolbar-icon"
            aria-label="Redo"
            title="Redo (Cmd/Ctrl+Shift+Z)"
            disabled={!redo()}
            onClick={() => props.editor.redo()}
          >
            <Icon name="redo" />
          </button>
        </div>
      </div>
      <Show when={preview()}>
        <Suspense>
          <PrototypePreview
            editor={props.editor}
            onClose={() => setPreview(false)}
          />
        </Suspense>
      </Show>
    </div>
  );
}
