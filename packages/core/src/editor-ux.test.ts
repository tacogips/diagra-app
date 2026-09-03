// Editor facade additions for the Wave 1 editor UX: text, style, zoom,
// smart connect.

import { describe, expect, test } from "bun:test";
import { nextZoomStep } from "./camera.ts";
import { document, element, erdFixture, makeEditor } from "./test-helpers.ts";

describe("text fields", () => {
  test("maps types to their editable field and round-trips text", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "geo",
          type: "shape.geo",
          semantic: { geo: "rect", label: "old" },
          visual: { x: 0, y: 0 },
        }),
        element({
          id: "note",
          type: "text.note",
          index: "a2",
          semantic: { text: "hello" },
          visual: { x: 0, y: 0 },
        }),
        ...erdFixture(),
      ]),
    });
    expect(editor.editableField("geo")).toBe("label");
    expect(editor.editableField("note")).toBe("text");
    expect(editor.editableField("users")).toBe("tableName");
    expect(editor.editableField("rel")).toBe("label");
    expect(editor.getText("rel")).toBe("");

    expect(editor.setText("note", "changed")).toBe(true);
    expect(editor.getText("note")).toBe("changed");
    expect(editor.setText("note", "changed")).toBe(false);

    // Optional labels are dropped when emptied, so the file stays clean.
    expect(editor.setText("geo", "")).toBe(true);
    expect(editor.store.get("geo")?.semantic).toEqual({ geo: "rect" });

    // Structured payloads keep everything but the one field.
    editor.setText("users", "accounts");
    expect(editor.store.get("users")?.semantic).toMatchObject({
      tableName: "accounts",
      columns: [{ id: "c1", name: "id", dataType: "uuid", pk: true }],
    });
    editor.undo();
    expect(editor.getText("users")).toBe("users");
  });
});

describe("setSelectionStyle", () => {
  test("merges, clears with null, and drops an empty style", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "a",
          type: "shape.geo",
          semantic: { geo: "rect" },
          visual: { x: 0, y: 0, style: { fill: "#fff" } },
        }),
        element({
          id: "b",
          type: "node.generic",
          index: "a2",
          semantic: { label: "b" },
          visual: { x: 0, y: 0 },
        }),
      ]),
    });
    editor.selection.set(["a", "b"]);
    expect(editor.setSelectionStyle({ stroke: "#000" })).toBe(true);
    expect(editor.store.get("a")?.visual.style).toEqual({
      fill: "#fff",
      stroke: "#000",
    });
    expect(editor.store.get("b")?.visual.style).toEqual({ stroke: "#000" });
    expect(editor.history.undoSize).toBe(1);

    expect(editor.setSelectionStyle({ stroke: null, fill: null })).toBe(true);
    expect(editor.store.get("a")?.visual).toEqual({ x: 0, y: 0 });
    expect(editor.store.get("b")?.visual).toEqual({ x: 0, y: 0 });
    expect(editor.setSelectionStyle({ stroke: null })).toBe(false);
  });
});

describe("zoom", () => {
  test("steps through the fixed table", () => {
    expect(nextZoomStep(1, "in")).toBe(1.25);
    expect(nextZoomStep(1, "out")).toBe(0.75);
    expect(nextZoomStep(0.9, "in")).toBe(1);
    expect(nextZoomStep(8, "in")).toBe(8);
    expect(nextZoomStep(0.1, "out")).toBe(0.1);
  });

  test("zoomToFit centres the page content and caps at 100 %", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "a",
          type: "shape.geo",
          semantic: { geo: "rect" },
          visual: { x: 100, y: 100, width: 200, height: 100 },
        }),
      ]),
    });
    expect(editor.zoomToFit({ width: 1000, height: 800 })).toBe(true);
    const camera = editor.camera.get();
    expect(camera.z).toBe(1);
    // Content centre (200, 150) lands on the viewport centre (500, 400).
    expect(editor.camera.pageToScreen({ x: 200, y: 150 })).toEqual({
      x: 500,
      y: 400,
    });
  });

  test("zoomToFit shrinks large content to the padded viewport", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "a",
          type: "shape.geo",
          semantic: { geo: "rect" },
          visual: { x: 0, y: 0, width: 2000, height: 100 },
        }),
      ]),
    });
    editor.zoomToFit({ width: 1000, height: 800 }, { padding: 50 });
    expect(editor.camera.get().z).toBeCloseTo(0.45);
  });

  test("zoomToSelection may zoom in; empty selection is a no-op", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "a",
          type: "shape.geo",
          semantic: { geo: "rect" },
          visual: { x: 0, y: 0, width: 100, height: 100 },
        }),
      ]),
    });
    expect(editor.zoomToSelection({ width: 1000, height: 1000 })).toBe(false);
    editor.selection.set(["a"]);
    expect(editor.zoomToSelection({ width: 1000, height: 1000 })).toBe(true);
    expect(editor.camera.get().z).toBe(4);
  });
});

describe("connectSmart", () => {
  test("picks the connector type from the endpoints", () => {
    const editor = makeEditor({
      document: document([
        ...erdFixture(),
        element({
          id: "k1",
          type: "uml.class",
          index: "b1",
          semantic: { name: "A", attributes: [], methods: [] },
          visual: { x: 0, y: 300 },
        }),
        element({
          id: "k2",
          type: "uml.class",
          index: "b2",
          semantic: { name: "B", attributes: [], methods: [] },
          visual: { x: 400, y: 300 },
        }),
      ]),
    });
    const relation = editor.connectSmart("users", "orders");
    expect(editor.store.get(relation as string)?.type).toBe("erd.relation");
    const association = editor.connectSmart("k1", "k2");
    expect(editor.store.get(association as string)?.type).toBe(
      "uml.association",
    );
    const edge = editor.connectSmart("users", "k1");
    expect(editor.store.get(edge as string)?.type).toBe("edge.generic");
    expect(editor.connectSmart("k1", "k1")).toBeNull();
  });
});
