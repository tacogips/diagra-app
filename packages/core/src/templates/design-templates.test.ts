import { expect, test } from "bun:test";
import { assertValidDocument, type FrameSemantic } from "@nodetto/ir";
import { parseDocument, serializeDocument } from "../../../io/src/index.ts";
import { createDesignTemplate, DESIGN_TEMPLATES } from "./design-templates.ts";
import { Editor } from "../editor.ts";
import { exportHtmlBundle } from "../html-bundle.ts";
import { measureTextNote } from "../text-layout.ts";
for (const template of DESIGN_TEMPLATES)
  test(`${template.name}: three editable parent screens each export as one HTML page`, () => {
    let next = 0;
    const document = createDesignTemplate(template.id, () => `test-${++next}`);
    assertValidDocument(document);
    expect(parseDocument(serializeDocument(document))).toEqual(document);
    const editor = new Editor({ document });
    const roots = document.elements
      .filter((e) => e.type === "frame")
      .sort((a, b) => (a.visual.x ?? 0) - (b.visual.x ?? 0));
    expect(roots).toHaveLength(3);
    const owned = new Set<string>();
    for (const root of roots) {
      const semantic = root.semantic as FrameSemantic;
      expect(semantic.platform).toBe(template.platform);
      expect(semantic.memberIds?.length).toBeGreaterThan(15);
      for (const id of semantic.memberIds ?? []) {
        expect(owned.has(id)).toBe(false);
        owned.add(id);
        const box = editor.getBounds(id);
        if (!box) throw new Error("Part has no bounds");
        expect(box.x).toBeGreaterThanOrEqual(root.visual.x ?? 0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(
          (root.visual.x ?? 0) + template.width,
        );
        expect(box.y + box.height).toBeLessThanOrEqual(template.height);
      }
      const one = exportHtmlBundle(editor, [root.id]);
      expect(
        one.files.filter(
          (f) => f.path.endsWith(".html") && f.path !== "index.html",
        ),
      ).toHaveLength(1);
      expect(one.files.filter((f) => f.path.endsWith(".css"))).toHaveLength(1);
      expect(editor.exportArtboardSvg(root.id)).not.toContain("Unsupported");
    }
    const parts = document.elements.filter(
      (e) => e.type !== "frame" && e.type !== "edge.generic",
    );
    expect(parts.every((e) => owned.has(e.id))).toBe(true);
    expect(parts.some((e) => e.type === "text.note")).toBe(true);
    expect(parts.some((e) => e.type === "ui.control")).toBe(true);
    expect(parts.some((e) => e.type === "image.raster")).toBe(false);
    const bundle = exportHtmlBundle(editor);
    expect(bundle.files.filter((f) => f.path.endsWith(".css"))).toHaveLength(3);
    expect(editor.exportArtboardSvg(roots[0]?.id ?? "")).toContain(
      template.platform === "web" ? ">12</text>" : "Today&apos;s priorities",
    );
  });
test("zero-inset text retains measured HTML geometry and remains visible in SVG and HTML", () => {
  const editor = new Editor();
  const root = editor.createElement("frame", {
    semantic: { name: "Page" },
    visual: { width: 300, height: 200 },
  });
  const id = editor.createElement("text.note", {
    semantic: { text: "Small label" },
    visual: {
      x: 10,
      y: 10,
      width: 160,
      height: 16,
      textPadding: 0,
      style: {
        fontSize: 13,
        fill: "rgb(245, 244, 239)",
        color: "rgba(23, 44, 40, 1)",
      },
    },
  });
  const element = editor.store.get(id);
  if (!element) throw new Error("Missing text");
  expect(measureTextNote(element, "auto-height").height).toBeCloseTo(15.6);
  expect(editor.exportArtboardSvg(root)).toContain(">Small label</text>");
  const bundle = exportHtmlBundle(editor, [root]);
  const css = new TextDecoder().decode(
    bundle.files.find((f) => f.path === "page.css")?.contents,
  );
  expect(css).toContain("padding: 0px;");
  expect(css).toContain("rgb(245, 244, 239)");
  expect(() =>
    editor.apply([{ type: "updateVisual", id, visual: { textPadding: -1 } }]),
  ).toThrow();
});
