// JSONL serialization: IR document -> deterministic newline-delimited JSON.
// See the product design (diagra-cloud repo), section 6.

import {
  assertValidDocument,
  type Document,
  type Element,
  getElementTypeDefinition,
  isPlainObject,
  type Page,
  type UnknownRecord,
  type Visual,
} from "@diagra/ir";
import { compareStrings, stringifyCanonical } from "./canonical.ts";
import { setField } from "./objects.ts";
import {
  DOCUMENT_KIND,
  DOCUMENT_RECORD_ORDER,
  ELEMENT_KIND,
  elementRecordOrder,
  PAGE_KIND,
  PAGE_RECORD_ORDER,
  UNKNOWN_RECORD_ORDER,
} from "./records.ts";

export interface SerializeOptions {
  /**
   * Validate before writing and throw on errors. On by default: writing an
   * invalid document to a user's file is worse than failing loudly.
   */
  readonly validate?: boolean;
  /** Terminate the last line with `\n`. Default `true`. */
  readonly trailingNewline?: boolean;
}

/**
 * Copy own defined properties, then splice the `extensions` bag back in as
 * plain fields. Extensions never shadow a modelled key: `parse` only ever
 * puts unmodelled keys in the bag, and a hand-built document that violates
 * that keeps the modelled value.
 */
function flatten(
  source: object,
  skip: readonly string[] = [],
): Record<string, unknown> {
  const entries = source as Record<string, unknown>;
  const skipped = new Set(["extensions", ...skip]);
  const record: Record<string, unknown> = {};
  // setField, not `record[key] =`, throughout: a `__proto__` key would
  // otherwise hit the inherited setter and vanish. See ./objects.ts.
  for (const key of Object.keys(entries)) {
    if (skipped.has(key)) {
      continue;
    }
    const value = entries[key];
    if (value !== undefined) {
      setField(record, key, value);
    }
  }
  const extensions = entries["extensions"];
  if (isPlainObject(extensions)) {
    for (const key of Object.keys(extensions)) {
      if (!Object.hasOwn(record, key)) {
        setField(record, key, extensions[key]);
      }
    }
  }
  return record;
}

/** Pages, elements and unknown records are their own lines, not fields. */
const DOCUMENT_LINE_ONLY_FIELDS = ["pages", "elements", "unknownRecords"];

function documentLine(document: Document): string {
  const record = flatten(document, DOCUMENT_LINE_ONLY_FIELDS);
  record["kind"] = DOCUMENT_KIND;
  return stringifyCanonical(record, DOCUMENT_RECORD_ORDER);
}

function pageLine(page: Page): string {
  const record = flatten(page);
  // `kind` is the record discriminator, so the page's diagram kind is
  // written as `pageKind`.
  record["pageKind"] = record["kind"];
  record["kind"] = PAGE_KIND;
  return stringifyCanonical(record, PAGE_RECORD_ORDER);
}

/**
 * The value to write as `visual`, or `undefined` to omit the key.
 *
 * A non-object visual is written back exactly as `parseVisual` kept it, so
 * `{ validate: false }` on both ends still round-trips a malformed file
 * rather than quietly deleting the field.
 */
function visualRecord(visual: Visual | undefined): unknown {
  if (visual === undefined) {
    return undefined;
  }
  if (!isPlainObject(visual)) {
    return visual;
  }
  const record = flatten(visual, ["style"]);
  const style = visual.style;
  if (isPlainObject(style)) {
    const flatStyle = flatten(style);
    if (Object.keys(flatStyle).length > 0) {
      record["style"] = flatStyle;
    }
  } else if (style !== undefined) {
    // Same contract as the visual itself: a malformed style is written back
    // as it was read rather than deleted.
    record["style"] = style;
  }
  // An empty visual carries no information, so it is dropped; parsing an
  // element without `visual` yields `{}` again, keeping the round trip exact.
  return Object.keys(record).length > 0 ? record : undefined;
}

function elementLine(element: Element): string {
  const definition = getElementTypeDefinition(element.type);
  const record = flatten(element, ["semantic", "visual"]);
  record["kind"] = ELEMENT_KIND;
  record["semantic"] = element.semantic ?? {};
  record["visual"] = visualRecord(element.visual);
  return stringifyCanonical(record, elementRecordOrder(definition?.keyOrder));
}

function unknownLine(record: UnknownRecord): string {
  const merged: Record<string, unknown> = { ...record.data };
  merged["kind"] = record.kind;
  return stringifyCanonical(merged, UNKNOWN_RECORD_ORDER);
}

function comparePages(left: Page, right: Page): number {
  return compareStrings(left.id, right.id);
}

function compareElements(left: Element, right: Element): number {
  const byPage = compareStrings(left.page, right.page);
  if (byPage !== 0) {
    return byPage;
  }
  return compareStrings(left.id, right.id);
}

/**
 * Serialize a document to JSONL.
 *
 * Determinism (design section 6): the document record first, then pages by
 * id, then elements by page then id, then any record kind this build does
 * not model — those sort by their canonical text, which starts with `kind`,
 * since they have no id we can rely on. Keys follow the declared order for
 * the record and for the element's registered semantic payload; unknown
 * fields follow, sorted by code unit. Coordinates are rounded to 0.01.
 *
 * The output is canonical, so `serialize(parse(serialize(d)))` is byte-equal
 * to `serialize(d)`.
 */
export function serializeDocument(
  document: Document,
  options: SerializeOptions = {},
): string {
  if (options.validate !== false) {
    assertValidDocument(document);
  }

  const lines: string[] = [documentLine(document)];

  for (const page of [...document.pages].sort(comparePages)) {
    lines.push(pageLine(page));
  }
  for (const element of [...document.elements].sort(compareElements)) {
    lines.push(elementLine(element));
  }

  const unknown = document.unknownRecords ?? [];
  if (unknown.length > 0) {
    lines.push(...unknown.map(unknownLine).sort(compareStrings));
  }

  const text = lines.join("\n");
  return options.trailingNewline === false ? text : `${text}\n`;
}
