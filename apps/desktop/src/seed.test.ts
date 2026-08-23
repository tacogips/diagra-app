// What the app must show on launch.
//
// The manual checklist in this package's README opens with "the window shows
// two ERD tables joined by a relation, ...". These assertions are the part of
// that step a test can make: the seeded document is valid IR, every box shape
// has bounds the renderer can position, and every connector resolves to two
// endpoints — an unresolved one silently draws nothing, which is exactly the
// failure a human would have to notice by eye.

import { describe, expect, test } from "bun:test";
import { createDefaultRegistry, Editor } from "@diagra/core";
import {
  getElementTypeDefinition,
  hasErrors,
  validateDocument,
} from "@diagra/ir";
import { seed } from "./seed.ts";

function seededEditor(): Editor {
  const editor = new Editor({ registry: createDefaultRegistry() });
  seed(editor);
  return editor;
}

function isConnector(type: string): boolean {
  return getElementTypeDefinition(type)?.category === "edge";
}

describe("the seeded document", () => {
  test("validates against the IR with no issues at all", () => {
    const issues = validateDocument(seededEditor().getSnapshot());
    expect(hasErrors(issues)).toBe(false);
    expect(issues).toEqual([]);
  });

  test("covers every element type the renderer knows", () => {
    const editor = seededEditor();
    const types = new Set(
      editor.store.listElements().map((element) => element.type),
    );
    expect([...types].sort()).toEqual([
      "edge.generic",
      "erd.relation",
      "erd.table",
      "node.generic",
      "shape.geo",
      "uml.association",
      "uml.class",
    ]);
  });

  test("every element lands on the page the canvas draws", () => {
    const editor = seededEditor();
    expect(editor.store.getPageElements(editor.currentPageId)).toHaveLength(
      editor.store.size,
    );
  });

  test("every box shape has bounds, and no two overlap", () => {
    const editor = seededEditor();
    const context = editor.createShapeContext();
    const boxes = editor.store
      .listElements()
      .filter((element) => !isConnector(element.type))
      .map((element) => {
        const box = editor.getBounds(element.id, context);
        expect(box).not.toBeNull();
        return box as NonNullable<typeof box>;
      });
    expect(boxes.length).toBeGreaterThan(0);

    for (const [i, a] of boxes.entries()) {
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
      for (const b of boxes.slice(i + 1)) {
        const disjoint =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(disjoint).toBe(true);
      }
    }
  });

  test("every connector resolves to both of its endpoints", () => {
    const editor = seededEditor();
    const context = editor.createShapeContext();
    const connectors = editor.store
      .listElements()
      .filter((element) => isConnector(element.type));
    expect(connectors).toHaveLength(3);
    for (const connector of connectors) {
      expect(editor.getBounds(connector.id, context)).not.toBeNull();
    }
  });

  test("is the starting state, not the user's first edit", () => {
    const editor = seededEditor();
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
  });

  test("hit testing picks the seeded shapes by their own geometry", () => {
    const editor = seededEditor();
    const notes = editor.store
      .listElements()
      .find((element) => element.type === "shape.geo");
    if (!notes) {
      throw new Error("expected a seeded geo shape");
    }
    const box = editor.getBounds(notes.id);
    if (!box) {
      throw new Error("expected the geo shape to have bounds");
    }
    expect(
      editor.hitTest({
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      }),
    ).toBe(notes.id);
    expect(editor.hitTest({ x: box.x - 40, y: box.y - 40 })).toBeNull();
  });
});
