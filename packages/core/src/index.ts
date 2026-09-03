// Editor core: framework-agnostic store, camera, selection, history,
// shape utils, and commands. Must not touch the DOM.

export {
  type AlignMode,
  type DistributeAxis,
  planAlign,
  planDistribute,
  planMatchSize,
  selectionUnitsWithBounds,
  type SizeDimension,
} from "./align.ts";
export {
  Camera,
  type CameraListener,
  type CameraState,
  clampZoom,
  type FitOptions,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomStep,
  type ViewportSize,
  ZOOM_STEPS,
} from "./camera.ts";
export {
  Clipboard,
  type ClipboardPayload,
  copyElements,
  PASTE_OFFSET,
  type PastePlan,
  planPaste,
  type PasteOptions,
} from "./clipboard.ts";
export {
  applyCommands,
  type Command,
  CommandError,
  type CommandResult,
} from "./commands.ts";
export {
  type ApplyOptions,
  type CreateElementOptions,
  type CreatePageOptions,
  type EditableField,
  Editor,
  type EditorListener,
  type EditorOptions,
  type StylePatch,
} from "./editor.ts";
export {
  compareFractional,
  isFractionalKey,
  keyAfter,
  keyBetween,
  type Rng,
} from "./fractional.ts";
export {
  type Box,
  boxCenter,
  boxContains,
  diamondContains,
  distanceToSegment,
  ellipseBoundaryIntersection,
  ellipseContains,
  normalizeBox,
  rectBoundaryIntersection,
  unionBoxes,
  type Vec,
} from "./geometry.ts";
export {
  ancestorChain,
  expandGroups,
  GROUP_TYPE,
  type GroupPlan,
  groupOf,
  groupShapeUtil,
  isGroup,
  leafElements,
  memberIdsOf,
  outermostGroupOf,
  planGroup,
  planUngroup,
  resolveSelectionTarget,
  selectionUnits,
  topLevelIds,
} from "./group.ts";
export {
  History,
  type HistoryEntry,
  HISTORY_LIMIT,
  type HistoryListener,
  type HistoryRunner,
} from "./history.ts";
export {
  createShapeContext,
  type HitTestOptions,
  hitTestPoint,
} from "./hit-test.ts";
export { type IdSource, isElementIdFormat, newElementId } from "./ids.ts";
export {
  detachReference,
  isEmptyGroup,
  referencesOf,
  remapReferences,
  removeAtPath,
  selfContained,
} from "./references.ts";
export {
  getSelectionBounds,
  Selection,
  type SelectionListener,
} from "./selection.ts";
export {
  type ShapeContext,
  type ShapeUtil,
  ShapeUtilRegistry,
} from "./shape-util.ts";
export {
  TEXT_NOTE_DEFAULT_HEIGHT,
  TEXT_NOTE_DEFAULT_WIDTH,
  textNoteBounds,
  textNoteShapeUtil,
  textNoteText,
} from "./shapes/textNote.ts";
export {
  NO_SNAP,
  type ResizeEdges,
  type SnapGuide,
  type SnapOptions,
  type SnapResult,
  snapResize,
  snapTranslate,
} from "./snap.ts";
export {
  CONNECTOR_HIT_TOLERANCE,
  type ConnectorDecoration,
  type ConnectorEndpoints,
  connectorDecoration,
  connectorEndpoints,
  createConnectorUtil,
  type EndpointReader,
  endpointReaderFor,
  type MarkerKind,
  readDirectEndpoints,
  readTableEndpoints,
  resolveConnector,
} from "./shapes/connector.ts";
export { edgeShapeUtil } from "./shapes/edge.ts";
export { erdRelationShapeUtil } from "./shapes/erdRelation.ts";
export {
  ERD_TABLE_DEFAULT_WIDTH,
  ERD_TABLE_HEADER_HEIGHT,
  ERD_TABLE_ROW_HEIGHT,
  erdColumnCount,
  erdTableBounds,
  erdTableShapeUtil,
} from "./shapes/erdTable.ts";
export {
  type GeoOutline,
  geoOutline,
} from "./shapes/geo-outline.ts";
export {
  GEO_DEFAULT_HEIGHT,
  GEO_DEFAULT_WIDTH,
  geoBounds,
  geoShapeUtil,
} from "./shapes/geo.ts";
export { createDefaultRegistry } from "./shapes/index.ts";
export {
  NODE_DEFAULT_HEIGHT,
  NODE_DEFAULT_WIDTH,
  nodeBounds,
  nodeShapeUtil,
} from "./shapes/node.ts";
export { umlAssociationShapeUtil } from "./shapes/umlAssociation.ts";
export {
  UML_CLASS_DEFAULT_WIDTH,
  UML_CLASS_NAME_HEIGHT,
  UML_CLASS_ROW_HEIGHT,
  UML_CLASS_STEREOTYPE_HEIGHT,
  umlAttributesHeight,
  umlClassBounds,
  umlClassShapeUtil,
  umlMethodsHeight,
  umlNameHeight,
} from "./shapes/umlClass.ts";
export { unknownShapeUtil } from "./shapes/unknown.ts";
export {
  type DocumentMeta,
  Store,
  type StoreCommit,
  type StoreDiff,
  type StoreListener,
} from "./store.ts";
export {
  DEFAULT_SVG_THEME,
  escapeXml,
  renderElementsSvg,
  renderPageSvg,
  renderSelectionSvg,
  type SvgExportOptions,
  type SvgTheme,
} from "./svg-export.ts";
export {
  planZOrder,
  reorderCommands,
  targetOrder,
  type ZOrderAction,
} from "./z-order.ts";
