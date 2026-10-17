import { existsSync } from "node:fs";
import {
  type PdfOptions,
  pdfLayout,
  rasterDimensions,
  svgRasterDimensions,
} from "@nodetto/core";

/**
 * Fonts for rasterizing. Scanning every system font is slow (tens of seconds
 * on some machines), so a short list of common sans and mono faces is loaded;
 * --font-dir adds more. Only when none of them exists does it fall back to a
 * full system scan.
 */
const FONT_FILES: readonly string[] = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/Menlo.ttc",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
  "C:\\Windows\\Fonts\\consola.ttf",
  "C:\\Windows\\Fonts\\YuGothR.ttc",
];

function fontOptions(fontDir: string | undefined) {
  const files = FONT_FILES.filter((path) => existsSync(path));
  const dirs = fontDir === undefined ? [] : [fontDir];
  if (!files.length && !dirs.length) return { loadSystemFonts: true };
  const family = (prefix: string, fallback: string) =>
    files.some((path) => path.includes(prefix)) ? prefix : fallback;
  const sans = family("Helvetica", family("DejaVuSans", "Arial"));
  return {
    loadSystemFonts: false,
    fontFiles: [...files],
    fontDirs: dirs,
    defaultFontFamily: sans,
    sansSerifFamily: sans,
    monospaceFamily: family("Menlo", family("DejaVuSansMono", "Consolas")),
  };
}

/** Rasterize editor-generated SVG. resvg is loaded lazily: svg export never needs it. */
export async function rasterize(
  svg: string,
  scale: number,
  fontDir: string | undefined,
): Promise<Uint8Array> {
  const viewport = svgRasterDimensions(svg);
  rasterDimensions(viewport.width, viewport.height, scale);
  const { Resvg } = await import("@resvg/resvg-js");
  const rendered = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: fontOptions(fontDir),
  }).render();
  return rendered.asPng();
}

export async function pngToPdf(
  png: Uint8Array,
  width: number,
  height: number,
  options: PdfOptions,
): Promise<Uint8Array> {
  const layout = pdfLayout(width, height, options);
  const { PDFDocument } = await import("pdf-lib");
  const document = await PDFDocument.create();
  document.setCreator("Nodetto");
  const image = await document.embedPng(png);
  document
    .addPage([layout.pageWidth, layout.pageHeight])
    .drawImage(image, layout);
  return document.save();
}
