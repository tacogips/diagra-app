import { expect, test } from "bun:test";
import {
  assertValidDocument,
  type FrameSemantic,
  type UiControlSemantic,
} from "@nodetto/ir";
import { importHtmlLayout, type HtmlLayoutNode } from "./html-layout.ts";
import { Editor } from "./editor.ts";
import { serializeDocument, parseDocument } from "../../io/src/index.ts";
import { exportHtmlBundle } from "./html-bundle.ts";
const box = { x: 24, y: 30, width: 180, height: 44 };
test("measured HTML converts to editable layers with hierarchy, control state and portable assets", () => {
  const document = importHtmlLayout(
    [
      {
        name: "main",
        box: { ...box, width: 600, height: 400 },
        text: "Intro",
        children: [
          {
            name: "h1",
            box,
            text: "Design title",
            style: { fontSize: 32, color: "#123456" },
          },
          {
            name: "img",
            box: { ...box, y: 90 },
            image: { src: "artifacts/logo.png", alt: "Logo" },
          },
          {
            name: "select",
            box: { ...box, y: 150 },
            control: {
              control: "select",
              label: "Plan",
              value: "Pro",
              options: ["Free", "Pro"],
            },
          },
        ],
      },
    ],
    { title: "Imported", width: 1440, height: 1000 },
  );
  assertValidDocument(document);
  expect(parseDocument(serializeDocument(document))).toEqual(document);
  const main = document.elements.find(
    (e) => e.type === "frame" && (e.semantic as FrameSemantic).name === "main",
  );
  expect((main?.semantic as FrameSemantic).memberIds).toHaveLength(4);
  const control = document.elements.find((e) => e.type === "ui.control");
  expect((control?.semantic as UiControlSemantic).value).toBe("Pro");
  const editor = new Editor({ document });
  const text = document.elements.find(
    (e) =>
      e.type === "text.note" &&
      (e.semantic as { text: string }).text === "Design title",
  );
  if (!text) throw new Error("missing editable text");
  editor.apply([
    { type: "updateSemantic", id: text.id, semantic: { text: "Edited title" } },
  ]);
  editor.assets.set("artifacts/logo.png", "data:image/png;base64,iVBORw0KGgo=");
  const bundle = exportHtmlBundle(editor);
  const html = new TextDecoder().decode(
    bundle.files.find((f) => f.path === "imported.html")?.contents,
  );
  expect(html).toContain("Edited title");
  expect(html).toContain("<option selected>Pro</option>");
  expect(html).toContain('src="artifacts/image-1.png"');
});
test("HTML layout import bounds nesting and rejects invalid control data before adoption", () => {
  let node: HtmlLayoutNode = { name: "text", box, text: "deep" };
  for (let i = 0; i < 102; i++) node = { name: "div", box, children: [node] };
  expect(() =>
    importHtmlLayout([node], { title: "Deep", width: 100, height: 100 }),
  ).toThrow("nesting");
  expect(() =>
    importHtmlLayout(
      [{ name: "img", box, image: { src: "../private.png", alt: "Unsafe" } }],
      { title: "Unsafe", width: 100, height: 100 },
    ),
  ).toThrow();
});
