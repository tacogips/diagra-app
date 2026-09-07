// IO adapters: JSONL persistence and import/export (SVG, PNG, Mermaid, D2).
// Adapters consume and produce the Diagram IR only — no editor, no Yjs, no
// DOM, no framework.
//
// JSONL persistence and deterministic Mermaid semantic export ship here;
// remaining interchange adapters can extend the same runtime-agnostic surface.

export {
  compareStrings,
  roundCoordinate,
  stringifyCanonical,
  writeValue,
} from "./jsonl/canonical.ts";
export {
  DocumentParseError,
  type ParseOptions,
  type ParseResult,
  parseDocument,
  parseDocumentResult,
} from "./jsonl/parse.ts";
export {
  DOCUMENT_KIND,
  DOCUMENT_RECORD_KEYS,
  ELEMENT_KIND,
  ELEMENT_RECORD_KEYS,
  KNOWN_RECORD_KINDS,
  PAGE_KIND,
  PAGE_RECORD_KEYS,
} from "./jsonl/records.ts";
export {
  type SerializeOptions,
  serializeDocument,
} from "./jsonl/serialize.ts";
export {
  MERMAID_DIAGRAM_KINDS,
  type MermaidDiagramKind,
  type MermaidExportReport,
  type MermaidExportWarning,
  availableMermaidKinds,
  exportMermaid,
} from "./mermaid/export.ts";
export {
  type MermaidImportOptions,
  type MermaidImportReport,
  type MermaidImportWarning,
  MermaidParseError,
  importMermaid,
} from "./mermaid/import.ts";
export {
  type D2ExportReport,
  type D2ExportWarning,
  exportD2,
} from "./d2/export.ts";
