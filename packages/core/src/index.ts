// Editor core: framework-agnostic store, camera, selection, history,
// shape utils, and commands. Must not touch the DOM.

export {
  Camera,
  type CameraListener,
  type CameraState,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
} from "./camera.ts";
export {
  applyCommands,
  type Command,
  CommandError,
  type CommandResult,
} from "./commands.ts";
export {
  type ApplyOptions,
  type CreateElementOptions,
  Editor,
  type EditorListener,
  type EditorOptions,
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
  History,
  type HistoryEntry,
  HISTORY_LIMIT,
  type HistoryRunner,
} from "./history.ts";
export {
  createShapeContext,
  type HitTestOptions,
  hitTestPoint,
} from "./hit-test.ts";
export { type IdSource, isElementIdFormat, newElementId } from "./ids.ts";
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
  CONNECTOR_HIT_TOLERANCE,
  type ConnectorEndpoints,
  connectorEndpoints,
  createConnectorUtil,
  type EndpointReader,
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
