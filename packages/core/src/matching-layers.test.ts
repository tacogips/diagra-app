import { expect, test } from "bun:test";
import type { FillGradient } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  bindSelectionColor,
  createColorToken,
  updateColorToken,
} from "./color-tokens.ts";
import { renameSelectedLayers } from "./batch-layer-names.ts";
import { visibleBounds } from "./clipping.ts";
import { matchingLayerIds, selectMatchingLayers } from "./matching-layers.ts";
import { makeEditor, document, erdFixture } from "./test-helpers.ts";

test("stroke paint matches engineering connectors and borders without conflating fill or line geometry", () => {
  const editor = makeEditor({ document: document(erdFixture()) });
  editor.selection.set(["rel"]);
  expect(matchingLayerIds(editor, "stroke")).toEqual([]);
  editor.apply([
    {
      type: "updateVisual",
      id: "rel",
      visual: { style: { stroke: "#ABCDEF", strokeWidth: 2 } },
    },
    {
      type: "updateVisual",
      id: "users",
      visual: { style: { stroke: "#abcdef", strokeWidth: 4 } },
    },
    {
      type: "updateVisual",
      id: "orders",
      visual: { style: { fill: "#abcdef" } },
    },
  ]);
  expect(matchingLayerIds(editor, "stroke")).toEqual(["users", "rel"]);
  const before = editor.getSnapshot();
  expect(selectMatchingLayers(editor, "stroke")).toBe(true);
  const token = createColorToken(editor, "Relationship", "#123456")!;
  expect(bindSelectionColor(editor, "stroke", token)).toBe(true);
  expect(editor.store.get("rel")?.visual.style?.stroke).toBe("#123456");
  expect(editor.store.get("users")?.visual.style?.strokeWidth).toBe(4);
  expect(editor.store.get("rel")?.semantic).toEqual(
    before.elements.find((element) => element.id === "rel")?.semantic,
  );
  editor.undo();
  expect(editor.store.get("rel")?.visual.style?.stroke).toBe("#ABCDEF");
});

test("stroke gradients take precedence over fallback colors and remain separate from fill gradients", () => {
  const { editor, a, b, c } = fixture();
  const gradient: FillGradient = {
    type: "radial",
    centerX: 0.5,
    centerY: 0.5,
    radius: 1,
    stops: [
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#ffffff" },
    ],
  };
  editor.apply([
    {
      type: "updateVisual",
      id: a,
      visual: { style: { stroke: "#000000", strokeGradient: gradient } },
    },
    {
      type: "updateVisual",
      id: b,
      visual: { style: { strokeGradient: gradient } },
    },
    {
      type: "updateVisual",
      id: c,
      visual: { style: { fillGradient: gradient, stroke: "#000000" } },
    },
  ]);
  expect(matchingLayerIds(editor, "stroke")).toEqual([a, b]);
  editor.apply([{ type: "updateVisual", id: b, visual: { locked: true } }]);
  expect(selectMatchingLayers(editor, "stroke")).toBe(false);
});

function fixture() {
  const editor = makeEditor();
  const a = editor.createElement("shape.geo", {
    semantic: { geo: "rect", label: "Button" },
  });
  const b = editor.createElement("shape.geo", {
    semantic: { geo: "ellipse", label: "Other" },
    visual: { layerName: "Button" },
  });
  const c = editor.createElement("text.note", { semantic: { text: "Button" } });
  editor.selection.set([a]);
  return { editor, a, b, c };
}

test("fill matching ignores implicit defaults and compares explicit solids across types", () => {
  const { editor, a, b, c } = fixture();
  expect(matchingLayerIds(editor, "fill")).toEqual([]);
  editor.apply([
    { type: "updateVisual", id: a, visual: { style: { fill: "#ABCDEF" } } },
    {
      type: "updateVisual",
      id: c,
      visual: { style: { fill: "#abcdef", stroke: "#000000" } },
    },
  ]);
  expect(matchingLayerIds(editor, "fill")).toEqual([a, c]);
  expect(matchingLayerIds(editor, "fill")).not.toContain(b);
  const before = editor.getSnapshot();
  expect(selectMatchingLayers(editor, "fill")).toBe(true);
  expect(editor.getSnapshot()).toEqual(before);
});

