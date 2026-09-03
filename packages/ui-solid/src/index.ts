// Solid renderer: canvas, shape views, handles, toolbars.
// The only package allowed to touch the DOM besides app shells.

export { createEditorSignals, type EditorSignals } from "./adapter.ts";
export { type DiagraCanvasProps, DiagraCanvas } from "./Canvas.tsx";
export {
  createInteraction,
  type Interaction,
  type InteractionOptions,
  MIN_SHAPE_SIZE,
  type PendingConnection,
  RESIZE_HANDLES,
  type ResizeHandle,
  resizeBox,
} from "./interaction.ts";
export {
  ConnectorMarkers,
  ConnectorView,
  type ConnectorViewProps,
} from "./shapes/ConnectorView.tsx";
export { ErdTableView } from "./shapes/ErdTableView.tsx";
export { GeoShapeView } from "./shapes/GeoShapeView.tsx";
export { NodeView } from "./shapes/NodeView.tsx";
export { ShapeView, type ShapeViewProps } from "./shapes/ShapeView.tsx";
export { UmlClassView } from "./shapes/UmlClassView.tsx";
export { Toolbar, type ToolbarProps } from "./Toolbar.tsx";
export {
  type CreationTool,
  creationFor,
  GEO_TOOLS,
  TOOLS,
  type ToolKind,
} from "./tools.ts";
export {
  type ActionContext,
  type ActionGroup,
  type ActionId,
  actionsInGroup,
  actionTitle,
  EDITOR_ACTIONS,
  type EditorAction,
  getAction,
  MODIFIER_LABEL,
  runAction,
  viewportCenter,
} from "./shortcuts.ts";
export {
  clampToHost,
  ContextMenu,
  type ContextMenuProps,
} from "./ContextMenu.tsx";
export {
  FILL_PALETTE,
  placeAbove,
  SelectionToolbar,
  type SelectionToolbarProps,
  STROKE_PALETTE,
  type Swatch,
} from "./SelectionToolbar.tsx";
export {
  formatZoom,
  ZoomControls,
  type ZoomControlsProps,
} from "./ZoomControls.tsx";
export { PageTabs, type PageTabsProps } from "./PageTabs.tsx";
export {
  type ConnectorEnd,
  type ContextMenuPoint,
  type EditRegion,
  editRegionAt,
  handleEdges,
  isEditableTarget,
  NUDGE_COALESCE_MS,
  NUDGE_GRID_STEP,
  NUDGE_STEP,
  type ResizeModifiers,
  resizeBoxConstrained,
  type Scheduler,
  SLOT_LAYER_CLASS,
  SNAP_GRID,
  SNAP_THRESHOLD_PX,
  type SnapSettings,
} from "./interaction.ts";
export {
  Inspector,
  type InspectorFocus,
  type InspectorProps,
} from "./Inspector.tsx";
export {
  type PaletteEntry,
  STYLE_PALETTE,
  type StylePalette,
} from "./inspector/palette.ts";
export { TextNoteView } from "./shapes/TextNoteView.tsx";
export {
  TextEditor,
  type TextEditorProps,
  type TextEditorTarget,
} from "./TextEditor.tsx";
