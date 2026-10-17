import { encodeRasterDataUrl, isRasterAttachmentPath } from "@nodetto/ir";
// `nodetto-cli export`: render one page to SVG, PNG or PDF.
//
// SVG is the core serializer's page export, byte for byte what the app's page
// export produces. PNG rasterizes that SVG with resvg instead of a browser
// canvas, and PDF embeds the PNG with the app's page layout rules.

import { existsSync } from "node:fs";
import {
  Editor,
  exportHtmlBundle,
  encodeHtmlBundleZip,
  PDF_PAGE_SIZES,
  type PdfOptions,
  type PdfOrientation,
  type PdfPageSize,
  pdfLayout,
  RASTER_SCALES,
  rasterDimensions,
  svgRasterDimensions,
} from "@nodetto/core";
import {
  type CommandIo,
  type CommandResult,
  fail,
  loadDocument,
  ok,
  parseArgs,
  selectPage,
  writeOutput,
} from "./commands.ts";
import { helpFor } from "./help.ts";
import { resolveId } from "./ids.ts";

const EXPORT_OPTIONS = new Set([
  "--format",
  "--page",
  "--output",
  "--padding",
  "--background",
  "--scale",
  "--pdf-page",
  "--orientation",
  "--margin",
  "--element",
  "--font-dir",
]);

type ExportFormat = "svg" | "png" | "pdf" | "html";

function isPdfPageSize(value: string): value is PdfPageSize {
  return Object.hasOwn(PDF_PAGE_SIZES, value);
}

function isOrientation(value: string): value is PdfOrientation {
  return value === "portrait" || value === "landscape";
}

