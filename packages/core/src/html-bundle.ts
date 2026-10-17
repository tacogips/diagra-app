import { decodeRasterDataUrl } from "@nodetto/ir";
import type { ElementId, FrameSemantic, ImageSemantic } from "@nodetto/ir";
import type { Editor } from "./editor.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { frameParents } from "./frame-tree.ts";
import { collectInterfaceTree } from "./interface-tree.ts";

export interface HtmlBundleFile {
  readonly path: string;
  readonly contents: Uint8Array;
}
export interface HtmlBundle {
  readonly files: readonly HtmlBundleFile[];
  readonly notes: readonly string[];
}
const encoder = new TextEncoder();
const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );

/** Each artboard becomes a standalone page and stylesheet; raster assets are copied once. */
export function exportHtmlBundle(
  editor: Editor,
  rootIds?: readonly ElementId[],
  resolveAsset?: (source: string) => string,
): HtmlBundle {
  const parents = frameParents(
    editor.store,
    editor.currentPageId,
    editor.createShapeContext(),
  );
  const frames = rootIds
    ? rootIds.map((id) => editor.store.get(id)).filter((e) => e !== undefined)
    : editor.store
        .getPageElements(editor.currentPageId)
        .filter((e) => e.type === "frame" && !parents.has(e.id));
  if (!frames.length) throw new Error("Create an artboard to export HTML.");
  if (frames.some((e) => e.type !== "frame"))
    throw new Error("HTML pages must be frames or artboards.");
  const files: HtmlBundleFile[] = [];
  const notes = new Set<string>();
  const assets = new Map<string, string>();
  const used = new Set<string>();
  const pages: { name: string; title: string }[] = [];
  const addText = (path: string, text: string): void => {
    files.push({ path, contents: encoder.encode(text) });
  };
  for (const frame of frames) {
    const semantic = frame.semantic as FrameSemantic;
    const title = semantic.name || "Page";
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-|-$/g, "") || "page";
    let name = base === "index" ? "page-index" : base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    pages.push({ name, title });
    const code = generateInterfaceCode(editor, frame.id);
    if (!code) throw new Error("Cannot export frame");
    let html = code.html;
    for (const element of collectInterfaceTree(editor, frame.id)?.included ??
      []) {
      if (element.type !== "image.raster") continue;
      const source = (element.semantic as ImageSemantic).src;
      let target = assets.get(source);
      if (!target) {
        const resolved =
          editor.assets.resolve(source) ?? resolveAsset?.(source);
        if (!resolved)
          throw new Error(`Cannot export missing image: ${source}`);
        const decoded = decodeRasterDataUrl(resolved);
        if (!decoded) throw new Error(`Cannot decode image: ${source}`);
        target = `artifacts/image-${assets.size + 1}.${decoded.extension}`;
        assets.set(source, target);
        files.push({ path: target, contents: decoded.bytes });
      }
      html = html.replaceAll(`src="${escapeHtml(source)}"`, `src="${target}"`);
    }
    addText(
      `${name}.html`,
      `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${name}.css"></head><body>\n${html}\n</body></html>\n`,
    );
    addText(
      `${name}.css`,
      `body { margin: 0; }\nbutton, input, textarea, select { font: inherit; }\n${code.linkedCss}\n`,
    );
    for (const note of code.notes) notes.add(note);
  }
  addText(
    "index.html",
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Pages</title><body><nav><ul>${pages.map((p) => `<li><a href="${p.name}.html">${escapeHtml(p.title)}</a></li>`).join("")}</ul></nav></body></html>\n`,
  );
  addText(
    "README.txt",
    `Open index.html to browse the exported pages.\n\n${[...notes].join("\n")}\n`,
  );
  return { files, notes: [...notes] };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Portable ZIP (stored entries), usable by both browser and desktop without a filesystem API. */
export function encodeHtmlBundleZip(bundle: HtmlBundle): Uint8Array {
  if (
    bundle.files.length > 65535 ||
    bundle.files.reduce((sum, file) => sum + file.contents.length, 0) >
      512 * 1024 * 1024
  )
    throw new Error("Website bundle exceeds the ZIP export size limit.");
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of bundle.files) {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(file.path) ||
      file.path.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw new Error("Invalid bundle path");
    const name = encoder.encode(file.path);
    if (name.length > 65535) throw new Error("Bundle filename is too long.");
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    const checksum = crc32(file.contents);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(12, 33, true); // 1980-01-01, deterministic archive.
    view.setUint32(14, checksum, true);
    view.setUint32(18, file.contents.length, true);
    view.setUint32(22, file.contents.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, file.contents.length, true);
    cv.setUint32(24, file.contents.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(header, file.contents);
    central.push(entry);
    offset += header.length + file.contents.length;
  }
  const size = central.reduce((sum, p) => sum + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + end.length);
  let at = 0;
  for (const part of [...parts, ...central, end]) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
