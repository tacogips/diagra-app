// Diagram IR: canonical semantic + visual data model.
// See the product design (diagra-cloud repo), section 5.1.
//
// This module is runtime-agnostic: no DOM, no framework imports.

/** Identifier of a {@link Document}. ULIDs in practice; any non-empty string parses. */
export type DocId = string;
/** Identifier of a {@link Page}, unique within a document. */
export type PageId = string;
/** Identifier of an {@link Element}, unique within a document and stable across renames. */
export type ElementId = string;

/**
 * Fractional index key (jittered lexicographic ordering key). Used for
 * z-order on every element and for the time axis of sequence diagrams.
 */
export type FractionalIndex = string;

/**
 * A page kind selects the default tool palette; it never restricts which
 * element types may live on the page.
 */
export const PAGE_KINDS = [
  "freeform",
  "erd",
  "uml",
  "sequence",
  "architecture",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

/**
 * Unknown fields carried through a parse/serialize round trip untouched.
 * Forward compatibility: a newer writer may add fields this build does not
 * model, and reserializing must not drop them.
 */
export type Extensions = Readonly<Record<string, unknown>>;

/** Visual style. All fields optional; unknown fields survive in `extensions`. */
export interface VisualStyle {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly dash?: "solid" | "dashed" | "dotted";
  readonly opacity?: number;
  readonly color?: string;
  readonly fontSize?: number;
  readonly textAlign?: "start" | "middle" | "end";
  readonly extensions?: Extensions;
}

/**
 * Presentation payload of an element. Everything is optional: derived
 * layouts (sequence diagrams) leave coordinates unset, and connectors carry
 * no box geometry at all.
 */
export interface Visual {
  /** Page-space x, in page units. */
  readonly x?: number;
  /** Page-space y, in page units. */
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  /**
   * Clockwise rotation in **degrees**, about the element's own centre.
   *
   * Degrees rather than radians so the 0.01 serialization rounding stays
   * imperceptible (0.01 degrees; 0.01 radians would be a visible 0.57
   * degrees) and so the file stays readable in a diff. Renderers convert.
   */
  readonly rotation?: number;
  readonly style?: VisualStyle;
  readonly extensions?: Extensions;
}

export interface Page {
  readonly id: PageId;
  readonly name: string;
  readonly kind: PageKind;
  readonly extensions?: Extensions;
}

/**
 * An element is one semantic object on a page. `type` selects the registry
 * entry that gives `semantic` its shape; `visual` is presentation only.
 */
export interface Element<S = unknown> {
  readonly id: ElementId;
  readonly page: PageId;
  readonly type: string;
  readonly index: FractionalIndex;
  readonly semantic: S;
  readonly visual: Visual;
  readonly extensions?: Extensions;
}

/**
 * A JSONL record whose `kind` this build does not understand. Kept verbatim
 * so a round trip through an older reader is lossless.
 */
export interface UnknownRecord {
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * A whole diagram document.
 *
 * Note: the design's section 5.1 sketch lists only `pages`, but element
 * records are top-level in the JSONL format (section 6) and carry a `page`
 * back-reference, so the in-memory document owns a flat `elements` list.
 */
export interface Document {
  readonly schemaVersion: number;
  readonly id: DocId;
  readonly title: string;
  readonly pages: readonly Page[];
  readonly elements: readonly Element[];
  /** Records whose `kind` is not document/page/element, preserved verbatim. */
  readonly unknownRecords?: readonly UnknownRecord[];
  readonly extensions?: Extensions;
}

export function isPageKind(value: unknown): value is PageKind {
  return (
    typeof value === "string" &&
    (PAGE_KINDS as readonly string[]).includes(value)
  );
}

/** True for plain JSON objects (not arrays, not null). */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Index a document's elements by page id, preserving input order. */
export function elementsByPage(document: Document): Map<PageId, Element[]> {
  const byPage = new Map<PageId, Element[]>();
  for (const page of document.pages) {
    byPage.set(page.id, []);
  }
  for (const element of document.elements) {
    const bucket = byPage.get(element.page);
    if (bucket) {
      bucket.push(element);
    } else {
      byPage.set(element.page, [element]);
    }
  }
  return byPage;
}
