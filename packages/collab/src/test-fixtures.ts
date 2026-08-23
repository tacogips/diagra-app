// Documents the collab suites share.
//
// Not exported from the package entry point, following
// `packages/core/src/test-helpers.ts`: fixtures are test scaffolding, not API.
// They mirror `packages/io/src/__fixtures__/*.jsonl` in shape (id-carrying
// nested arrays, id-less point lists, scalar arrays, extension bags) without
// pulling `@diagra/io` into this package's dependency set.

import type { Document, Element, Page } from "@diagra/ir";

export const ERD_PAGE: Page = { id: "p1", name: "Domain model", kind: "erd" };

/** Two tables and the relation between them; columns carry ids. */
export function erdDocument(): Document {
  return {
    schemaVersion: 1,
    id: "01JERD00000000000000000000",
    title: "Shop domain",
    pages: [ERD_PAGE],
    elements: [
      {
        id: "t-users",
        page: "p1",
        type: "erd.table",
        index: "a0",
        semantic: {
          tableName: "users",
          columns: [
            { id: "c-id", name: "id", dataType: "uuid", pk: true },
            { id: "c-email", name: "email", dataType: "text", nullable: false },
          ],
        },
        visual: { x: 100, y: 100, width: 280 },
      },
      {
        id: "t-orders",
        page: "p1",
        type: "erd.table",
        index: "a1",
        semantic: {
          tableName: "orders",
          columns: [
            { id: "c-id", name: "id", dataType: "uuid", pk: true },
            {
              id: "c-user-id",
              name: "user_id",
              dataType: "uuid",
              nullable: false,
            },
          ],
        },
        visual: { x: 460, y: 100, width: 280 },
      },
      {
        id: "e-rel-1",
        page: "p1",
        type: "erd.relation",
        index: "a2",
        semantic: {
          from: { table: "t-orders", column: "c-user-id" },
          to: { table: "t-users", column: "c-id" },
          cardinality: "*:1",
          label: "placed by",
        },
        visual: {},
      },
    ],
  };
}

/** UML class: two id-carrying arrays (attributes, methods) on one element. */
export function umlDocument(): Document {
  return {
    schemaVersion: 1,
    id: "01JUML00000000000000000000",
    title: "Domain classes",
    pages: [{ id: "p1", name: "Classes", kind: "uml" }],
    elements: [
      {
        id: "c-order",
        page: "p1",
        type: "uml.class",
        index: "a0",
        semantic: {
          name: "Order",
          stereotype: "entity",
          attributes: [
            { id: "a-id", name: "id", type: "UUID", visibility: "private" },
            { id: "a-total", name: "total", type: "Money" },
          ],
          methods: [{ id: "m-total", name: "recalculate", returnType: "void" }],
        },
        visual: { x: 40, y: 40, width: 220, style: { fill: "#ffffff" } },
      },
      {
        id: "c-customer",
        page: "p1",
        type: "uml.class",
        index: "a1",
        semantic: { name: "Customer", attributes: [], methods: [] },
        visual: { x: 340, y: 40, width: 220 },
      },
      {
        id: "assoc-1",
        page: "p1",
        type: "uml.association",
        index: "a2",
        semantic: { from: "c-order", to: "c-customer", kind: "association" },
        visual: {},
      },
    ],
  };
}

/** Sequence: fractional `order` keys and a participant list. */
export function sequenceDocument(): Document {
  return {
    schemaVersion: 1,
    id: "01JSEQ00000000000000000000",
    title: "Checkout flow",
    pages: [{ id: "p1", name: "Checkout", kind: "sequence" }],
    elements: [
      {
        id: "p-user",
        page: "p1",
        type: "sequence.participant",
        index: "a0",
        semantic: { name: "User", kind: "actor", order: "a0" },
        visual: {},
      },
      {
        id: "p-api",
        page: "p1",
        type: "sequence.participant",
        index: "a1",
        semantic: { name: "API", kind: "participant", order: "a1" },
        visual: {},
      },
      {
        id: "m-checkout",
        page: "p1",
        type: "sequence.message",
        index: "a2",
        semantic: {
          from: "p-user",
          to: "p-api",
          order: "a1",
          label: "POST /checkout",
          kind: "sync",
        },
        visual: {},
      },
    ],
  };
}

/**
 * Freeform: an id-less point list, a scalar array, deep style nesting, an
 * extension bag and an unknown record — everything the mapping has to carry
 * through untouched.
 */
export function freeformDocument(): Document {
  return {
    schemaVersion: 1,
    id: "01JFRE00000000000000000000",
    title: "Whiteboard",
    pages: [
      {
        id: "p1",
        name: "Sketch",
        kind: "freeform",
        extensions: { lock: true },
      },
    ],
    elements: [
      {
        id: "d-stroke",
        page: "p1",
        type: "draw.freehand",
        index: "a0",
        semantic: {
          points: [
            { x: 10, y: 10, pressure: 0.5 },
            { x: 12.35, y: 14.5, pressure: 0.625 },
            { x: 18, y: 22.25 },
          ],
        },
        visual: { style: { stroke: "#111827", strokeWidth: 2 } },
      },
      {
        id: "g-cluster",
        page: "p1",
        type: "group",
        index: "a1",
        semantic: { memberIds: ["n-idea", "s-maybe"] },
        visual: {},
      },
      {
        id: "n-idea",
        page: "p1",
        type: "node.generic",
        index: "a2",
        semantic: { label: "Idea" },
        visual: { x: 40, y: 60, width: 160, height: 48 },
        extensions: { fromFutureBuild: { z: 1 } },
      },
      {
        id: "s-maybe",
        page: "p1",
        type: "shape.geo",
        index: "a3",
        semantic: { geo: "ellipse", label: "maybe" },
        visual: {
          x: 240,
          y: 60,
          width: 140,
          height: 90,
          rotation: 15,
          style: { fill: "#fef3c7", dash: "dashed", opacity: 0.9 },
        },
      },
    ],
    unknownRecords: [
      { kind: "comment", data: { id: "cm-1", body: "looks good" } },
    ],
    extensions: { writtenBy: "test" },
  };
}

/** Every fixture, for suites that assert a property across all of them. */
export function allFixtures(): readonly Document[] {
  return [erdDocument(), umlDocument(), sequenceDocument(), freeformDocument()];
}

/** The element with `id`, or a thrown error naming the document. */
export function elementOf(document: Document, id: string): Element {
  const found = document.elements.find((element) => element.id === id);
  if (!found) {
    throw new Error(`fixture ${document.id} has no element ${id}`);
  }
  return found;
}
