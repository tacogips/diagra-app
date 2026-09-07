import { expect, test } from "bun:test";
import { Editor, createDefaultRegistry } from "@diagra/core";
import { componentPreviewSource } from "./component-preview.ts";

test("component preview preserves exported artwork without changing page, selection or history", () => {
  const editor = new Editor({ registry: createDefaultRegistry() });
  const child = editor.createElement("text.note", {
    semantic: { text: '<script>alert("test")</script> & Button' },
    visual: { x: 10, y: 10, width: 180, height: 30 },
  });
  const frame = editor.createElement("frame", {
    semantic: { name: "Button", component: true, memberIds: [child] },
    visual: { x: 0, y: 0, width: 200, height: 60, style: { fill: "#123456" } },
  });
  const page = editor.createPage({ name: "Design" });
  editor.selection.set([]);
  const before = editor.getSnapshot();
  const source = componentPreviewSource(editor, frame);
  expect(source?.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  const svg = decodeURIComponent(source?.split(",")[1] ?? "");
  expect(svg).toBe(editor.exportArtboardSvg(frame) ?? "");
  expect(svg).toContain("#123456");
  expect(svg).not.toContain("<script>");
  expect(editor.currentPageId).toBe(page);
  expect(editor.selection.size).toBe(0);
  expect(editor.getSnapshot()).toEqual(before);
  editor.undo();
  expect(editor.store.getPage(page)).toBeUndefined();
});

test("previews reject missing elements, ordinary frames and component instances", () => {
  const editor = new Editor({ registry: createDefaultRegistry() });
  const frame = editor.createElement("frame", { semantic: { name: "Screen" } });
  expect(componentPreviewSource(editor, "missing")).toBeNull();
  expect(componentPreviewSource(editor, frame)).toBeNull();
  editor.apply([
    {
      type: "updateSemantic",
      id: frame,
      semantic: { name: "Button", component: true },
    },
  ]);
  expect(componentPreviewSource(editor, frame)).not.toBeNull();
  const instance = editor.createComponentInstance(frame, { x: 500, y: 0 });
  expect(instance).not.toBeNull();
  if (instance) expect(componentPreviewSource(editor, instance)).toBeNull();
});

test("preview refresh follows source edits and visibility without including unrelated artwork", () => {
  const editor = new Editor({ registry: createDefaultRegistry() });
  const child = editor.createElement("text.note", {
    semantic: { text: "Before" },
    visual: { x: 10, y: 10, width: 100, height: 30 },
  });
  const frame = editor.createElement("frame", {
    semantic: { name: "Control", component: true, memberIds: [child] },
    visual: { x: 0, y: 0, width: 160, height: 60 },
  });
  const initial = componentPreviewSource(editor, frame);
  editor.createElement("text.note", {
    semantic: { text: "Unrelated" },
    visual: { x: 1000, y: 1000 },
  });
  expect(componentPreviewSource(editor, frame)).toBe(initial);
  editor.apply([
    { type: "updateSemantic", id: child, semantic: { text: "After" } },
  ]);
  const edited = componentPreviewSource(editor, frame);
  expect(edited).not.toBe(initial);
  expect(decodeURIComponent(edited ?? "")).toContain("After");
  editor.apply([{ type: "updateVisual", id: frame, visual: { hidden: true } }]);
  expect(componentPreviewSource(editor, frame)).toBeNull();
  editor.undo();
  expect(componentPreviewSource(editor, frame)).toBe(edited);
});
