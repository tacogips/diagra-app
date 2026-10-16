import type { Editor, Vec } from "@nodetto/core";
import { For, type JSX, onCleanup } from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import {
  PALETTE_ICONS,
  type ShapePaletteItem,
  shapePaletteGroups,
} from "./shape-palette.ts";
import {
  type ActionContext,
  type ActionId,
  actionTitle,
  getAction,
  runAction,
} from "./shortcuts.ts";
import {
  creationFor,
  canUseTool,
  isConnectorTool,
  Tool,
  type ToolKind,
} from "./tools.ts";
import type { WorkspaceId } from "./workspaces.ts";
import "./ShapePalette.css";

export function ShapePalette(props: {
  readonly editor: Editor;
  readonly workspace: WorkspaceId;
  readonly tool: ToolKind;
  readonly onToolChange: (tool: ToolKind) => void;
  readonly context: ActionContext;
  readonly onShapeDrop?: (tool: ToolKind, client: Vec) => void;
}): JSX.Element {
  let drag:
    | { id: number; tool: ToolKind; x: number; y: number; moved: boolean }
    | undefined;
  let suppressClick = false;
  const cancelDrag = () => {
    drag = undefined;
  };
  window.addEventListener("blur", cancelDrag);
  const cancelKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      suppressClick = drag?.moved ?? false;
      cancelDrag();
    }
  };
  const move = (event: PointerEvent) => {
    if (
      drag?.id === event.pointerId &&
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4
    )
      drag.moved = true;
  };
  const end = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    const ended = drag;
    drag = undefined;
    suppressClick = ended.moved;
    if (ended.moved && !props.editor.readOnly)
      props.onShapeDrop?.(ended.tool, { x: event.clientX, y: event.clientY });
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", cancelDrag, true);
  window.addEventListener("keydown", cancelKey, true);
  onCleanup(() => {
    window.removeEventListener("blur", cancelDrag);
    window.removeEventListener("keydown", cancelKey, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", cancelDrag, true);
  });
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const enabled = (id: ActionId): boolean => {
    signals.rev();
    signals.selection();
    return !readOnly() && getAction(id).enabled(props.context);
  };
  const tiles = (items: readonly ShapePaletteItem[]) => (
    <div class="nodetto-shape-grid">
      <For each={items}>
        {(item) => (
          <button
            type="button"
            class="nodetto-shape-tile"
            aria-label={`Draw ${item.label.toLowerCase()}`}
            aria-pressed={props.tool === item.tool}
            title={
              item.tool === Tool.Freehand
                ? "Freehand — drag on the canvas"
                : isConnectorTool(item.tool)
                  ? `${item.label} — drag from one shape to another`
                  : item.tool === Tool.Port
                    ? "Port — click a component boundary"
                    : `${item.label} — select, then click the canvas`
            }
            on:pointerdown={(event) => {
              if (event.button !== 0 || !creationFor(item.tool) || readOnly())
                return;
              event.preventDefault();
              suppressClick = false;
              drag = {
                id: event.pointerId,
                tool: item.tool,
                x: event.clientX,
                y: event.clientY,
                moved: false,
              };
            }}
            disabled={!canUseTool(item.tool, readOnly())}
            onClick={() => {
              if (suppressClick) {
                suppressClick = false;
                return;
              }
              if (canUseTool(item.tool, props.editor.readOnly))
                props.onToolChange(item.tool);
            }}
          >
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d={PALETTE_ICONS[item.icon]} />
            </svg>
            <span>{item.label}</span>
          </button>
        )}
      </For>
    </div>
  );
  const action = (id: ActionId, label: string) => (
    <button
      type="button"
      class="nodetto-palette-action"
      title={actionTitle(getAction(id))}
      disabled={!enabled(id)}
      onClick={() => runAction(getAction(id), props.context)}
    >
      {label}
    </button>
  );
  return (
    <section
      class="nodetto-shape-palette"
      aria-label="Shape palette"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onToolChange(Tool.Select);
        }
      }}
    >
      <For each={shapePaletteGroups(props.workspace)}>
        {(group, index) => (
          <details class="nodetto-palette-section" open={index() === 0}>
            <summary>{group.label}</summary>
            {tiles(group.items)}
          </details>
        )}
      </For>
      <div class="nodetto-palette-actions" role="group" aria-label="Grouping">
        {action("frameSelection", "Frame selection")}
        {action("group", "Group")}
        {action("ungroup", "Ungroup")}
      </div>
    </section>
  );
}
