import { expect, test } from "bun:test";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { pdfLayout, pngToPdf } from "./pdf-export.ts";

const options = {
  pageSize: "artwork",
  orientation: "portrait",
  marginMm: 10,
} as const;
const png = new Blob(
  [
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=",
      "base64",
    ),
  ],
  { type: "image/png" },
);

test("PDF fits artwork at physical CSS size independent of raster density", async () => {
  const blob = await pngToPdf(png, 800, 400, options);
  expect(blob.type).toBe("application/pdf");
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getSize()).toEqual({ width: 600, height: 300 });
  const images = doc
    .getPage(0)
    .node.Resources()
    ?.lookup(PDFName.of("XObject"), PDFDict);
  expect(images?.keys().length).toBe(1);
});

test("paper PDF respects orientation, margins and aspect ratio without cropping", () => {
  for (const pageSize of ["a4", "letter"] as const) {
    const box = pdfLayout(1600, 400, {
      pageSize,
      orientation: "landscape",
      marginMm: 15,
    });
    expect(box.pageWidth).toBeGreaterThan(box.pageHeight);
    expect(box.width / box.height).toBeCloseTo(4);
    expect(box.x).toBeCloseTo((15 * 72) / 25.4);
    expect(box.y).toBeGreaterThan((15 * 72) / 25.4);
    expect(box.x + box.width).toBeLessThan(box.pageWidth);
  }
});

test("invalid PDF geometry and cancelled operations fail without producing a document", async () => {
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => pdfLayout(width, 100, options)).toThrow();
  expect(() => pdfLayout(20000, 100, options)).toThrow("too large");
  expect(() => pdfLayout(100, 100, { ...options, marginMm: 51 })).toThrow(
    "margins",
  );
  const abort = new AbortController();
  abort.abort();
  await expect(pngToPdf(png, 100, 100, options, abort.signal)).rejects.toThrow(
    "cancelled",
  );
});
