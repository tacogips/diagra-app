// IO adapters: JSONL persistence and import/export (SVG, PNG, Mermaid, D2).
// Adapters consume and produce the Diagram IR only — no editor, no Yjs, no
// DOM, no framework.
//
// Phase 1 (design section 11) ships JSONL in/out; later adapters land here.

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
