// Tool palette and history buttons.
//
// The toolbar holds no state of its own: the active tool lives in the app
// shell so the canvas can hand it back after a click-create, and undo/redo
// availability is read from the editor's history.

import type { Editor } from "@diagra/core";
import { For, type JSX } from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import type { ToolKind } from "./tools.ts";

export interface ToolbarProps {
  readonly editor: Editor;
  readonly tool: ToolKind;
  readonly onToolChange: (tool: ToolKind) => void;
}

interface ToolButton {
  readonly tool: ToolKind;
  readonly label: string;
  readonly title: string;
}

const TOOL_BUTTONS: readonly ToolButton[] = [
  { tool: "select", label: "Select", title: "Select and move (V)" },
  { tool: "hand", label: "Hand", title: "Pan the canvas" },
  { tool: "edge", label: "Edge", title: "Drag between two shapes to connect" },
  { tool: "geo:rect", label: "Rect", title: "Rectangle" },
  { tool: "geo:ellipse", label: "Ellipse", title: "Ellipse" },
  { tool: "geo:diamond", label: "Diamond", title: "Diamond" },
  { tool: "geo:cylinder", label: "Cylinder", title: "Cylinder" },
  { tool: "node.generic", label: "Node", title: "Generic node" },
  { tool: "erd.table", label: "Table", title: "ERD table" },
  { tool: "uml.class", label: "Class", title: "UML class" },
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
      <div class="diagra-tool-group">
        <button
          type="button"
          class="diagra-tool-button"
          title="Undo"
          disabled={!canUndo()}
          onClick={() => props.editor.undo()}
        >
          Undo
        </button>
        <button
          type="button"
          class="diagra-tool-button"
          title="Redo"
          disabled={!canRedo()}
          onClick={() => props.editor.redo()}
        >
          Redo
        </button>
      </div>
    </div>
  );
}
