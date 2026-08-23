// JSONL parsing: newline-delimited JSON -> IR document.
// See the product design (diagra-cloud repo), section 6.

import {
  type Document,
  type DocumentSnapshot,
  type Element,
  error,
  formatIssue,
  hasErrors,
  isPlainObject,
  type Migration,
  migrateSnapshot,
  type Page,
  SchemaMigrationError,
  type UnknownRecord,
  type ValidationIssue,
  validateDocument,
  VISUAL_STYLE_KEY_ORDER,
  type Visual,
} from "@diagra/ir";
import { setField } from "./objects.ts";
import {
  DOCUMENT_KIND,
  DOCUMENT_RECORD_KEYS,
  ELEMENT_KIND,
  ELEMENT_RECORD_KEYS,
  PAGE_KIND,
  PAGE_RECORD_KEYS,
} from "./records.ts";

/** Byte order mark; some editors prepend one to UTF-8 text files. */
const BOM = "\uFEFF";

const VISUAL_KEYS: readonly string[] = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "style",
];

export interface ParseOptions {
  /** Run document validation after migration. Default `true`. */
  readonly validate?: boolean;
  /** Migration chain override; defaults to the registered chain. */
  readonly migrations?: readonly Migration[];
  /** Schema version to migrate to; defaults to `SCHEMA_VERSION`. */
  readonly targetVersion?: number;
}

export type ParseResult =
  | {
      readonly ok: true;
      readonly document: Document;
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly document?: undefined;
      readonly issues: readonly ValidationIssue[];
    };

export class DocumentParseError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const errors = issues.filter((issue) => issue.severity === "error");
    super(
      `failed to parse JSONL document: ${errors.length} error(s)\n${errors
        .map(formatIssue)
        .join("\n")}`,
    );
    this.name = "DocumentParseError";
    this.issues = issues;
  }
}

/**
 * Split a record into its modelled keys and an `extensions` bag holding
 * everything this build does not model, so reserializing loses nothing.
 */
function split(
  record: Readonly<Record<string, unknown>>,
  known: readonly string[],
): {
  readonly known: Record<string, unknown>;
  readonly extensions?: Record<string, unknown>;
} {
  const knownSet = new Set(known);
  const kept: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  let hasExtra = false;
  for (const key of Object.keys(record)) {
    // setField, not `kept[key] =`: a `__proto__` key off disk would otherwise
    // hit the inherited setter and vanish. See ./objects.ts.
    if (knownSet.has(key)) {
      setField(kept, key, record[key]);
    } else {
      setField(extra, key, record[key]);
      hasExtra = true;
    }
  }
  return hasExtra ? { known: kept, extensions: extra } : { known: kept };
}

function parseVisual(raw: unknown): Visual {
  if (raw === undefined) {
    return {};
  }
  if (!isPlainObject(raw)) {
    // A non-object `visual` is kept exactly as written so validation can
    // name the offending value, and so `{ validate: false }` on both ends
    // still round-trips it. `serializeDocument` writes it back through
    // unchanged; see `visualRecord` in ./serialize.ts.
    return raw as Visual;
  }
  const outer = split(raw, VISUAL_KEYS);
  const visual: Record<string, unknown> = { ...outer.known };
  if (outer.extensions) {
    visual["extensions"] = outer.extensions;
  }
  const style = visual["style"];
  if (isPlainObject(style)) {
    const inner = split(style, VISUAL_STYLE_KEY_ORDER.keys);
    const flatStyle: Record<string, unknown> = { ...inner.known };
    if (inner.extensions) {
      flatStyle["extensions"] = inner.extensions;
    }
    visual["style"] = flatStyle;
  }
  return visual as Visual;
}

function pushLineError(
  issues: ValidationIssue[],
  line: number,
  code: string,
  message: string,
): void {
  issues.push(error(code, `line ${line}`, message));
}

interface Collected {
  readonly issues: ValidationIssue[];
  readonly pages: Page[];
  readonly elements: Element[];
  readonly unknownRecords: UnknownRecord[];
  documentRecord?: Record<string, unknown>;
  documentLine?: number;
}

