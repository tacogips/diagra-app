// The canonical IR <-> Y.Doc mapping (product-design.md section 7.1/7.2).
//
// Shape:
//   meta     Y.Map   { schemaVersion, id, title, extensions?, unknownRecords? }
//   pages    Y.Map<PageId, Y.Map{ name, kind, order?, tokenMode?, extensions? }>
//   elements Y.Map<ElementId, Y.Map{ type, page, index, semantic,
//                                    accessibility?, visual, extensions? }>
//
// Nested objects become Y.Map and nested arrays become Y.Array of the same,
// so `columns` / `attributes` merge per item and per field — the granularity
// design 7.1 requires ("A moves the table" and "B renames a column" both
// survive).
//
// This shape is also implemented server-side (`workers/sync/src/ydoc-ir.ts`,
// marked TEMPORARY). Identity between the two is pinned by
// `workers/sync/test/ydoc-parity.test.ts`: a client that wrote a different
// shape would still sync bytes, and would still hand every peer a document
// neither side can read.

import { compareFractional } from "@diagra/core";
import {
  comparePageOrder,
  type Document,
  type Element,
  type ElementId,
  isPlainObject,
  type Page,
  type PageId,
  type UnknownRecord,
  type Visual,
} from "@diagra/ir";
import * as Y from "yjs";

export const META_KEY = "meta";
export const PAGES_KEY = "pages";
export const ELEMENTS_KEY = "elements";

/** Generic deep JSON -> Y conversion. Scalars stay plain. */
export function toY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    array.push(value.map(toY));
    return array;
  }
  if (isPlainObject(value)) {
    const map = new Y.Map<unknown>();
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        map.set(key, toY(entry));
      }
    }
    return map;
  }
  return value;
}

/** Inverse of {@link toY}. */
export function fromY(value: unknown): unknown {
  if (value instanceof Y.Array) {
    return value.toArray().map(fromY);
  }
  if (value instanceof Y.Map) {
    const record: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      record[key] = fromY(entry);
    }
    return record;
  }
  return value;
}

function setOptional(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    map.set(key, toY(value));
  }
}

/**
 * The keys a `pages` entry holds, read off the IR page.
 *
 * This is the one place the page shape is spelled out: {@link pageToY} builds
 * a fresh entry from it and `syncPageToY` (diff.ts) diffs two of them, so a
 * new page field is added here and nowhere else. `extensions` is omitted
 * rather than set to `undefined` so the key is absent, as {@link pageFromY}
 * expects.
 */
export function pageFields(page: Page): Record<string, unknown> {
  return {
    name: page.name,
    kind: page.kind,
    ...(page.tokenMode === undefined ? {} : { tokenMode: page.tokenMode }),
    ...(page.order === undefined ? {} : { order: page.order }),
    ...(page.extensions === undefined ? {} : { extensions: page.extensions }),
  };
}

/** One page as the Y.Map that lives under `pages`. */
export function pageToY(page: Page): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(pageFields(page))) {
    setOptional(map, key, value);
  }
  return map;
}

/** One element as the Y.Map that lives under `elements`. */
export function elementToY(element: Element): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("type", element.type);
  map.set("page", element.page);
  map.set("index", element.index);
  map.set("semantic", toY(element.semantic ?? {}));
  // Keep a stable map so two peers can author the first independent
  // accessibility fields concurrently without replacing one optional key.
  map.set("accessibility", toY(element.accessibility ?? {}));
  // Keep `style` as a stable Y.Map even while empty. Otherwise two peers
  // making the first independent style edits concurrently replace the same
  // optional key and one complete style object wins.
  map.set(
    "visual",
    toY({ ...element.visual, style: element.visual.style ?? {} }),
  );
  setOptional(map, "extensions", element.extensions);
  return map;
}

function unknownRecordsToY(
  records: readonly UnknownRecord[],
): Y.Array<unknown> {
  const array = new Y.Array<unknown>();
  array.push(
    records.map((record) => {
      const map = new Y.Map<unknown>();
      map.set("kind", record.kind);
      map.set("data", toY(record.data));
      return map;
    }),
  );
  return array;
}

/**
 * Replace the whole content of `doc` with `document`, in a single Yjs
 * transaction so peers observe one atomic swap rather than a torn document.
 */