test("matching linked and literal paints feeds an undoable palette replacement without losing bindings", () => {
  const { editor, a, b, c } = fixture();
  const oldToken = createColorToken(editor, "Old brand", "#123456")!;
  const newToken = createColorToken(editor, "New brand", "#abcdef")!;
  editor.selection.set([a]);
  expect(bindSelectionColor(editor, "fill", oldToken)).toBe(true);
  editor.apply([
    { type: "updateVisual", id: b, visual: { style: { fill: "#123456" } } },
    {
      type: "updateVisual",
      id: c,
      visual: { style: { fill: "#123456" }, locked: true },
    },
  ]);
  const before = editor.getSnapshot();
  expect(selectMatchingLayers(editor, "fill")).toBe(true);
  expect([...editor.selection.ids()]).toEqual([a, b]);
  expect(bindSelectionColor(editor, "fill", newToken)).toBe(true);
  for (const id of [a, b]) {
    expect(editor.store.get(id)?.visual.colorTokens?.fill).toBe(newToken);
    expect(editor.store.get(id)?.visual.style?.fill).toBe("#abcdef");
  }
  expect(editor.store.get(c)?.visual.style?.fill).toBe("#123456");
  const after = editor.getSnapshot();
  expect(parseDocument(serializeDocument(after))).toEqual(after);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.store.get(a)?.visual.colorTokens?.fill).toBe(oldToken);
  expect(editor.store.get(b)?.visual.colorTokens).toBeUndefined();
  editor.redo();
  expect(editor.getSnapshot()).toEqual(after);
  updateColorToken(editor, newToken, "Updated brand", "#654321");
  for (const id of [a, b])
    expect(editor.store.get(id)?.visual.style?.fill).toBe("#654321");
});

test("nonlinear fill matching distinguishes gradient kind, geometry and stop opacity", () => {
  const stops = [
    { offset: 0, color: "#000000" },
    { offset: 1, color: "#ffffff" },
  ];
  const gradients: FillGradient[] = [
    { type: "radial", centerX: 0.5, centerY: 0.5, radius: 0.5, stops },
    { type: "angular", centerX: 0.5, centerY: 0.5, angle: 90, stops },
    {
      type: "diamond",
      centerX: 0.5,
      centerY: 0.5,
      radius: 0.5,
      angle: 90,
      stops,
    },
  ];
  for (const gradient of gradients) {
    const { editor, a, b } = fixture();
    editor.apply(
      [a, b].map((id) => ({
        type: "updateVisual" as const,
        id,
        visual: { style: { fillGradient: gradient } },
      })),
    );
    expect(matchingLayerIds(editor, "fill")).toEqual([a, b]);
    for (const different of [
      { ...gradient, centerX: 0.25 },
      { ...gradient, stops: [{ ...stops[0]!, opacity: 0.5 }, stops[1]!] },
      gradients.find((candidate) => candidate.type !== gradient.type)!,
    ]) {
      editor.apply([
        {
          type: "updateVisual",
          id: b,
          visual: { style: { fillGradient: different } },
        },
      ]);
      expect(matchingLayerIds(editor, "fill")).toEqual([a]);
    }
  }
});

test("gradient fill matching uses geometry and ordered stops, not fallback paint or property order", () => {
  const { editor, a, b, c } = fixture();
  const gradient = {
    type: "linear" as const,
    angle: 90,
    stops: [
      { offset: 0, color: "#ABCDEF" },
      { offset: 1, color: "#000000" },
    ],
  };
  editor.apply([
    {
      type: "updateVisual",
      id: a,
      visual: { style: { fill: "#abcdef", fillGradient: gradient } },
    },
    {
      type: "updateVisual",
      id: b,
      visual: {
        style: {
          fillGradient: {
            stops: gradient.stops.map((stop) => ({
              ...stop,
              color: stop.color.toLowerCase(),
              opacity: 1,
            })),
            angle: 90,
            type: "linear",
          },
        },
      },
    },
    { type: "updateVisual", id: c, visual: { style: { fill: "#abcdef" } } },
  ]);
  expect(matchingLayerIds(editor, "fill")).toEqual([a, b]);
  editor.apply([
    {
      type: "updateVisual",
      id: b,
      visual: { style: { fillGradient: { ...gradient, angle: 45 } } },
    },
  ]);
  expect(matchingLayerIds(editor, "fill")).toEqual([a]);
});

