# export-02-pdf-encoder

- planId: export-02-pdf-encoder
- planPath: impl-plans/active/export-02-pdf-encoder.md
- wave: 2
- dependsOn: export-01-contracts
- design: `design-docs/specs/export.md` sections 3.3 (PDF), 3.4 (PDF
  registration), 3.5 (browser PDF), 6

## Intent and context

Implement `svgToPdf`, the one PDF encoder that the app (desktop and browser)
and the CLI share. It converts the SVG string from `exportScopeSvg` into a
one-page vector PDF with real, embedded text. It is a lazily loaded subpath
module so the app's main bundle does not grow. Read
`impl-plans/active/export-00-overview.md` worker rules first.

## Non-goals

- No font discovery or font resolution: callers pass `ResolvedExportFonts`
  (plan 03) or `null`.
- No changes to `svg-export.ts`, no re-export from `packages/core/src/index.ts`
  (the module must stay out of the main entry).
- No byte-level determinism requirement, no multi-page output.

## writePaths

- packages/core/src/pdf-export.ts
- packages/core/src/pdf-export.test.ts
- impl-plans/active/export-02-pdf-encoder.progress.md

Notes: both source files are new.

artifactRoots: none (no installs, no builds).

sharedPaths: none.

## Pinned API

```ts
export interface PdfExportResult { readonly bytes: Uint8Array; readonly warnings: readonly string[] }
export async function svgToPdf(svg: string, fonts: ResolvedExportFonts | null): Promise<PdfExportResult>;
```

Import types from `@nodetto/core` (`ResolvedExportFonts`, `normalizeFontStack`,
`isBoldWeight`, `pdfPageSize`, `scanFontUsage`) via relative `./*.ts` paths
as the rest of `packages/core/src` does (for example
`packages/core/src/svg-export.ts` imports `./geometry.ts`).

## Behavior and key points

1. Page size: `pdfPageSize(svg)` (throws above 14400 pt; let it propagate).
   `new PDFDocument({ size: [width, height], margin: 0, font: null,
   autoFirstPage: true, info: { Producer: "nodetto", Creator: "nodetto" } })`.
   `font: null` is mandatory: the default would read Helvetica AFM files
   from disk, which fails inside the compiled sidecar.
2. Draw with `SVGtoPDF(doc, preparedSvg, 0, 0, { assumePt: true, width,
   height, preserveAspectRatio: "xMinYMin meet", fontCallback,
   imageCallback, warningCallback })`. The viewBox may have a non-zero
   origin; svg-to-pdfkit maps viewBox to the given width/height, so do not
   translate manually. Verify in a test that a shape at the viewBox origin
   lands at the page's top-left.
3. Prepared SVG: svg-to-pdfkit only treats `font-weight="bold"` as bold, but
   svg-export writes `font-weight="700"`. Before conversion, rewrite every
   `font-weight="<n>"` attribute where `isBoldWeight` is true to
   `font-weight="bold"` (regex over attributes of this serializer's output
   only). This rewrite is for PDF input only; never change the SVG export.
4. Fonts (`fonts !== null`): register every `ResolvedFace` once with
   `doc.registerFont(face.key, face.data, face.info.postscriptName)` (the
   third argument selects a face inside a `.ttc`/`.otc`). `fontCallback(family,
   bold, italic)` normalizes `family` with `normalizeFontStack` and returns
   the `faceKey` of the matching `FontChoice` (match stack + bold + italic;
   if no exact bold/italic match, the same stack with bold=false/italic=false;
   then the first choice). Never return a family name that was not
   registered (PDFKit would try to read it from disk).
5. Fonts `null` (plain browser, design 3.5): `fontCallback` returns
   `"Courier"` (or `"Courier-Bold"`, etc.) when the normalized stack's last
   generic is `monospace`, otherwise `"Helvetica"`/`"Helvetica-Bold"`/
   `"Helvetica-Oblique"`/`"Helvetica-BoldOblique"`. Count code points from
   `scanFontUsage(svg)` outside WinAnsi (code points > 0xFF, excluding the
   WinAnsi extras in 0x80-0x9F mapping such as the euro sign; a simple `> 0xFF`
   rule is acceptable) and add one warning:
   `<n> character(s) need installed fonts and were not drawn in this PDF. Use the desktop app or nodetto-cli for full text.`
   The export must not throw for such text; if PDFKit throws on unencodable
   characters, replace those characters with `?` in the prepared SVG text
   (only in the `fonts === null` path) and keep the warning.
6. Images: `imageCallback(href)` returns the href for `data:image/png` and
   `data:image/jpeg`/`jpg` URIs; for anything else return `null`/empty and
   add `Skipped <n> image(s) that are not embedded PNG or JPEG data.` once.
7. Unsupported features: if the SVG contains `filter=`, `mix-blend-mode`
   or `isolation:`, add one warning per feature, for example
   `PDF export drops layer effects (shadows, blurs).`,
   `PDF export drops blend modes.`. Also forward svg-to-pdfkit
   `warningCallback` messages, de-duplicated. Keep warnings in a stable order.
8. Byte collection: collect `data` chunks into a single `Uint8Array`, resolve
   on `end`, reject on `error`. Call `doc.end()` exactly once.
9. Use only APIs that exist in both the PDFKit browser and node builds (no
   `doc.pipe(fs...)`, no file paths).
10. Combine warnings from `fonts.warnings` (pass them through first).

## Do not

- Do not rasterize text or embed a bitmap of the page.
- Do not register system fonts by path.
- Do not add this module to `packages/core/src/index.ts`.

## Tests (`packages/core/src/pdf-export.test.ts`)

Use a font file only when available: look for the first existing file among
`/System/Library/Fonts/Supplemental/Arial.ttf`,
`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`,
`C:\\Windows\\Fonts\\arial.ttf`; build a `ResolvedExportFonts` by hand from
it. When none exists, mark those tests `test.skipIf(...)` and log the reason.

- two-rect SVG, fonts `null`, no text -> bytes start with `%PDF-`; contains
  `/MediaBox [0 0 W H]` matching the viewBox width/height (allow PDFKit's
  number formatting; parse the numbers).
- SVG from `exportScopeSvg` of a page with an `erd.table` (bold 700 header)
  and the test font -> contains `/FontFile2` (or `/FontFile3`), contains
  `/ToUnicode`, contains no `/Subtype /Image`; the fontCallback was asked
  for bold at least once (spy) -> proves the 700 -> bold rewrite.
- same SVG with fonts `null` -> PDF produced, contains `/Helvetica`.
- Japanese text with fonts `null` -> PDF produced, one "need installed fonts"
  warning with the right count.
- SVG with a shadow effect -> warning about layer effects.
- 14401-unit-wide SVG -> rejects with the 14400 points message.
- `<image href="https://...">` -> skipped-image warning.

## Verification

```bash
mkdir -p /tmp/nodetto-export/export-02
bun test packages/core/src/pdf-export.test.ts > /tmp/nodetto-export/export-02/tests.log 2>&1   # exit 0; skips (if any) logged with reason
bun run typecheck > /tmp/nodetto-export/export-02/typecheck.log 2>&1   # exit 0
bunx biome check packages/core/src/pdf-export.ts packages/core/src/pdf-export.test.ts > /tmp/nodetto-export/export-02/biome.log 2>&1   # exit 0
```

## Done criteria

- All three commands exit 0.
- `grep -n "pdf-export" packages/core/src/index.ts` prints nothing.
- `grep -n "font: null" packages/core/src/pdf-export.ts` prints a match.
- Progress log lists which font file the tests used or why they skipped.
