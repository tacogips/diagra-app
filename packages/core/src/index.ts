// Editor core: framework-agnostic store, camera, selection, history,
// shape utils, and commands. Must not touch the DOM.
export {
  booleanGeometry,
  booleanGeometryContains,
  canFlattenBooleanGroup,
  booleanMaskBody,
  booleanMaskCss,
  booleanMaskDefinition,
  booleanResultGeometry,
  booleanSourcePolygon,
  booleanSourceGeometry,
  planBooleanGroup,
  planFlattenBooleanGroup,
  type FlattenBooleanPlan,
  type BooleanGeometry,
  type BooleanMultiPolygon,
  type BooleanPolygon,
  setGroupBooleanOperation,
} from "./boolean-operations.ts";
export {
  fontFeatureCss,
  fontVariationCss,
} from "./font-settings.ts";
export {
  canCopySelectionStyle,
  canPasteSelectionStyle,
  copySelectionStyle,
  pasteSelectionStyle,
} from "./style-clipboard.ts";

export {
  artboardOrientationIssue,
  swapArtboardOrientation,
} from "./artboard-orientation.ts";

export {
  type AccessibilityPatch,
  updateElementAccessibility,
} from "./accessibility.ts";
export {
  type AccessibilityAuditIssue,
  type AccessibilityAuditReport,
  type AccessibilityAuditSeverity,
  auditAccessibility,
  colorContrastRatio,
} from "./accessibility-audit.ts";
export {
  canFrameSelection,
  planFrameSelection,
  type FrameSelectionPlan,
} from "./frame-selection.ts";
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
  rotatePoint,
  boxContains,
  diamondContains,
  distanceToSegment,
  ellipseBoundaryIntersection,
  ellipseContains,
  normalizeBox,
  rectBoundaryIntersection,
  rotatedBox,
  unionBoxes,
  type Vec,
} from "./geometry.ts";
export { avoidOrthogonalObstacles } from "./orthogonal-routing.ts";
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
  addPageGuide,
  DEFAULT_GUIDE_COLOR,
  type PageGuide,
  type PageGuidePatch,
  pageGuides,
  readPageGuide,
  removePageGuide,
  updatePageGuide,
} from "./page-guides.ts";
export {
  createReviewComment,
  focusReviewComment,
  isReviewComment,
  moveReviewComment,
  type NewReviewMessage,
  replyToReviewComment,
  reviewComments,
  type ReviewCommentThread,
  setReviewCommentResolved,
} from "./comments.ts";
export {
  ReviewCommentPinDrag,
  type ReviewCommentPinPreview,
} from "./comment-pin-drag.ts";
export {
  bindSelectionTextStyle,
  createTextStyle,
  DEFAULT_TYPOGRAPHY_STYLE,
  planTextStyles,
  selectionTextStyleBinding,
  selectionTypography,
  textStyles,
  TYPOGRAPHY_FIELDS,
  typographyOf,
  updateTextStyle,
} from "./text-styles.ts";
export {
  normalizeTextMarks,
  rebaseTextMarks,
  removeTextMarkRange,
  richTextSegments,
  safeTextLinkHref,
  type RichTextSegment,
  textNoteMarks,
  textRangeHasMark,
  toggleTextMarkRange,
} from "./rich-text.ts";
export {
  composeImageCrop,
  croppedImageBox,
  cropFromCorners,
  fullImageCrop,
  MIN_IMAGE_CROP,
} from "./image-crop.ts";
export {
  addLayoutGrid,
  defaultLayoutGrid,
  isValidLayoutGrid,
  layoutGridBands,
  type LayoutGridBand,
  type LayoutGridKind,
  MAX_LAYOUT_GRIDS,
  removeLayoutGrid,
  updateLayoutGrid,
} from "./layout-grid.ts";
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
  AVERAGE_GLYPH_WIDTH,
  measureTextNote,
  MAX_AUTO_TEXT_SIZE,
  planTextResize,
  TEXT_NOTE_FONT_SIZE,
  TEXT_NOTE_LINE_HEIGHT,
  TEXT_NOTE_PADDING_X,
  TEXT_NOTE_PADDING_Y,
  textOwnsAxis,
  wrapTextLines,
} from "./text-layout.ts";
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
  connectorDefaultDash,
  connectorDecoration,
  connectorEndpoints,
  connectorWaypointFromPage,
  connectorWaypointToPage,
  connectorWaypointsWithInsertion,
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
  erdColumnKey,
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
export {
  type FramePreset,
  type FramePresetKey,
  FRAME_PRESETS,
  frameBounds,
  frameShapeUtil,
  safeAreaContentBox,
} from "./shapes/frame.ts";
export { expandContainers, frameParents } from "./frame-tree.ts";
export {
  prototypeScreen,
  prototypeDelayedLink,
  prototypeSmartPlan,
  prototypeSmartPlanBetween,
  prototypeSmartSteps,
  type PrototypeSmartPaint,
  type PrototypeSmartPlan,
  type PrototypeSmartStep,
} from "./prototype.ts";
export { freehandGeometry } from "./shapes/freehand.ts";
export {
  pressureStrokeContains,
  pressureStrokeOutline,
  type PressureStrokeOutline,
  type PressureStrokeSample,
} from "./pressure-stroke.ts";
export { FreehandGesture } from "./freehand-gesture.ts";
export { inspectDesign } from "./handoff.ts";
export {
  generateInterfaceCode,
  type InterfaceCode,
} from "./interface-code.ts";
export {
  generateResponsiveInterfaceCode,
  type ResponsiveInterfaceBreakpoint,
  type ResponsiveInterfaceCode,
} from "./responsive-interface-code.ts";
export {
  generateAdaptiveMobileInterfaceCode,
  generateMobileInterfaceCode,
  type AdaptiveMobileBreakpoint,
  type AdaptiveMobileInterfaceCode,
  type MobileAssetReference,
  type MobileCodeOptions,
  type MobileInterfaceCode,
} from "./mobile-code.ts";
export {
  clipCss,
  insideClip,
  layerClipPolygons,
  polygonBounds,
  visibleBounds,
} from "./clipping.ts";
export {
  backdropEffectsCss,
  shadowCss,
  effectsCss,
  effectBounds,
  effectsBounds,
  layerEffects,
} from "./effects.ts";
export {
  angularGradientPatches,
  diamondGradientPatches,
  type GradientPatch,
  gradientCss,
  gradientId,
  linearGradientVector,
  sampleGradient,
  strokeGradientId,
} from "./gradient.ts";
export {
  type GradientHandle,
  type GradientHandleGeometry,
  gradientHandleGeometry,
  moveGradientHandle,
  setElementFillGradient,
  setElementStrokeGradient,
} from "./gradient-handles.ts";
export { componentOverrides } from "./component-overrides.ts";
export {
  addComponentVariantProperty,
  type ComponentVariantAxis,
  componentVariantAxes,
  componentVariants,
  MAX_VARIANT_PROPERTIES,
  removeComponentVariantProperty,
  switchComponentVariantProperty,
  updateComponentVariantProperty,
} from "./component-variants.ts";
export { strokePagePoints, planStrokePoints } from "./stroke-edit.ts";
export { strokeWorldPoints, planStrokeWorldPoints } from "./stroke-world.ts";
export {
  planFitStrokeWorldBounds,
  planStrokeWorldClosed,
} from "./stroke-world.ts";
export { StrokeAnchorDrag } from "./stroke-drag.ts";
export { strokePath, splitStrokeSegment } from "./stroke-path.ts";
export {
  compoundPathGeometry,
  compoundPathMaskCss,
  compoundPathShapeUtil,
  type CompoundPathGeometry,
} from "./shapes/compound-path.ts";
export { moveStrokeAnchor } from "./stroke-edit.ts";
export {
  pathWorldContours,
  planPathWorldContours,
  PathAnchorDrag,
} from "./compound-path-edit.ts";
export { planFitStrokeBounds } from "./stroke-edit.ts";
export { planStrokeClosed } from "./stroke-edit.ts";
export { insertUiBlock, UI_BLOCKS, type UiBlock } from "./ui-blocks.ts";
export { prototypeFitScale } from "./prototype-scale.ts";
export { layerName, renameLayer } from "./layer-name.ts";
export { layerSearchMatchIds, selectLayerSearchMatches } from "./layer-tree.ts";
export {
  previewNoteTextReplacement,
  replaceSelectedNoteText,
} from "./replace-note-text.ts";
export {
  componentInstancesOnPage,
  selectComponentInstances,
} from "./component-selection.ts";
export {
  matchingLayerIds,
  selectMatchingLayers,
  type LayerMatch,
} from "./matching-layers.ts";
export {
  previewLayerNames,
  renameSelectedLayers,
  type LayerRenameOptions,
} from "./batch-layer-names.ts";
export { layerRows, selectLayerRow } from "./layer-tree.ts";
export { canBeMask, groupMaskCandidates, setGroupMask } from "./masks.ts";
export {
  cornerRadiiCss,
  normalizedCornerRadii,
  resolvedCornerRadii,
  roundedRectPath,
  roundedRectPolygon,
  unevenRoundedBoxContains,
} from "./corner-radii.ts";
export {
  canRotateElement,
  canRotateSelection,
  rotateElement,
  rotateSelectionBy,
} from "./rotation.ts";
export {
  canResizeSelection,
  createSelectionResizeSnapshot,
  resizeSelection,
  type SelectionResizeItem,
  type SelectionResizeSnapshot,
} from "./selection-resize.ts";
export {
  aspectSize,
  boundedAspectSize,
  planAspectRatios,
  supportsAspectRatio,
  type AspectDriver,
} from "./aspect-ratio.ts";
export { overlapsVisibleElement } from "./selection-geometry.ts";
export {
  DATABASE_DIALECTS,
  generateDatabaseDdl,
  type DatabaseDdl,
  type DatabaseDialect,
} from "./database-ddl.ts";
export {
  paletteHandoff,
  colorTokenCssName,
  measurementHandoff,
  numberTokenCssName,
  textStyleCssName,
  typographyCssValue,
  typographyHandoff,
} from "./token-handoff.ts";
export {
  colorTokens,
  bindSelectionColor,
  selectionColorBindings,
  createColorToken,
  setColorTokenAlias,
  updateColorToken,
} from "./color-tokens.ts";
export {
  NUMBER_FIELDS,
  CORNER_NUMBER_FIELDS,
  CORNER_STYLE_FIELDS,
  SIZE_FIELDS,
  SIZE_LIMIT_FIELDS,
  STYLE_NUMBER_FIELDS,
  LAYOUT_NUMBER_FIELDS,
  numberTokens,
  bindSelectionNumber,
  selectionNumberBindings,
  createNumberToken,
  setNumberTokenAlias,
  updateNumberToken,
  planNumberTokens,
  type NumberField,
  type CornerNumberField,
} from "./number-tokens.ts";
export {
  activeTokenAlias,
  designTokenModes,
  pageTokenMode,
  resolveColorToken,
  resolveNumberToken,
  type TokenResolution,
} from "./token-values.ts";
export {
  removeDesignTokenMode,
  renameDesignTokenMode,
} from "./token-modes.ts";