test("type matches the IR type; names match effective labels across types without document edits", () => {
  const { editor, a, b, c } = fixture();
  const before = editor.getSnapshot();
  expect(matchingLayerIds(editor, "type")).toEqual([a, b]);
  expect(matchingLayerIds(editor, "name")).toEqual([a, b, c]);
  expect([...editor.selection.ids()]).toEqual([a]);
  expect(selectMatchingLayers(editor, "name")).toBe(true);
  expect([...editor.selection.ids()]).toEqual([a, b, c]);
  expect(editor.getSnapshot()).toEqual(before);
  expect(selectMatchingLayers(editor, "name")).toBe(false);
  // Selection did not consume history: undo still removes the last created layer.
  editor.undo();
  expect(editor.store.get(c)).toBeUndefined();
});

test("hidden and locked descendants are excluded and restrictions are revalidated", () => {
  const { editor, a, b, c } = fixture();
  const group = editor.createElement("group", {
    semantic: { memberIds: [b, c] },
  });
  expect(matchingLayerIds(editor, "name")).toEqual([a, b, c]);
  for (const visual of [{ locked: true }, { locked: false, hidden: true }]) {
    editor.apply([{ type: "updateVisual", id: group, visual }]);
    expect(matchingLayerIds(editor, "name")).toEqual([a]);
    expect(selectMatchingLayers(editor, "name")).toBe(false);
    editor.selection.set([b]);
    expect(matchingLayerIds(editor, "name")).toEqual([]);
    editor.selection.set([a]);
  }
});

test("selection requires one eligible reference on the current page and skips resources", () => {
  const { editor, a } = fixture();
  const token = editor.createElement("design.token", {
    semantic: { kind: "color", name: "Button", value: "#123456" },
  });
  expect(matchingLayerIds(editor, "name")).not.toContain(token);
  editor.selection.set([token]);
  expect(selectMatchingLayers(editor, "type")).toBe(false);
  editor.selection.set([]);
  expect(matchingLayerIds(editor, "name")).toEqual([]);
  editor.createPage({ name: "Other" });
  editor.selection.set([a]);
  expect(matchingLayerIds(editor, "type")).toEqual([]);
  expect([...editor.selection.ids()]).toEqual([a]);
});

test("name matching is exact and includes off-canvas layers", () => {
  const { editor, a, b, c } = fixture();
  editor.apply([
    { type: "updateVisual", id: b, visual: { layerName: "button" } },
    { type: "updateVisual", id: c, visual: { x: 100000 } },
  ]);
  expect(matchingLayerIds(editor, "name")).toEqual([a, c]);
});

test("nested artboards inherit restrictions but clipping alone does not hide layers from matching", () => {
  const { editor, a, b, c } = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: b,
      visual: { x: 1000, y: 1000, width: 50, height: 50 },
    },
  ]);
  const inner = editor.createElement("frame", {
    semantic: { name: "Phone", clipContent: true, memberIds: [b] },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const outer = editor.createElement("frame", {
    semantic: { name: "Flow", memberIds: [inner] },
    visual: { x: 0, y: 0, width: 400, height: 400 },
  });
  expect(visibleBounds(editor.createShapeContext(), b)).toBeNull();
  expect(matchingLayerIds(editor, "name")).toEqual([a, b, c]);
  editor.apply([{ type: "updateVisual", id: outer, visual: { locked: true } }]);
  expect(matchingLayerIds(editor, "name")).toEqual([a, c]);
  editor.apply([
    {
      type: "updateVisual",
      id: outer,
      visual: { locked: false, hidden: true },
    },
  ]);
  expect(matchingLayerIds(editor, "name")).toEqual([a, c]);
  editor.undo();
  editor.undo();
  expect(matchingLayerIds(editor, "name")).toEqual([a, b, c]);
});

test("mask geometry is never selected as matching artwork or used as a reference", () => {
  const { editor, a, b } = fixture();
  editor.createElement("group", {
    semantic: { memberIds: [a, b], maskId: b },
  });
  expect(editor.createShapeContext().isMaskSource?.(b)).toBe(true);
  expect(matchingLayerIds(editor, "type")).toEqual([a]);
  expect(selectMatchingLayers(editor, "type")).toBe(false);
  editor.selection.set([b]);
  expect(matchingLayerIds(editor, "name")).toEqual([]);
});

test("matching repeated controls feeds one undoable batch rename without changing visible content", () => {
  const { editor, a, b, c } = fixture();
  const before = editor.getSnapshot();
  const svg = editor.exportPageSvg();
  expect(selectMatchingLayers(editor, "name")).toBe(true);
  expect(renameSelectedLayers(editor, { pattern: "Primary / {name}" })).toBe(3);
  for (const id of [a, b, c])
    expect(editor.store.get(id)?.visual.layerName).toBe("Primary / Button");
  expect(editor.exportPageSvg()).toBe(svg);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});