export function applyIrToDoc(
  doc: Y.Doc,
  document: Document,
  origin?: unknown,
): void {
  const meta = doc.getMap<unknown>(META_KEY);
  const pages = doc.getMap<unknown>(PAGES_KEY);
  const elements = doc.getMap<unknown>(ELEMENTS_KEY);

  Y.transact(
    doc,
    () => {
      meta.clear();
      pages.clear();
      elements.clear();

      meta.set("schemaVersion", document.schemaVersion);
      meta.set("id", document.id);
      meta.set("title", document.title);
      setOptional(meta, "extensions", document.extensions);
      if (document.unknownRecords && document.unknownRecords.length > 0) {
        meta.set("unknownRecords", unknownRecordsToY(document.unknownRecords));
      }

      for (const page of document.pages) {
        pages.set(page.id, pageToY(page));
      }
      for (const element of document.elements) {
        elements.set(element.id, elementToY(element));
      }
    },
    origin,
  );
}

/** Seed a fresh Y.Doc from an IR document (design 7.2 `irToYDoc`). */
export function irToYDoc(document: Document): Y.Doc {
  const doc = new Y.Doc();
  applyIrToDoc(doc, document);
  return doc;
}

function readRecord(value: unknown): Record<string, unknown> {
  const plain = fromY(value);
  return isPlainObject(plain) ? plain : {};
}

/**
 * Materialize one page from its `pages` entry.
 *
 * Every field is coerced rather than trusted: the value came off the wire
 * from another client, and an observer that throws would leave the store
 * half-updated with no way back.
 */
export function pageFromY(id: PageId, value: unknown): Page {
  const record = readRecord(value);
  return {
    id,
    name: String(record.name ?? ""),
    kind: record.kind as Page["kind"],
    ...(typeof record.tokenMode === "string"
      ? { tokenMode: record.tokenMode }
      : {}),
    ...(typeof record.order === "string" ? { order: record.order } : {}),
    ...(record.extensions === undefined
      ? {}
      : { extensions: record.extensions as Page["extensions"] }),
  };
}

/** Materialize one element from its `elements` entry. See {@link pageFromY}. */
export function elementFromY(id: ElementId, value: unknown): Element {
  const record = readRecord(value);
  const rawVisual = isPlainObject(record.visual) ? record.visual : {};
  const visual =
    isPlainObject(rawVisual.style) && Object.keys(rawVisual.style).length === 0
      ? (({ style: _style, ...rest }) => rest)(rawVisual)
      : rawVisual;
  return {
    id,
    page: String(record.page ?? ""),
    type: String(record.type ?? ""),
    index: String(record.index ?? ""),
    semantic: record.semantic ?? {},
    ...(isPlainObject(record.accessibility) &&
    Object.keys(record.accessibility).length > 0
      ? { accessibility: record.accessibility }
      : {}),
    visual: visual as Visual,
    ...(record.extensions === undefined
      ? {}
      : { extensions: record.extensions as Element["extensions"] }),
  };
}

/**
 * Project a Y.Doc back to the IR (design 7.2 `ydocToIr`).
 *
 * Y.Map iteration order is unspecified, so pages and elements are sorted by
 * id here: this output feeds `Store.loadDocument`, whose page order decides
 * which page the editor opens.
 */
export function ydocToIr(doc: Y.Doc): Document {
  const meta = doc.getMap<unknown>(META_KEY);
  const pagesMap = doc.getMap<unknown>(PAGES_KEY);
  const elementsMap = doc.getMap<unknown>(ELEMENTS_KEY);

  const pages: Page[] = [];
  for (const [id, value] of pagesMap.entries()) {
    pages.push(pageFromY(id, value));
  }
  pages.sort(comparePageOrder);

  const elements: Element[] = [];
  for (const [id, value] of elementsMap.entries()) {
    elements.push(elementFromY(id, value));
  }
  elements.sort((left, right) => compareFractional(left.id, right.id));

  const rawUnknown = fromY(meta.get("unknownRecords"));
  const unknownRecords = Array.isArray(rawUnknown)
    ? rawUnknown.flatMap((entry): UnknownRecord[] => {
        if (!isPlainObject(entry) || typeof entry.kind !== "string") {
          return [];
        }
        const data = entry.data;
        return [{ kind: entry.kind, data: isPlainObject(data) ? data : {} }];
      })
    : [];

  const extensions = fromY(meta.get("extensions"));

  return {
    schemaVersion: Number(meta.get("schemaVersion") ?? 1),
    id: String(meta.get("id") ?? ""),
    title: String(meta.get("title") ?? ""),
    pages,
    elements,
    ...(unknownRecords.length > 0 ? { unknownRecords } : {}),
    ...(isPlainObject(extensions) ? { extensions } : {}),
  };
}

/** Element count, for callers enforcing the design 8.4 soft cap. */
export function countElements(doc: Y.Doc): number {
  return doc.getMap<unknown>(ELEMENTS_KEY).size;
}
