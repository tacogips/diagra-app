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
