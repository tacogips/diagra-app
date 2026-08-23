// Deterministic fixtures for the core test suites.
//
// Nothing here is exported from the package entry point: ids and jitter are
// the two sources of nondeterminism in the core, so every test injects a
// counter and a seeded generator instead of stubbing globals.

import type { Document, Element, Page, Visual } from "@diagra/ir";
import { Editor, type EditorOptions } from "./editor.ts";
import type { IdSource } from "./ids.ts";

export const TEST_PAGE: Page = {
  id: "page-1",
  name: "Page 1",
  kind: "freeform",
};

/** Ids of the form `el-1`, `el-2`, ... so assertions can name them. */
export function counterIds(prefix = "el"): IdSource {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${next}`;
  };
}

/** mulberry32: small, fast, and identical across runs for a given seed. */
export function seededRng(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ElementInput {
  readonly id: string;
  readonly type: string;
  readonly semantic: unknown;
  readonly index?: string;
  readonly page?: string;
  readonly visual?: Visual;
}

export function element(input: ElementInput): Element {
  return {
    id: input.id,
    page: input.page ?? TEST_PAGE.id,
    type: input.type,
    index: input.index ?? "a1",
    semantic: input.semantic,
    visual: input.visual ?? {},
  };
}

export function document(
  elements: readonly Element[] = [],
  pages: readonly Page[] = [TEST_PAGE],
): Document {
  return {
    schemaVersion: 1,
    id: "doc-1",
    title: "Test",
    pages,
    elements,
  };
}

export function makeEditor(options: EditorOptions = {}): Editor {
  return new Editor({
    document: options.document ?? document(),
    idSource: options.idSource ?? counterIds(),
    rng: options.rng ?? seededRng(7),
    ...options,
  });
}

/** A table, a second table, and the relation between them. */
export function erdFixture(): readonly Element[] {
  return [
    element({
      id: "users",
      type: "erd.table",
      index: "a1",
      semantic: {
        tableName: "users",
        columns: [{ id: "c1", name: "id", dataType: "uuid", pk: true }],
      },
      visual: { x: 0, y: 0 },
    }),
    element({
      id: "orders",
      type: "erd.table",
      index: "a2",
      semantic: {
        tableName: "orders",
        columns: [{ id: "c2", name: "id", dataType: "uuid", pk: true }],
      },
      visual: { x: 400, y: 0 },
    }),
    element({
      id: "rel",
      type: "erd.relation",
      index: "a3",
      semantic: {
        from: { table: "users", column: "c1" },
        to: { table: "orders", column: "c2" },
        cardinality: "1:*",
      },
    }),
  ];
}
