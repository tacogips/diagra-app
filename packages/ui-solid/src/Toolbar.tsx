// Tool palette, arrangement buttons, export and history.
//
// The toolbar holds no state of its own: the active tool lives in the app
// shell so the canvas can hand it back after a click-create, undo/redo
// availability is read from the editor's history, and the arrangement and
// export buttons are entries of the shared action table evaluated against
// the shell's `ActionContext`.

import {
  type Editor,
  insertUiBlock,
  UI_BLOCKS,
  type UiBlock,
} from "@diagra/core";
import { createSignal, For, type JSX, lazy, Show, Suspense } from "solid-js";
import { ImageImport } from "./ImageImport.tsx";
import { createEditorSignals } from "./adapter.ts";
import {
  type ActionContext,
  type ActionId,
  actionTitle,
  getAction,
  runAction,
} from "./shortcuts.ts";
import { canUseTool, type ToolKind } from "./tools.ts";

const PrototypePreview = lazy(() =>
  import("./PrototypePreview.tsx").then((module) => ({
    default: module.PrototypePreview,
  })),
);

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
  { tool: "draw.freehand", label: "Draw", title: "Draw a freehand stroke" },
  {
    tool: "edit.points",
    label: "Anchors",
    title: "Select a stroke or vector path and drag its anchors",
  },
  { tool: "crop", label: "Crop", title: "Trim the selected image" },
  {
    tool: "edit.paint",
    label: "Fill gradient",
    title: "Edit the selected layer's fill gradient on canvas",
  },
  {
    tool: "edit.stroke-paint",
    label: "Stroke gradient",
    title: "Edit the selected layer's stroke gradient on canvas",
  },
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
  { tool: "sequence.actor", label: "Actor", title: "Sequence actor" },
  {
    tool: "sequence.service",
    label: "Service",
    title: "Sequence service participant",
  },
  {
    tool: "sequence.database",
    label: "Seq DB",
    title: "Sequence database participant",
  },
  { tool: "frame:web", label: "Web", title: "Web artboard (1440 × 900)" },
  {
    tool: "frame:iphone",
    label: "iPhone",
    title: "iPhone artboard (390 × 844)",
  },
  {
    tool: "frame:android",
    label: "Android",
    title: "Android artboard (360 × 800)",
  },
  {
    tool: "frame:tablet",
    label: "Tablet",
    title: "Tablet artboard (768 × 1024)",
  },
  { tool: "frame:paper", label: "Document", title: "A4 document artboard" },
];

interface ActionButton {
  readonly id: ActionId;
  readonly label: string;
}

const ARRANGE_BUTTONS: readonly ActionButton[] = [
  { id: "frameSelection", label: "Frame selection" },
  { id: "group", label: "Group" },
  { id: "booleanUnion", label: "Union" },
  { id: "booleanSubtract", label: "Subtract" },
  { id: "booleanIntersect", label: "Intersect" },
  { id: "booleanExclude", label: "Exclude" },
  { id: "flattenBoolean", label: "Flatten Boolean" },
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
  const [preview, setPreview] = createSignal(false);
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };

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
      <ImageImport editor={props.editor} />
      <select
        aria-label="Insert UI block"
        disabled={readOnly()}
        value=""
        onChange={(event) => {
          if (props.editor.readOnly) return;
          const kind = event.currentTarget.value;
          if (UI_BLOCKS.includes(kind as UiBlock)) {
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
      <button
        type="button"
        class="diagra-tool-button"
        onClick={() => setPreview(true)}
      >
        Preview
      </button>
      <Show when={preview()}>
        <Suspense>
          <PrototypePreview
            editor={props.editor}
            onClose={() => setPreview(false)}
          />
        </Suspense>
      </Show>
      <div class="diagra-tool-group">
        <For each={TOOL_BUTTONS}>
          {(button) => (
            <button
              type="button"
              class="diagra-tool-button"
              classList={{ "diagra-active": props.tool === button.tool }}
              title={button.title}
              aria-pressed={props.tool === button.tool}
              disabled={!canUseTool(button.tool, readOnly())}
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