function parseNumber(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : Number(value);
}

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
async function rasterize(
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

async function pngToPdf(
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

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function exportCommand(
  io: CommandIo,
  args: readonly string[],
): Promise<CommandResult> {
  const parsed = parseArgs(args, EXPORT_OPTIONS, new Set());
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("export")}`);
  if (parsed.positional.length !== 1)
    return fail(
      `export expects exactly one document path.\n\n${helpFor("export")}`,
    );
  const path = parsed.positional[0] as string;
  const format = parsed.options.get("--format");
  if (
    format !== "svg" &&
    format !== "png" &&
    format !== "pdf" &&
    format !== "html"
  )
    return fail(
      format === undefined
        ? `export requires --format svg, png, pdf or html.\n\n${helpFor("export")}`
        : `Unsupported format "${format}". Choose svg, png, pdf or html.`,
    );
  const exportFormat: ExportFormat = format;
  const outputPath = parsed.options.get("--output");
  if (exportFormat !== "svg" && outputPath === undefined)
    return fail(`${exportFormat.toUpperCase()} export requires --output.`);

  const padding = parseNumber(parsed.options.get("--padding"), 16);
  if (!Number.isFinite(padding) || padding < 0 || padding > 256)
    return fail("--padding must be a number between 0 and 256.");
  const backgroundOption = parsed.options.get("--background");
  const background =
    backgroundOption === "transparent"
      ? null
      : (backgroundOption ?? (exportFormat === "svg" ? null : "#ffffff"));
  if (background !== null && !/^#[0-9a-f]{6}$/i.test(background))
    return fail(
      "--background must be a six-digit hex color (#rrggbb) or transparent.",
    );
  const scaleOption = parsed.options.get("--scale");
  const requestedScale = parseNumber(
    scaleOption,
    exportFormat === "pdf" ? 2 : 1,
  );
  if (!RASTER_SCALES.some((value) => value === requestedScale))
    return fail(`--scale must be one of ${RASTER_SCALES.join(", ")}.`);
  const pageSize = parsed.options.get("--pdf-page") ?? "artwork";
  if (!isPdfPageSize(pageSize))
    return fail("--pdf-page must be artwork, a4 or letter.");
  const orientation = parsed.options.get("--orientation") ?? "portrait";
  if (!isOrientation(orientation))
    return fail("--orientation must be portrait or landscape.");
  const marginMm = parseNumber(parsed.options.get("--margin"), 10);

  const loaded = loadDocument(io, path);
  if (typeof loaded === "string") return fail(loaded);
  const elementQuery = parsed.options.get("--element");
  let pageQuery = parsed.options.get("--page");
  let elementId: string | undefined;
  if (elementQuery !== undefined) {
    const resolved = resolveId(
      elementQuery,
      loaded.document.elements.map((element) => element.id),
    );
    if (!resolved.ok) return fail(resolved.message);
    elementId = resolved.id;
    const owner = loaded.document.elements.find(
      (element) => element.id === resolved.id,
    );
    if (pageQuery === undefined) pageQuery = owner?.page;
  }
  const page = selectPage(
    loaded.document,
    pageQuery,
    loaded.document.pages,
    "The document has no pages.",
    "pages",
  );
  if (typeof page === "string") return fail(page);
  const editor = new Editor({ document: loaded.document });
  editor.setCurrentPage(page.id);
  const resolveAsset = (source: string): string => {
    const cached = editor.assets.resolve(source);
    if (cached) return cached;
    if (!isRasterAttachmentPath(source) || !io.readAttachment)
      throw new Error(`Missing attachment: ${source}`);
    const data = encodeRasterDataUrl(io.readAttachment(path, source));
    editor.assets.set(source, data);
    return data;
  };
  if (exportFormat === "html") {
    try {
      const bundle = exportHtmlBundle(
        editor,
        elementId ? [elementId] : undefined,
        resolveAsset,
      );
      if (!io.writeBytes)
        return fail("This environment cannot write binary files.");
      io.writeBytes(outputPath as string, encodeHtmlBundleZip(bundle));
      return ok(
        "",
        `Wrote ${outputPath} (${bundle.files.length} HTML/CSS and asset files).\n`,
      );
    } catch (error) {
      return fail(`Cannot export HTML: ${describe(error)}`);
    }
  }
  let svg: string | null;
  try {
    if (elementId !== undefined) {
      // A frame exports as its artboard; anything else as a one-element
      // selection. (A page export clipped to a viewport can make resvg panic.)
      const target = editor.store.get(elementId);
      if (target?.type === "frame")
        svg = editor.exportArtboardSvg(elementId, { background, resolveAsset });
      else {
        editor.selection.set([elementId]);
        svg = editor.exportSelectionSvg({ padding, background, resolveAsset });
      }
      if (svg === null)
        return fail(`Element ${elementId} has nothing visible to export.`);
    } else svg = editor.exportPageSvg({ padding, background, resolveAsset });
  } catch (error) {
    return fail(
      `Could not resolve export attachments: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (svg === null)
    return fail(`Page "${page.name}" has no visible content to export.`);

  if (exportFormat === "svg") {
    if (outputPath === undefined) return ok(svg, loaded.warnings);
    const failure = writeOutput(io, outputPath, svg);
    if (failure) return fail(`${loaded.warnings}${failure}`);
    return ok("", `${loaded.warnings}Wrote ${outputPath}.\n`);
  }

  let bytes: Uint8Array;
  let pixels: { readonly width: number; readonly height: number };
  let scale = requestedScale;
  let note = "";
  try {
    const viewport = svgRasterDimensions(svg);
    if (scaleOption === undefined) {
      // Without an explicit --scale, step down until the image fits the limits.
      const fitting = [...RASTER_SCALES]
        .filter((value) => value <= requestedScale)
        .reverse()
        .find((value) => {
          try {
            rasterDimensions(viewport.width, viewport.height, value);
            return true;
          } catch {
            return false;
          }
        });
      if (fitting === undefined)
        throw new Error(
          "The drawing is too large to rasterize even at the smallest scale. Export one frame with --element, or use SVG.",
        );
      if (fitting !== requestedScale) {
        scale = fitting;
        note = `, scaled to ${fitting} to fit the pixel limit`;
      }
    }
    pixels = rasterDimensions(viewport.width, viewport.height, scale);
    const png = await rasterize(svg, scale, parsed.options.get("--font-dir"));
    bytes =
      exportFormat === "png"
        ? png
        : await pngToPdf(png, viewport.width, viewport.height, {
            pageSize,
            orientation,
            marginMm,
          });
  } catch (cause) {
    return fail(`${loaded.warnings}Cannot export: ${describe(cause)}`);
  }
  const target = outputPath as string;
  if (!io.writeBytes)
    return fail("This environment cannot write binary files.");
  try {
    io.writeBytes(target, bytes);
  } catch (cause) {
    return fail(`${loaded.warnings}Cannot write ${target}: ${describe(cause)}`);
  }
  const detail =
    exportFormat === "png"
      ? `${pixels.width}x${pixels.height} px${note}`
      : `${PDF_PAGE_SIZES[pageSize]} page${note}`;
  return ok(
    "",
    `${loaded.warnings}Wrote ${target} (page "${page.name}", ${detail}).\n`,
  );
}
