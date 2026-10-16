import { type PdfOptions, pdfLayout } from "@nodetto/core";

export {
  PDF_PAGE_SIZES,
  type PdfOptions,
  type PdfOrientation,
  type PdfPageSize,
  pdfLayout,
} from "@nodetto/core";

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