function collect(text: string): Collected {
  const collected: Collected = {
    issues: [],
    pages: [],
    elements: [],
    unknownRecords: [],
  };
  // Tolerate a leading BOM and CRLF line endings; writers emit neither.
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const lines = body.split(/\r?\n/);

  for (const [i, raw] of lines.entries()) {
    const lineNumber = i + 1;
    if (raw.trim().length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      pushLineError(
        collected.issues,
        lineNumber,
        "json.invalid",
        `not valid JSON: ${(cause as Error).message}`,
      );
      continue;
    }

    if (!isPlainObject(parsed)) {
      pushLineError(
        collected.issues,
        lineNumber,
        "record.notObject",
        "each JSONL record must be a JSON object",
      );
      continue;
    }

    const kind = parsed["kind"];
    if (typeof kind !== "string" || kind.length === 0) {
      pushLineError(
        collected.issues,
        lineNumber,
        "record.kindMissing",
        'record is missing a non-empty string "kind"',
      );
      continue;
    }

    if (kind === DOCUMENT_KIND) {
      if (collected.documentRecord) {
        pushLineError(
          collected.issues,
          lineNumber,
          "record.duplicateDocument",
          `a second document record; the first was on line ${collected.documentLine}`,
        );
        continue;
      }
      collected.documentRecord = parsed;
      collected.documentLine = lineNumber;
      continue;
    }

    if (kind === PAGE_KIND) {
      const { known, extensions } = split(parsed, PAGE_RECORD_KEYS);
      const page: Record<string, unknown> = {
        id: known["id"],
        name: known["name"],
        kind: known["pageKind"],
      };
      if (extensions) {
        page["extensions"] = extensions;
      }
      collected.pages.push(page as unknown as Page);
      continue;
    }

    if (kind === ELEMENT_KIND) {
      const { known, extensions } = split(parsed, ELEMENT_RECORD_KEYS);
      const element: Record<string, unknown> = {
        id: known["id"],
        page: known["page"],
        type: known["type"],
        index: known["index"],
        semantic: known["semantic"] ?? {},
        visual: parseVisual(known["visual"]),
      };
      if (extensions) {
        element["extensions"] = extensions;
      }
      collected.elements.push(element as unknown as Element);
      continue;
    }

    const { extensions } = split(parsed, ["kind"]);
    collected.unknownRecords.push({ kind, data: extensions ?? {} });
  }

  return collected;
}

function buildSnapshot(collected: Collected): DocumentSnapshot | undefined {
  const record = collected.documentRecord;
  if (!record) {
    collected.issues.push(
      error(
        "record.documentMissing",
        "",
        'no {"kind":"document"} record found',
      ),
    );
    return undefined;
  }

  const { known, extensions } = split(record, DOCUMENT_RECORD_KEYS);
  const schemaVersion = known["schemaVersion"];
  if (typeof schemaVersion !== "number") {
    collected.issues.push(
      error(
        "field.missing",
        `line ${collected.documentLine}`,
        "document record requires a numeric schemaVersion",
      ),
    );
    return undefined;
  }

  const snapshot: DocumentSnapshot = {
    schemaVersion,
    id: known["id"],
    title: known["title"],
    pages: collected.pages,
    elements: collected.elements,
  };
  if (collected.unknownRecords.length > 0) {
    snapshot["unknownRecords"] = collected.unknownRecords;
  }
  if (extensions) {
    snapshot["extensions"] = extensions;
  }
  return snapshot;
}

/**
 * Parse JSONL without throwing.
 *
 * Blank lines are skipped, a leading BOM and CRLF endings are tolerated, and
 * record order is ignored — only writers must sort. Records whose `kind` is
 * unknown, and unknown fields on known records, are preserved so
 * `serializeDocument` can write them back out.
 */
export function parseDocumentResult(
  text: string,
  options: ParseOptions = {},
): ParseResult {
  const collected = collect(text);
  const issues = collected.issues;
  const snapshot = buildSnapshot(collected);

  if (!snapshot || hasErrors(issues)) {
    return { ok: false, issues };
  }

  let migrated: DocumentSnapshot;
  try {
    migrated = migrateSnapshot(snapshot, {
      migrations: options.migrations,
      targetVersion: options.targetVersion,
    });
  } catch (cause) {
    if (cause instanceof SchemaMigrationError) {
      issues.push(error("schema.migration", "schemaVersion", cause.message));
      return { ok: false, issues };
    }
    throw cause;
  }

  const document = migrated as unknown as Document;
  if (options.validate !== false) {
    issues.push(...validateDocument(document));
    if (hasErrors(issues)) {
      return { ok: false, issues };
    }
  }
  return { ok: true, document, issues };
}

/**
 * Parse JSONL into a document, throwing {@link DocumentParseError} when the
 * text is malformed or the document fails validation. Warnings (unknown
 * element types, dangling references) do not throw.
 */
export function parseDocument(
  text: string,
  options: ParseOptions = {},
): Document {
  const result = parseDocumentResult(text, options);
  if (!result.ok) {
    throw new DocumentParseError(result.issues);
  }
  return result.document;
}
