import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createDesignTemplate,
  DESIGN_TEMPLATES,
  Editor,
  exportHtmlBundle,
  encodeHtmlBundleZip,
} from "../../../packages/core/src/index.ts";
import { serializeDocument } from "../../../packages/io/src/index.ts";
import { Resvg } from "@resvg/resvg-js";

const base = join(import.meta.dir, "../../../examples/design");
for (const template of DESIGN_TEMPLATES) {
  let next = 0;
  const document = createDesignTemplate(
    template.id,
    () => `${template.id}-${String(++next).padStart(4, "0")}`,
  );
  const editor = new Editor({ document });
  const directory = join(base, template.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "design.jsonl"), serializeDocument(document));
  const roots = document.elements
    .filter((e) => e.type === "frame")
    .sort((a, b) => (a.visual.x ?? 0) - (b.visual.x ?? 0));
  for (const [index, root] of roots.entries()) {
    const svg = editor.exportArtboardSvg(root.id);
    if (!svg) throw new Error("Empty template artboard");
    writeFileSync(join(directory, `screen-${index + 1}.svg`), svg);
    {
      const png = new Resvg(svg, {
        fitTo: {
          mode: "width",
          value: template.platform === "ios" ? 390 : 960,
        },
        font: {
          loadSystemFonts: !existsSync("/System/Library/Fonts/Helvetica.ttc"),
          fontFiles: ["/System/Library/Fonts/Helvetica.ttc"].filter(existsSync),
          defaultFontFamily: "Helvetica",
        },
      })
        .render()
        .asPng();
      writeFileSync(join(directory, `screen-${index + 1}.png`), png);
      if (index === 0) writeFileSync(join(directory, "preview.png"), png);
    }
  }
  const bundle = exportHtmlBundle(editor);
  for (const file of bundle.files) {
    const target = join(directory, "html", file.path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, file.contents);
  }
  writeFileSync(join(directory, "website.zip"), encodeHtmlBundleZip(bundle));
}
