import type { Editor } from "@nodetto/core";
import { For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import {
  ARTBOARD_SHAPES,
  COMMON_SHAPES,
  PALETTE_ICONS,
  type ShapePaletteItem,
  workspaceShapes,
} from "./shape-palette.ts";
import {
  type ActionContext,
  type ActionId,
  actionTitle,
  getAction,
  runAction,
} from "./shortcuts.ts";
import { canUseTool, Tool, type ToolKind } from "./tools.ts";
import { workspaceById, type WorkspaceId } from "./workspaces.ts";
import "./ShapePalette.css";

export function ShapePalette(props: {
  readonly editor: Editor;
  readonly workspace: WorkspaceId;
  readonly tool: ToolKind;
  readonly onToolChange: (tool: ToolKind) => void;
  readonly context: ActionContext;
}): JSX.Element {
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
              item.tool === Tool.Connector
                ? `${item.label} — drag from one shape to another`
                : `${item.label} — select, then click the canvas`
            }
            disabled={!canUseTool(item.tool, readOnly())}
            onClick={() => {
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
      <h2>Shapes</h2>
      <p class="nodetto-palette-help" aria-live="polite">
        {readOnly()
          ? "View only"
          : props.tool === Tool.Connector
            ? "Drag between shapes to connect them."
            : "Choose a shape, then click the canvas."}
      </p>
      <Show when={workspaceShapes(props.workspace).length > 0}>
        <details
          class="nodetto-palette-section"
          open={props.workspace !== "all"}
        >
          <summary>
            {props.workspace === "all"
              ? "Diagram shapes"
              : workspaceById(props.workspace).label}
          </summary>
          {tiles(workspaceShapes(props.workspace))}
        </details>
      </Show>
      {tiles(COMMON_SHAPES)}
      <div class="nodetto-palette-actions" role="group" aria-label="Grouping">
        {action("frameSelection", "Frame selection")}
        {action("group", "Group")}
        {action("ungroup", "Ungroup")}
      </div>
      <Show when={workspaceById(props.workspace).design}>
        <details class="nodetto-palette-section">
          <summary>Artboards</summary>
          {tiles(ARTBOARD_SHAPES)}
        </details>
      </Show>
    </section>
  );
}
