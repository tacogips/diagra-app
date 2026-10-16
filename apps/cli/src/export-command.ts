// `nodetto-cli export`: render one page to SVG, PNG or PDF.
//
// SVG is the core serializer's page export, byte for byte what the app's page
// export produces. PNG rasterizes that SVG with resvg instead of a browser
// canvas, and PDF embeds the PNG with the app's page layout rules.

import {
  Editor,
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
]);

type ExportFormat = "svg" | "png" | "pdf";

function isPdfPageSize(value: string): value is PdfPageSize {
  return Object.hasOwn(PDF_PAGE_SIZES, value);
}

function isOrientation(value: string): value is PdfOrientation {
  return value === "portrait" || value === "landscape";
}

function parseNumber(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : Number(value);
}

/** Rasterize editor-generated SVG. resvg is loaded lazily: svg export never needs it. */
async function rasterize(svg: string, scale: number): Promise<Uint8Array> {
  const viewport = svgRasterDimensions(svg);
  rasterDimensions(viewport.width, viewport.height, scale);
  const { Resvg } = await import("@resvg/resvg-js");
  const rendered = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { loadSystemFonts: true },
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
  if (format !== "svg" && format !== "png" && format !== "pdf")
    return fail(
      format === undefined
        ? `export requires --format svg, png or pdf.\n\n${helpFor("export")}`
        : `Unsupported format "${format}". Choose svg, png or pdf.`,
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
  const scale = parseNumber(
    parsed.options.get("--scale"),
    exportFormat === "pdf" ? 2 : 1,
  );
  if (!RASTER_SCALES.some((value) => value === scale))
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
  const page = selectPage(
    loaded.document,
    parsed.options.get("--page"),
    loaded.document.pages,
    "The document has no pages.",
    "pages",
  );
  if (typeof page === "string") return fail(page);
  const editor = new Editor({ document: loaded.document });
  editor.setCurrentPage(page.id);
  const svg = editor.exportPageSvg({ padding, background });
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
  try {
    const viewport = svgRasterDimensions(svg);
    pixels = rasterDimensions(viewport.width, viewport.height, scale);
    const png = await rasterize(svg, scale);
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
      ? `${pixels.width}x${pixels.height} px`
      : `${PDF_PAGE_SIZES[pageSize]} page`;
  return ok(
    "",
    `${loaded.warnings}Wrote ${target} (page "${page.name}", ${detail}).\n`,
  );
}
