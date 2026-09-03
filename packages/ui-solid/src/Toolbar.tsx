// Tool palette, arrangement buttons, export and history.
//
// The toolbar holds no state of its own: the active tool lives in the app
// shell so the canvas can hand it back after a click-create, undo/redo
// availability is read from the editor's history, and the arrangement and
// export buttons are entries of the shared action table evaluated against
// the shell's `ActionContext`.

import type { Editor } from "@diagra/core";
import { For, type JSX } from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import {
  type ActionContext,
  type ActionId,
  actionTitle,
  getAction,
  runAction,
} from "./shortcuts.ts";
import type { ToolKind } from "./tools.ts";

export interface ToolbarProps {
  readonly editor: Editor;
  readonly tool: ToolKind;
  readonly onToolChange: (tool: ToolKind) => void;
  /** Built by the shell; drives the action buttons and their enabled state. */
  readonly context: ActionContext;
}

interface ToolButton {
  readonly tool: ToolKind;
  readonly label: string;
  /** Includes the shortcut letter from design editor-ux 5 where one exists. */
  readonly title: string;
}

const TOOL_BUTTONS: readonly ToolButton[] = [
  { tool: "select", label: "Select", title: "Select and move (V)" },
  { tool: "hand", label: "Hand", title: "Pan the canvas (H, or hold Space)" },
  {
    tool: "edge",
    label: "Edge",
    title: "Drag between two shapes to connect (L)",
  },
  { tool: "geo:rect", label: "Rect", title: "Rectangle (R)" },
  { tool: "geo:ellipse", label: "Ellipse", title: "Ellipse (O)" },
  { tool: "geo:diamond", label: "Diamond", title: "Diamond (D)" },
  { tool: "geo:cylinder", label: "Cylinder", title: "Cylinder" },
  { tool: "text.note", label: "Text", title: "Text (T)" },
  { tool: "node.generic", label: "Node", title: "Generic node (N)" },
  { tool: "erd.table", label: "Table", title: "ERD table" },
  { tool: "uml.class", label: "Class", title: "UML class" },
];

interface ActionButton {
  readonly id: ActionId;
  readonly label: string;
}

const ARRANGE_BUTTONS: readonly ActionButton[] = [
  { id: "group", label: "Group" },
  { id: "ungroup", label: "Ungroup" },
  { id: "alignLeft", label: "Left" },
  { id: "alignHCenter", label: "Centre" },
  { id: "alignRight", label: "Right" },
  { id: "alignTop", label: "Top" },
  { id: "alignVCenter", label: "Middle" },
  { id: "alignBottom", label: "Bottom" },
];

const EXPORT_BUTTONS: readonly ActionButton[] = [
  { id: "exportSvg", label: "Export SVG" },
];

export function Toolbar(props: ToolbarProps): JSX.Element {
  const signals = createEditorSignals(props.editor);

  // Reading the revision makes the buttons re-evaluate after every edit.
  const canUndo = () => {
    signals.rev();
    return props.editor.canUndo();
  };
  const canRedo = () => {
    signals.rev();
    return props.editor.canRedo();
  };
  const isEnabled = (id: ActionId): boolean => {
    signals.rev();
    signals.selection();
    signals.camera();
    return getAction(id).enabled(props.context);
  };

  const actionGroup = (buttons: readonly ActionButton[]): JSX.Element => (
    <div class="diagra-tool-group">
      <For each={buttons}>
        {(button) => (
          <button
            type="button"
            class="diagra-tool-button"
            title={actionTitle(getAction(button.id))}
            disabled={!isEnabled(button.id)}
            onClick={() => runAction(getAction(button.id), props.context)}
          >
            {button.label}
          </button>
        )}
      </For>
    </div>
  );

  return (
    <div class="diagra-toolbar">
      <div class="diagra-tool-group">
        <For each={TOOL_BUTTONS}>
          {(button) => (
            <button
              type="button"
              class="diagra-tool-button"
              classList={{ "diagra-active": props.tool === button.tool }}
              title={button.title}
              aria-pressed={props.tool === button.tool}
              onClick={() => props.onToolChange(button.tool)}
            >
              {button.label}
            </button>
          )}
        </For>
      </div>
      {actionGroup(ARRANGE_BUTTONS)}
      {actionGroup(EXPORT_BUTTONS)}
      <div class="diagra-tool-group">
        <button
          type="button"
          class="diagra-tool-button"
          title="Undo (Cmd/Ctrl+Z)"
          disabled={!canUndo()}
          onClick={() => props.editor.undo()}
        >
          Undo
        </button>
        <button
          type="button"
          class="diagra-tool-button"
          title="Redo (Cmd/Ctrl+Shift+Z)"
          disabled={!canRedo()}
          onClick={() => props.editor.redo()}
        >
          Redo
        </button>
      </div>
    </div>
  );
}
