// The editor's action table: one definition per command the chrome exposes.
//
// The context menu, the floating selection toolbar, the main toolbar and the
// app shell all read this table, so a label, a shortcut hint and an enabled
// rule are written exactly once. Actions hold no state: `enabled` and `run`
// read the editor and write through its methods, and everything that needs
// the DOM (viewport size, starting an inline edit, the export dialog) comes
// in through the `ActionContext` the shell builds.
//
// DOM-free on purpose so `bun test` can cover the enabled rules.

import {
  type AlignMode,
  type DistributeAxis,
  type Editor,
  isGroup,
  MAX_ZOOM,
  MIN_ZOOM,
  selectionUnits,
  selectionUnitsWithBounds,
  type SizeDimension,
  type ViewportSize,
} from "@diagra/core";
import type { ElementId } from "@diagra/ir";

export type ActionGroup =
  | "clipboard"
  | "order"
  | "group"
  | "align"
  | "distribute"
  | "size"
  | "text"
  | "zoom"
  | "export";

export type ActionId =
  | "cut"
  | "copy"
  | "paste"
  | "duplicate"
  | "delete"
  | "selectAll"
  | "bringToFront"
  | "bringForward"
  | "sendBackward"
  | "sendToBack"
  | "group"
  | "ungroup"
  | "alignLeft"
  | "alignHCenter"
  | "alignRight"
  | "alignTop"
  | "alignVCenter"
  | "alignBottom"
  | "distributeHorizontal"
  | "distributeVertical"
  | "matchWidth"
  | "matchHeight"
  | "matchBoth"
  | "editText"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "zoomFit"
  | "zoomSelection"
  | "exportSvg";

/** What an action needs from the shell beyond the editor itself. */
export interface ActionContext {
  readonly editor: Editor;
  /** Size of the canvas host in CSS pixels; zoom commands anchor on it. */
  readonly viewport: ViewportSize;
  /** Open the inline text editor on `id` (design editor-ux 3.3). */
  readonly requestEdit: (id: ElementId) => void;
  /** Run the export flow: a save dialog on desktop, a download on the web. */
  readonly exportSvg: () => void;
}

export interface EditorAction {
  readonly id: ActionId;
  readonly label: string;
  /** Display form of the shortcut, e.g. `"Cmd+D"`; absent when unbound. */
  readonly shortcut?: string;
  readonly group: ActionGroup;
  /** Exact: true only when `run` would change something. */
  readonly enabled: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext) => void;
}

/**
 * Pick the modifier name for shortcut hints from the platform. The table is
 * built once at module load; the hints are text, never matched against key
 * events, so a wrong guess costs a label and nothing else.
 */
function isApplePlatform(): boolean {
  const nav = (globalThis as { navigator?: { platform?: string } }).navigator;
  return /Mac|iPhone|iPad|iPod/.test(nav?.platform ?? "");
}

export const MODIFIER_LABEL: string = isApplePlatform() ? "Cmd" : "Ctrl";

function chord(...keys: readonly string[]): string {
  return keys.join("+");
}

const MOD = MODIFIER_LABEL;

