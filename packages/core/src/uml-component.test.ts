import {
  createSelectionResizeSnapshot,
  resizeSelection,
} from "./selection-resize.ts";
import { describe, expect, test } from "bun:test";
import {
  UmlComponentType as Type,
  UmlComponentRelationship as Relation,
  type UmlPortSemantic,
  getElementTypeDefinition,
  validateDocument,
} from "@nodetto/ir";
import { parseDocument, serializeDocument } from "@nodetto/io";
import { makeEditor } from "./test-helpers.ts";
import {
  connectorDecoration,
  connectorDefaultDash,
  endpointReaderFor,
  resolveConnector,
} from "./shapes/connector.ts";

describe("UML component diagrams", () => {
  function fixture() {
    const editor = makeEditor();
    const a = editor.createElement(Type.Component, {
      visual: { x: 20, y: 30, width: 180, height: 100 },
    });
    const b = editor.createElement(Type.Component, {
      visual: { x: 400, y: 30 },
    });
    return { editor, a, b };
  }
  test("component relations use typed notation and survive canonical JSONL", () => {
    const { editor, a, b } = fixture();
    for (const kind of Object.values(Relation)) {
      const id = editor.connectComponent(a, b, kind) as string;
      const edge = editor.store.get(id)!;
      expect(edge.type).toBe(Type.Relationship);
      expect(connectorDecoration(edge).end).toBe(
        kind === Relation.Dependency
          ? "arrow"
          : kind === Relation.Realization
            ? "triangle"
            : null,
      );
      expect(connectorDefaultDash(edge)).toBe(
        kind === Relation.Connector ? undefined : "6 4",
      );
      expect(
        resolveConnector(
          edge,
          editor.createShapeContext(),
          endpointReaderFor(edge.type),
        ),
      ).not.toBeNull();
    }
    expect(editor.store.get(editor.connectSmart(a, b) as string)?.type).toBe(
      Type.Relationship,
    );
    const document = editor.getSnapshot();
    expect(
      validateDocument(document).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
    const serialized = serializeDocument(document);
    expect(serializeDocument(parseDocument(serialized))).toBe(serialized);
    const svg = editor.exportPageSvg();
    expect(svg).toContain("Component");
    expect(svg).not.toContain("unsupported");
    expect(svg).toContain('stroke-dasharray="6 4"');
  });
  test("ports attach, follow owner move/resize/rotation, and undo atomically", () => {
    const { editor, a } = fixture();
    const port = editor.createUmlPort(a, { x: 200, y: 80 }) as string;
    expect(editor.store.get(port)?.semantic).toMatchObject({
      owner: a,
      side: "right",
      offset: 0.5,
    });
    expect(editor.getBounds(port)).toMatchObject({
      x: 193,
      y: 73,
      width: 14,
      height: 14,
    });
    const before = editor.getSnapshot();
    editor.apply([
      { type: "updateVisual", id: a, visual: { x: 120, width: 280 } },
    ]);
    expect(editor.getBounds(port)).toMatchObject({ x: 393, y: 73 });
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
    editor.redo();
    expect(editor.getBounds(port)).toMatchObject({ x: 393, y: 73 });
    editor.apply([{ type: "updateVisual", id: a, visual: { rotation: 90 } }]);
    expect(editor.getBounds(port)?.x).toBeCloseTo(253);
    expect(editor.getBounds(port)?.y).toBeCloseTo(213);
  });
  test("dragging ports reanchors them and inspector edits retain attachment", () => {
    const { editor, a } = fixture();
    const port = editor.createUmlPort(a, { x: 200, y: 80 }) as string;
    editor.apply([
      { type: "updateVisual", id: port, visual: { x: 58, y: 23 } },
    ]);
    expect(editor.store.get(port)?.semantic).toMatchObject({
      side: "top",
      offset: 0.25,
    });
    editor.apply([
      {
        type: "updateSemantic",
        id: port,
        semantic: {
          ...(editor.store.get(port)?.semantic as UmlPortSemantic),
          side: "bottom",
        },
      },
    ]);
    expect(editor.getBounds(port)).toMatchObject({ x: 58, y: 123 });
  });
  test("duplicate remaps attached ports; owner deletion cascades through relations", () => {
    const { editor, a, b } = fixture();
    const port = editor.createUmlPort(a, { x: 200, y: 80 }) as string;
    const edge = editor.connectComponent(
      port,
      b,
      Relation.Dependency,
    ) as string;
    editor.selection.set([a]);
    const copied = editor
      .duplicateSelection()
      .map((id) => editor.store.get(id)!);
    const ownerCopy = copied.find((item) => item.type === Type.Component)!;
    expect(
      copied.find((item) => item.type === Type.Port)?.semantic,
    ).toMatchObject({ owner: ownerCopy.id });
    editor.selection.set([a]);
    editor.deleteSelection();
    expect(editor.store.get(a)).toBeUndefined();
    expect(editor.store.get(port)).toBeUndefined();
    expect(editor.store.get(edge)).toBeUndefined();
    editor.undo();
    expect(editor.store.get(port)).toBeDefined();
    expect(editor.store.get(edge)).toBeDefined();
  });
  test("moving owner and port together does not double-translate the attachment", () => {
    const { editor, a } = fixture();
    const port = editor.createUmlPort(a, { x: 200, y: 80 }) as string;
    const before = editor.getSnapshot();
    editor.apply([
      { type: "updateVisual", id: a, visual: { x: 120, y: 80 } },
      { type: "updateVisual", id: port, visual: { x: 293, y: 123 } },
    ]);
    expect(editor.getBounds(port)).toMatchObject({ x: 293, y: 123 });
    expect(editor.store.get(port)?.semantic).toMatchObject({
      side: "right",
      offset: 0.5,
    });
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
  });
  test("multi-selection resize changes the owner while keeping port size and offset", () => {
    const { editor, a } = fixture();
    const port = editor.createUmlPort(a, { x: 200, y: 80 }) as string;
    editor.selection.set([a, port]);
    const before = editor.getSnapshot();
    const snapshot = createSelectionResizeSnapshot(editor);
    if (!snapshot) throw new Error("expected resize snapshot");
    expect(
      resizeSelection(editor, snapshot, {
        x: 20,
        y: 30,
        width: 360,
        height: 200,
      }),
    ).toBe(true);
    expect(editor.getBounds(port)).toMatchObject({
      x: 373,
      y: 123,
      width: 14,
      height: 14,
    });
    expect(editor.store.get(port)?.semantic).toMatchObject({ offset: 0.5 });
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
  });
  test("copying or cutting a port alone cannot leave a dangling owner", () => {
    const { editor, a } = fixture();
    const port = editor.createUmlPort(a, { x: 200, y: 80 }) as string;
    editor.selection.set([port]);
    expect(editor.copySelection()).toBe(false);
    expect(editor.cutSelection()).toBe(false);
    expect(editor.store.get(port)).toBeDefined();
    editor.selection.set([a]);
    expect(editor.copySelection()).toBe(true);
    const ids = editor.paste();
    const copies = ids.map((id) => editor.store.get(id)!);
    const owner = copies.find((item) => item.type === Type.Component)!;
    expect(
      copies.find((item) => item.type === Type.Port)?.semantic,
    ).toMatchObject({ owner: owner.id });
  });
  test("invalid endpoints and read-only authoring are refused", () => {
    const { editor, a, b } = fixture();
    const other = editor.createElement("uml.class");
    expect(editor.connectComponent(a, other, Relation.Dependency)).toBeNull();
    expect(editor.connectComponent(a, a, Relation.Dependency)).toBeNull();
    expect(editor.createUmlPort(other, { x: 0, y: 0 })).toBeNull();
    editor.setReadOnly(true);
    expect(editor.connectComponent(a, b, Relation.Dependency)).toBeNull();
    expect(editor.createUmlPort(a, { x: 0, y: 0 })).toBeNull();
  });
  test("validation rejects unknown kinds and out-of-range port offsets", () => {
    expect(
      getElementTypeDefinition(Type.Relationship)?.validateSemantic(
        { from: "a", to: "b", kind: "inherit" },
        "semantic",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      getElementTypeDefinition(Type.Port)?.validateSemantic(
        { name: "p", owner: "a", side: "right", offset: 2 },
        "semantic",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      getElementTypeDefinition(Type.Interface)?.validateSemantic(
        { name: "i", kind: "unknown" },
        "semantic",
      ).length,
    ).toBeGreaterThan(0);
  });
});
