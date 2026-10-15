export const PDF_PAGE_SIZES = {
  artwork: "Fit artwork",
  a4: "A4",
  letter: "Letter",
} as const;
export type PdfPageSize = keyof typeof PDF_PAGE_SIZES;
export type PdfOrientation = "portrait" | "landscape";
export interface PdfOptions {
  readonly pageSize: PdfPageSize;
  readonly orientation: PdfOrientation;
  readonly marginMm: number;
}

/** CSS pixels become PDF points at 96 dpi; density never changes paper size. */
export function pdfLayout(width: number, height: number, options: PdfOptions) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("PDF artwork must have positive dimensions.");
  if (
    !Number.isFinite(options.marginMm) ||
    options.marginMm < 0 ||
    options.marginMm > 50
  )
    throw new Error("PDF margins must be between 0 and 50 mm.");
  if (options.pageSize === "artwork") {
    const w = width * 0.75;
    const h = height * 0.75;
    if (Math.max(w, h) > 14400)
      throw new Error(
        "Artwork is too large for a PDF page. Choose A4 or Letter.",
      );
    return { pageWidth: w, pageHeight: h, x: 0, y: 0, width: w, height: h };
  }
  const paper = options.pageSize === "a4" ? [595.276, 841.89] : [612, 792];
  const pageWidth = paper[options.orientation === "landscape" ? 1 : 0] ?? 612;
  const pageHeight = paper[options.orientation === "landscape" ? 0 : 1] ?? 792;
  const margin = (options.marginMm * 72) / 25.4;
  const ratio = Math.min(
    (pageWidth - 2 * margin) / width,
    (pageHeight - 2 * margin) / height,
  );
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width * ratio) / 2,
    y: (pageHeight - height * ratio) / 2,
    width: width * ratio,
    height: height * ratio,
  };
}

/** Embed the rendered artwork so every font and paint matches PNG export. */
export async function pngToPdf(
  png: Blob,
  width: number,
  height: number,
  options: PdfOptions,
  signal?: AbortSignal,
): Promise<Blob> {
  const check = () => {
    if (signal?.aborted) throw new Error("PDF export cancelled.");
  };
  check();
  const layout = pdfLayout(width, height, options);
  const { PDFDocument } = await import("pdf-lib");
  check();
  const doc = await PDFDocument.create();
  doc.setCreator("Nodetto");
  const bytes = await png.arrayBuffer();
  check();
  const image = await doc.embedPng(bytes);
  check();
  doc.addPage([layout.pageWidth, layout.pageHeight]).drawImage(image, layout);
  const result = await doc.save();
  check();
  return new Blob([result], { type: "application/pdf" });
}
