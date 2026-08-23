// Canonical editor state.
//
// The store owns the document: pages, elements, and the document-level
// metadata that has to survive a save. It is the single source of truth —
// renderers derive from it and never keep a second copy.
//
// Writes go through {@link Store.commit}, which is driven by `commands.ts`;
// nothing outside the command layer should call it, so every mutation is
// validated, undoable, and announced as exactly one {@link StoreDiff}.

import {
  type DocId,
  type Document,
  type Element,
  type ElementId,
  type Extensions,
  type Page,
  type PageId,
  SCHEMA_VERSION,
  type UnknownRecord,
} from "@diagra/ir";
import { compareFractional } from "./fractional.ts";

/** What changed in one commit. Empty arrays mean "nothing of that kind". */
export interface StoreDiff {
  readonly added: readonly ElementId[];
  readonly updated: readonly ElementId[];
  readonly removed: readonly ElementId[];
  /** True when the page list or document metadata was replaced. */
  readonly pagesChanged: boolean;
}

/** Document-level fields that are not pages or elements. */
export interface DocumentMeta {
  readonly schemaVersion: number;
  readonly id: DocId;
  readonly title: string;
  readonly extensions?: Extensions;
  readonly unknownRecords?: readonly UnknownRecord[];
}

/** One commit's worth of element changes, already validated. */
export interface StoreCommit {
  readonly insert?: readonly Element[];
  readonly update?: readonly Element[];
  readonly remove?: readonly ElementId[];
}

export type StoreListener = (diff: StoreDiff) => void;

function comparePageOrder(left: Page, right: Page): number {
  return compareFractional(left.id, right.id);
}

/**
 * Elements sort by fractional index (z-order) and fall back to id so the
 * order is total even if two elements ever share an index.
 */
function compareElementOrder(left: Element, right: Element): number {
  const byIndex = compareFractional(left.index, right.index);
  return byIndex !== 0 ? byIndex : compareFractional(left.id, right.id);
}

function compareSnapshotOrder(left: Element, right: Element): number {
  const byPage = compareFractional(left.page, right.page);
  return byPage !== 0 ? byPage : compareFractional(left.id, right.id);
}

function emptyMeta(id: DocId): DocumentMeta {
  return { schemaVersion: SCHEMA_VERSION, id, title: "Untitled" };
}

export class Store {
  private meta: DocumentMeta;
  private readonly pageMap = new Map<PageId, Page>();
  private readonly elementMap = new Map<ElementId, Element>();
  private readonly listeners = new Set<StoreListener>();

  constructor(document?: Document, fallbackId = "document") {
    this.meta = emptyMeta(fallbackId);
    if (document) {
      this.loadDocument(document);
    }
  }

  getMeta(): DocumentMeta {
    return this.meta;
  }

  get(id: ElementId): Element | undefined {
    return this.elementMap.get(id);
  }

  has(id: ElementId): boolean {
    return this.elementMap.has(id);
  }

  get size(): number {
    return this.elementMap.size;
  }

  getPage(id: PageId): Page | undefined {
    return this.pageMap.get(id);
  }

  /** Pages in document order (insertion order of the loaded document). */
  listPages(): readonly Page[] {
    return [...this.pageMap.values()];
  }

  /** Every element, unordered. Callers that care must sort. */
  listElements(): readonly Element[] {
    return [...this.elementMap.values()];
  }

  /** Elements of one page, bottom to top. */
  getPageElements(pageId: PageId): readonly Element[] {
    const out: Element[] = [];
    for (const element of this.elementMap.values()) {
      if (element.page === pageId) {
        out.push(element);
      }
    }
    return out.sort(compareElementOrder);
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Replace the whole document. Announced as one diff. */
  loadDocument(document: Document): void {
    const removed = [...this.elementMap.keys()];
    this.pageMap.clear();
    this.elementMap.clear();
    this.meta = {
      schemaVersion: document.schemaVersion,
      id: document.id,
      title: document.title,
      extensions: document.extensions,
      unknownRecords: document.unknownRecords,
    };
    for (const page of document.pages) {
      this.pageMap.set(page.id, page);
    }
    for (const element of document.elements) {
      this.elementMap.set(element.id, element);
    }
    this.emit({
      added: [...this.elementMap.keys()],
      updated: [],
      removed,
      pagesChanged: true,
    });
  }

  /**
   * Apply one validated batch of element changes and announce a single diff.
   *
   * @internal Called by the command layer. Bypassing it skips validation,
   * history, and change notification.
   */
  commit(commit: StoreCommit): StoreDiff {
    const added: ElementId[] = [];
    const updated: ElementId[] = [];
    const removed: ElementId[] = [];
    for (const element of commit.insert ?? []) {
      this.elementMap.set(element.id, element);
      added.push(element.id);
    }
    for (const element of commit.update ?? []) {
      this.elementMap.set(element.id, element);
      updated.push(element.id);
    }
    for (const id of commit.remove ?? []) {
      if (this.elementMap.delete(id)) {
        removed.push(id);
      }
    }
    const diff: StoreDiff = { added, updated, removed, pagesChanged: false };
    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      this.emit(diff);
    }
    return diff;
  }

  /**
   * A deterministic document snapshot: pages by id, elements by page then
   * id, unknown records and extension bags passed through untouched. Feeding
   * this to `@diagra/io` twice yields byte-identical JSONL.
   */
  getSnapshot(): Document {
    const pages = [...this.pageMap.values()].sort(comparePageOrder);
    const elements = [...this.elementMap.values()].sort(compareSnapshotOrder);
    const snapshot: Document = {
      schemaVersion: this.meta.schemaVersion,
      id: this.meta.id,
      title: this.meta.title,
      pages,
      elements,
      ...(this.meta.unknownRecords
        ? { unknownRecords: this.meta.unknownRecords }
        : {}),
      ...(this.meta.extensions ? { extensions: this.meta.extensions } : {}),
    };
    return snapshot;
  }

  private emit(diff: StoreDiff): void {
    for (const listener of [...this.listeners]) {
      listener(diff);
    }
  }
}