/** Centre of the viewport in screen coordinates: the anchor for keyboard zoom. */
export function viewportCenter(viewport: ViewportSize): {
  x: number;
  y: number;
} {
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

function hasSelection({ editor }: ActionContext): boolean {
  return editor.selection.size > 0;
}

function pageHasElements({ editor }: ActionContext): boolean {
  return editor.store.getPageElements(editor.currentPageId).length > 0;
}

/** Units of the selection that align/distribute/match can move. */
function arrangeableUnits({ editor }: ActionContext): number {
  return selectionUnitsWithBounds(
    editor.store,
    editor.selection.ids(),
    editor.createShapeContext(),
  ).length;
}

function hasSelectedGroup({ editor }: ActionContext): boolean {
  for (const id of editor.selection.ids()) {
    const element = editor.store.get(id);
    if (element && isGroup(element)) {
      return true;
    }
  }
  return false;
}

function singleEditable({ editor }: ActionContext): ElementId | null {
  if (editor.selection.size !== 1) {
    return null;
  }
  const [id] = editor.selection.ids();
  return id !== undefined && editor.editableField(id) !== null ? id : null;
}

const EPSILON = 1e-6;

function alignAction(
  id: ActionId,
  label: string,
  mode: AlignMode,
): EditorAction {
  return {
    id,
    label,
    group: "align",
    enabled: (context) => arrangeableUnits(context) >= 2,
    run: ({ editor }) => {
      editor.alignSelection(mode);
    },
  };
}

function distributeAction(
  id: ActionId,
  label: string,
  axis: DistributeAxis,
): EditorAction {
  return {
    id,
    label,
    group: "distribute",
    enabled: (context) => arrangeableUnits(context) >= 3,
    run: ({ editor }) => {
      editor.distributeSelection(axis);
    },
  };
}

function matchSizeAction(
  id: ActionId,
  label: string,
  dimension: SizeDimension,
): EditorAction {
  return {
    id,
    label,
    group: "size",
    enabled: (context) => arrangeableUnits(context) >= 2,
    run: ({ editor }) => {
      editor.matchSelectionSize(dimension);
    },
  };
}

/** Every action, in menu order. */
export const EDITOR_ACTIONS: readonly EditorAction[] = [
  {
    id: "cut",
    label: "Cut",
    shortcut: chord(MOD, "X"),
    group: "clipboard",
    enabled: hasSelection,
    run: ({ editor }) => {
      editor.cutSelection();
    },
  },
  {
    id: "copy",
    label: "Copy",
    shortcut: chord(MOD, "C"),
    group: "clipboard",
    enabled: hasSelection,
    run: ({ editor }) => {
      editor.copySelection();
    },
  },
  {
    id: "paste",
    label: "Paste",
    shortcut: chord(MOD, "V"),
    group: "clipboard",
    enabled: ({ editor }) => editor.canPaste(),
    run: ({ editor }) => {
      editor.paste();
    },
  },
  {
    id: "duplicate",
    label: "Duplicate",
    shortcut: chord(MOD, "D"),
    group: "clipboard",
    enabled: hasSelection,
    run: ({ editor }) => {
      editor.duplicateSelection();
    },
  },
  {
    id: "delete",
    label: "Delete",
    shortcut: "Delete",
    group: "clipboard",
    enabled: hasSelection,
    run: ({ editor }) => {
      editor.deleteSelection();
    },
  },
  {
    id: "selectAll",
    label: "Select all",
    shortcut: chord(MOD, "A"),
    group: "clipboard",
    enabled: pageHasElements,
    run: ({ editor }) => {
      editor.selectAll();
    },
  },
  {
    id: "bringToFront",
    label: "Bring to front",
    shortcut: chord(MOD, "]"),
    group: "order",
    enabled: hasSelection,
    run: ({ editor }) => {
      editor.bringToFront();
    },
  },
  {
    id: "bringForward",
    label: "Bring forward",
    shortcut: "]",
    group: "order",
    enabled: hasSelection,
    run: ({ editor }) => {
      editor.bringForward();
    },
  },
  {
    id: "sendBackward",
    label: "Send backward",
    shortcut: "[",
    group: "order",
    enabled: hasSelection,
    run: ({ editor }) => {
      editor.sendBackward();
    },
  },
  {
    id: "sendToBack",
    label: "Send to back",
    shortcut: chord(MOD, "["),
    group: "order",
    enabled: hasSelection,
    run: ({ editor }) => {
      editor.sendToBack();
    },
  },
  {
    id: "group",
    label: "Group",
    shortcut: chord(MOD, "G"),
    group: "group",
    enabled: ({ editor }) =>
      selectionUnits(editor.store, editor.selection.ids()).length >= 2,
    run: ({ editor }) => {
      editor.groupSelection();
    },
  },
  {
    id: "ungroup",
    label: "Ungroup",
    shortcut: chord(MOD, "Shift", "G"),
    group: "group",
    enabled: hasSelectedGroup,
    run: ({ editor }) => {
      editor.ungroupSelection();
    },
  },
  alignAction("alignLeft", "Align left", "left"),
  alignAction("alignHCenter", "Align horizontal centres", "hcenter"),
  alignAction("alignRight", "Align right", "right"),
  alignAction("alignTop", "Align top", "top"),
  alignAction("alignVCenter", "Align vertical centres", "vcenter"),
  alignAction("alignBottom", "Align bottom", "bottom"),
  distributeAction(
    "distributeHorizontal",
    "Distribute horizontally",
    "horizontal",
  ),
  distributeAction("distributeVertical", "Distribute vertically", "vertical"),
  matchSizeAction("matchWidth", "Match width", "width"),
  matchSizeAction("matchHeight", "Match height", "height"),
  matchSizeAction("matchBoth", "Match size", "both"),
  {
    id: "editText",
    label: "Edit text",
    shortcut: "Enter",
    group: "text",
    enabled: (context) => singleEditable(context) !== null,
    run: (context) => {
      const id = singleEditable(context);
      if (id !== null) {
        context.requestEdit(id);
      }
    },
  },
  {
    id: "zoomIn",
    label: "Zoom in",
    shortcut: chord(MOD, "="),
    group: "zoom",
    enabled: ({ editor }) => editor.camera.get().z < MAX_ZOOM - EPSILON,
    run: ({ editor, viewport }) => {
      editor.zoomIn(viewportCenter(viewport));
    },
  },
  {
    id: "zoomOut",
    label: "Zoom out",
    shortcut: chord(MOD, "-"),
    group: "zoom",
    enabled: ({ editor }) => editor.camera.get().z > MIN_ZOOM + EPSILON,
    run: ({ editor, viewport }) => {
      editor.zoomOut(viewportCenter(viewport));
    },
  },
  {
    id: "zoomReset",
    label: "Zoom to 100 %",
    shortcut: chord(MOD, "0"),
    group: "zoom",
    enabled: ({ editor }) => Math.abs(editor.camera.get().z - 1) > EPSILON,
    run: ({ editor, viewport }) => {
      editor.resetZoom(viewportCenter(viewport));
    },
  },
  {
    id: "zoomFit",
    label: "Zoom to fit",
    shortcut: "Shift+1",
    group: "zoom",
    enabled: pageHasElements,
    run: ({ editor, viewport }) => {
      editor.zoomToFit(viewport);
    },
  },
  {
    id: "zoomSelection",
    label: "Zoom to selection",
    shortcut: "Shift+2",
    group: "zoom",
    enabled: hasSelection,
    run: ({ editor, viewport }) => {
      editor.zoomToSelection(viewport);
    },
  },
  {
    id: "exportSvg",
    label: "Export SVG",
    shortcut: chord(MOD, "Shift", "E"),
    group: "export",
    enabled: pageHasElements,
    run: (context) => {
      context.exportSvg();
    },
  },
];

const ACTIONS_BY_ID: ReadonlyMap<ActionId, EditorAction> = new Map(
  EDITOR_ACTIONS.map((action) => [action.id, action]),
);

/** Look an action up by id. Throws on an unknown id: the table is static. */
export function getAction(id: ActionId): EditorAction {
  const action = ACTIONS_BY_ID.get(id);
  if (!action) {
    throw new Error(`unknown editor action: ${id}`);
  }
  return action;
}

export function actionsInGroup(group: ActionGroup): readonly EditorAction[] {
  return EDITOR_ACTIONS.filter((action) => action.group === group);
}

/** `"Label (Shortcut)"` for button titles (design editor-ux 12). */
export function actionTitle(action: EditorAction): string {
  return action.shortcut
    ? `${action.label} (${action.shortcut})`
    : action.label;
}

/** Run an action only when its enabled rule says it would do something. */
export function runAction(
  action: EditorAction,
  context: ActionContext,
): boolean {
  if (!action.enabled(context)) {
    return false;
  }
  action.run(context);
  return true;
}
