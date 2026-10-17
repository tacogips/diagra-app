# Export: PNG, SVG and PDF

Status: design for implementation. Scope: the public `nodetto-app` repository
only (`packages/core`, `packages/ui-solid`, `apps/desktop`, `apps/cli`,
`README.md`). Nothing here adds server code, endpoints or secrets; the web
behavior is the desktop shell running in a plain browser.

Unresolved owner decisions are recorded in
`design-docs/user-qa/export-questions.md`; each has a default that this
design implements.

## 1. Goals

1. Desktop and web editor: an Export menu offering PNG, SVG and PDF for the
   current page and for the current selection. Desktop writes through the
   native save dialog; a plain browser downloads. PNG offers a scale from
   `RASTER_SCALES` and an optional background; PDF is vector with real text.
2. `nodetto-cli export <document.jsonl> --format png|svg|pdf` renders headlessly
   and works in the `bun build --compile` sidecar that is signed and notarized
   for macOS (no native addons; WASM is allowed).
3. One rendering source of truth: every format is derived from the string
   produced by `packages/core/src/svg-export.ts`. No second document renderer
   is introduced. PNG and PDF encoders consume that SVG string only.
4. SVG output is byte-identical between the app and the CLI for the same page
   and the same options.

Non-goals: new SVG features, PDF/PNG determinism at the byte level, multi-page
PDF, selection export from the CLI, a CLI `--check`/`--strict` mode for
export, changes to the existing inspector PNG asset export behavior,
version bumps or release work.

## 2. Baseline (current behavior that is preserved)

- `renderPageSvg`, `renderSelectionSvg`, `renderArtboardSvg` in
  `packages/core/src/svg-export.ts` produce a standalone SVG string; they skip
  `visual.hidden` elements, inherited hidden state (`context.isHidden`) and
  mask sources. They never draw editor chrome: selection handles, guides,
  rulers, comment pins (comments live in document meta, not in page
  elements) and remote cursors are canvas-only. Exports inherit this.
- `Editor.exportPageSvg / exportSelectionSvg / exportArtboardSvg` wrap them
  for the current page and selection.
- `apps/desktop/src/App.tsx` `exportSvg()` ("Export SVG", Cmd/Ctrl+Shift+E):
  a single selected frame exports as an artboard, any other selection as the
  selection, otherwise the page; page/selection use
  `background: CANVAS_BACKGROUND` (`#f6f4ee`) and the default padding 16.
  Desktop writes through `pick_export_path` + `write_document_atomic`
  (text only); the browser downloads.
- `packages/ui-solid/src/raster-export.ts` rasterizes the SVG with the
  browser (`Image` + `<canvas>` + `toBlob`), bounds pixels to 8192 per side
  and 32 MP, and accepts only scales in `RASTER_SCALES = [0.5, 0.75, 1, 1.5,
  2, 3, 4]`; `AssetExportSection` uses it for the inspector Download PNG.
- `apps/cli/src/commands.ts`: synchronous `runCli(args, io, version)`,
  text-only `CommandIo`, exit codes 0/1/2/3, `parseArgs` with `--opt=value`
  support and rejection of a following `--` token as a missing value;
  atomic writes via `apps/cli/src/write-atomic.ts`.

All of the above keeps working. "Export SVG" keeps its id, label, shortcut
and auto-scope behavior; it is re-implemented on the shared scope helper
(section 3.2) so its bytes do not change.

## 3. Architecture and data flow

```text
Document/Editor ──► core export-formats.exportScopeSvg(scope, options)
                         │  (calls renderPageSvg / renderSelectionSvg /
                         │   renderArtboardSvg with canonical options)
                         ▼
                     SVG string ───────────────► .svg (text, as is)
                         │
          ┌──────────────┼───────────────────────────────┐
          ▼              ▼                               ▼
  app PNG: browser   CLI PNG: resvg-wasm          PDF (app + CLI):
  canvas (existing   + fonts from the system      core pdf-export.svgToPdf
  rasterizeSvg)      font catalogue               (PDFKit + svg-to-pdfkit)
                                                  + fonts from the system
                                                  font catalogue
```

### 3.1 Module boundaries

| Module | Location | Runs in | Responsibility |
| --- | --- | --- | --- |
| `export-formats.ts` | `packages/core/src` (re-exported from `index.ts`) | browser, Bun | scope helper, canonical defaults, option validation, `RASTER_SCALES`, `rasterDimensions`, `svgRasterDimensions`, file naming, PDF page-size rule. No third-party imports. |
| `export-fonts.ts` | `packages/core/src` (re-exported) | browser, Bun | font catalogue types, SVG font-usage scan, deterministic face resolution, generic-family tables. No I/O. |
| `pdf-export.ts` | `packages/core/src`, published as subpath `@nodetto/core/pdf-export` (not re-exported from `index.ts`) | browser, Bun | `svgToPdf(svg, fonts)` using PDFKit + svg-to-pdfkit. Loaded lazily by the app so the main bundle does not grow. |
| `raster-export.ts` | `packages/ui-solid/src` | browser | unchanged browser rasterizer; imports `RASTER_SCALES`, `rasterDimensions`, `svgRasterDimensions` from core and re-exports them so existing imports keep compiling. |
| `ExportDialog.tsx` | `packages/ui-solid/src` | browser | options dialog for one (scope, format): background, scale (PNG only). DOM only; no file I/O. |
| `shortcuts.ts`, `Toolbar.tsx` | `packages/ui-solid/src` | browser | six new actions and Export menu entries. |
| export flow | `apps/desktop/src/App.tsx`, `apps/desktop/src/file/backend.ts`, `apps/desktop/src/export/*` | webview / browser | build SVG, encode, save dialog or download; desktop font catalogue client. |
| Tauri commands | `apps/desktop/src-tauri/src/fs.rs`, new `fonts.rs` | Rust | binary atomic write for exports; system font face listing and font file reads. |
| `export` command | `apps/cli/src/export.ts`, `apps/cli/src/png.ts`, `apps/cli/src/system-fonts.ts` | Bun / sidecar | argument handling, resvg-wasm PNG encoder, filesystem font catalogue. |

### 3.2 Scope helper and canonical options (single source for app and CLI)

`exportScopeSvg(editor, scope, options)` in `export-formats.ts`:

- `scope: "page"` → `renderPageSvg(store, registry, editor.currentPageId,
  { padding: DEFAULT_EXPORT_PADDING, background })`.
- `scope: "selection"` → if the selection is exactly one `frame`,
  `renderArtboardSvg(store, registry, id, { background })` (exact artboard
  envelope, no title, as today); otherwise `renderSelectionSvg(..., {
  padding: DEFAULT_EXPORT_PADDING, background })`.
- `scope: "auto"` (used only by the existing "Export SVG" action) →
  `selection` when the selection is non-empty, else `page`; the artboard
  case keeps today's transparent background (no `background` passed).
- Returns `null` when nothing is drawable; callers report it.

Constants: `DEFAULT_EXPORT_PADDING = 16` (equals svg-export's default),
`DEFAULT_EXPORT_BACKGROUND = "#f6f4ee"` (moved from `CANVAS_BACKGROUND` in
`App.tsx`, which now imports it). `background` is either a `#rrggbb` string
validated and lower-cased by `parseExportBackground`, or `null`
(transparent). Normalizing in one function used by both the dialog and the
CLI keeps the bytes equal for `#F6F4EE` and `#f6f4ee`.

Signature: `exportScopeSvg(editor, scope, { background, pageId? })`;
`pageId` defaults to `editor.currentPageId` and is only meaningful for the
`page` scope. The CLI builds `new Editor({ document })` and calls
`exportScopeSvg(editor, "page", { background, pageId })`. The app calls it
on the live editor without `pageId`. Byte identity therefore depends only on the
document state and the background value, which both sides resolve with the
same function and the same default.

Background is always painted by svg-export's own background `rect` (never by
a rasterizer option), so PNG and PDF inherit it from the SVG.

### 3.3 Format encoders

**SVG.** The scope helper's string, written as UTF-8 unchanged.

**PNG (app).** Existing `rasterizeSvg(svg, scale, signal)` via the webview.
Fonts are the webview's own resolution of the same `font-family` stacks the
canvas uses, so they match the editor by construction. Output dimensions are
`rasterDimensions(viewBoxWidth, viewBoxHeight, scale)` =
`ceil(w * scale) x ceil(h * scale)`, with the existing 8192 px / 32 MP limits.

**PNG (CLI).** `@resvg/resvg-wasm`. The `.wasm` binary is imported with
`with { type: "file" }` so `bun build --compile` embeds it, then passed to
`initWasm` once per process. Render with `fitTo: { mode: "width", value:
pixels.width }` where `pixels = rasterDimensions(...)`; the encoder asserts
the rendered height equals `pixels.height` and fails with exit 2 otherwise.
Fonts: `font.fontBuffers` = the faces chosen in section 3.4,
`loadSystemFonts` is not used (WASM cannot read the filesystem), and
`sansSerifFamily` / `monospaceFamily` are set to the resolved generic
families. `<image>` elements: `data:` URIs render; any other `href` is not
fetched and produces a warning.

**PDF (app and CLI).** `svgToPdf(svg, fonts)` in `pdf-export.ts`:

- One page. MediaBox = `[0 0 W H]` where `W`, `H` are the SVG viewBox width
  and height; one canvas unit = one PDF point (svg-to-pdfkit `assumePt:
  true`). `--scale` does not apply. A side larger than 14400 pt is rejected
  (`MAX_PDF_PAGE_POINTS`), matching the PDF reader limit.
- Vector paths, gradients, clip paths, masks and markers are converted by
  svg-to-pdfkit. Text is emitted as PDF text with embedded, subset TrueType
  or OpenType faces (PDFKit + fontkit); it is never rasterized.
- SVG features svg-to-pdfkit cannot express (`filter` shadows and blurs,
  `mix-blend-mode`, `isolation`) are drawn without the effect and reported
  once per feature as a warning. The export still succeeds.
- `<image>`: PNG and JPEG `data:` URIs are embedded; other sources are
  skipped with a warning.
- PDFKit is constructed with `font: null` so it never loads the standard
  AFM font files from disk (required inside the compiled sidecar).
- Returns `{ bytes: Uint8Array, warnings: readonly string[] }`.
- Font selection is not done by svg-to-pdfkit's default callback; a
  `fontCallback` maps each `font-family` stack plus bold/italic to the face
  chosen in section 3.4, registered with `doc.registerFont`.

### 3.4 Fonts

The editor's text uses CSS font stacks resolved by the OS (the app stylesheet
uses `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
"Segoe UI", sans-serif`; svg-export writes `Inter, ui-sans-serif, system-ui,
sans-serif` on the root plus any per-element `fontFamily` and the
`ui-monospace, SFMono-Regular, Menlo, monospace` code stack). Nodetto bundles
no fonts. Exports therefore load the installed fonts that resolve those same
stacks:

- **Catalogue.** A list of `FontFaceInfo { source, index, families[],
  weight, italic }` (families: typographic family name ID 16, else family
  name ID 1, English entries first).
  - CLI (`apps/cli/src/system-fonts.ts`): scans the platform font
    directories (macOS `/System/Library/Fonts`, `/System/Library/Fonts/Supplemental`,
    `/Library/Fonts`, `~/Library/Fonts`; Linux `/usr/share/fonts`,
    `/usr/local/share/fonts`, `~/.local/share/fonts`, `~/.fonts`; Windows
    `%WINDIR%\Fonts`, `%LOCALAPPDATA%\Microsoft\Windows\Fonts`) for
    `.ttf/.otf/.ttc/.otc` files, depth-limited, symlink loops ignored. It reads
    only the sfnt table directory and the `name`, `OS/2` and `head` tables
    with positioned reads; full file bytes are read only for chosen faces.
    Unreadable or malformed files are skipped silently.
  - Desktop (`apps/desktop/src-tauri/src/fonts.rs`): `list_font_faces`
    returns the same shape from the Rust `fontdb` crate's system database;
    `read_font_file(source)` returns raw bytes (Tauri raw IPC response) and
    only for a `source` present in the listed catalogue.
  - Plain browser: no catalogue (section 3.5).
- **Usage scan** (`export-fonts.ts`): walks the SVG produced by svg-export
  (a tokenizer for that serializer's output only, like
  `svgRasterDimensions`; not a general SVG parser) and returns, per effective
  `font-family` stack and bold/italic combination, the set of code points of
  the text drawn with it (inheritance from ancestor elements applied).
- **Resolution** (`resolveExportFonts(usage, catalogue, platform)`),
  deterministic for a given catalogue:
  1. Expand generic names in the stack (`system-ui`, `ui-sans-serif`,
     `-apple-system`, `BlinkMacSystemFont`, `sans-serif`, `ui-monospace`,
     `monospace`, `serif`) to an ordered per-platform family list held in
     `export-fonts.ts` (for example macOS sans: `SF Pro`, `System Font`,
     `Helvetica Neue`, `Helvetica`; macOS mono: `SF Mono`, `Menlo`).
  2. Candidates = the installed families in stack order, then the platform
     CJK/Unicode fallback list (for example `Hiragino Sans`,
     `Hiragino Kaku Gothic ProN`, `Noto Sans CJK JP`, `Yu Gothic`,
     `Microsoft YaHei`, `Arial Unicode MS`).
  3. Choose the first candidate family whose face covers every code point
     used with that stack (cmap check via fontkit); if none covers all,
     the candidate covering the most, and warn with the count of missing
     characters.
  4. Within the family pick the face nearest to the requested weight
     (400 or 700) and italic flag; no synthetic bold or italic.
  Variable fonts are embedded at their default instance.
- **PNG (CLI)** loads every chosen face plus the first installed face of each
  expanded stack, so resvg's own per-glyph fallback stays within that set.
- **PDF** registers exactly the chosen faces (subset by PDFKit).
- **No usable font.** When the SVG contains text and the catalogue yields no
  face for a stack, the CLI fails with exit 2 (`No installed font can render
  text in "<stack>"; install a font for it.`) rather than writing a file with
  missing text. The desktop app shows the same message as an export error.

### 3.5 Plain browser (web) behavior

- SVG: download of the scope helper's string.
- PNG: browser rasterizer, same as desktop; download.
- PDF: there is no access to installed font files, so `svgToPdf` receives
  no catalogue and uses PDFKit's built-in standard fonts (Helvetica family
  for sans stacks, Courier for monospace stacks). Text stays text. Characters
  outside the standard fonts' WinAnsi encoding cannot be drawn; the dialog
  shows a warning with the count of such characters and suggests the
  desktop app or `nodetto-cli` (default chosen; see user QA Q1).

## 4. User interface

### 4.1 Export menu and actions

The Toolbar "Export" menu lists, in this order:

1. Export SVG (existing action `exportSvg`, Cmd/Ctrl+Shift+E, unchanged).
2. Page as PNG..., Page as SVG..., Page as PDF... (`exportPagePng`,
   `exportPageSvg`, `exportPagePdf`; enabled when the page has elements).
3. Selection as PNG..., Selection as SVG..., Selection as PDF...
   (`exportSelectionPng`, `exportSelectionSvg`, `exportSelectionPdf`;
   enabled when the selection is non-empty).

All seven are viewer actions (allowed in read-only documents). The new ones
have no shortcuts. `ActionContext` gains `openExport(scope, format)`; the
existing `exportSvg` callback stays.

### 4.2 Export dialog

`ExportDialog` opens for one (scope, format) and offers:

- Background: "Canvas color" (default, `DEFAULT_EXPORT_BACKGROUND`),
  "Transparent", or "Custom" with a `#rrggbb` input validated by
  `parseExportBackground`.
- Scale (PNG only): a select over `RASTER_SCALES`, default 1, with the
  resulting pixel size shown and the 8192 px / 32 MP limit enforced before
  export via `rasterDimensions`.
- Export / Cancel. While exporting, the button is disabled; the dialog shows
  warnings (PDF) or the error message and stays open on error.

The SVG snapshot is captured when Export is pressed; a page switch or
document replacement during encoding aborts the export (same rule as
`AssetExportSection`).

### 4.3 Saving

- File name: `<document base>.<ext>` for the page,
  `<document base>-selection.<ext>` for the selection; PNG adds `@<scale>x`
  before `.png` when scale is not 1. Base name from the existing
  `exportBaseName`.
- Desktop: `pick_export_path(name, ext)` (already extension-generic), then
  `writeText` for SVG and a new `ExportBackend.writeBytes(path, bytes)` for
  PNG/PDF. `writeBytes` invokes a new Tauri command `write_export_atomic`
  with the bytes as a raw IPC body and the path in a request header; Rust
  rejects any extension other than `svg`, `png` or `pdf` and writes through
  the existing `write_atomic` generalized to `&[u8]`.
- Browser: `Blob` download with MIME `image/svg+xml`, `image/png` or
  `application/pdf`.

The inspector PNG asset export (`AssetExportSection`) is unchanged apart
from importing the moved helpers.

## 5. CLI: `nodetto-cli export`

```text
nodetto-cli export <document.jsonl> --format png|svg|pdf
                  [--page <page id or name>] [--output <file>]
                  [--scale <n>] [--background <#rrggbb> | --transparent]
```

Validation (all failures exit 2 with a one-line diagnostic on stderr, plus
the usage text for argument errors, matching existing commands):

| Input | Rule |
| --- | --- |
| positional | exactly one document path |
| `--format` | required; `png`, `svg` or `pdf` |
| `--page` | id or unique name via the existing `selectPage` lookup; without it the document must have exactly one page, otherwise the error lists page ids and names |
| `--output` | required for `png` and `pdf`; optional for `svg` (stdout when absent) |
| `--scale` | `png` only; must parse to a value in `RASTER_SCALES`; default 1 |
| `--background` | `#rrggbb` via `parseExportBackground`; default `DEFAULT_EXPORT_BACKGROUND` |
| `--transparent` | flag; conflicts with `--background` |
| value options | `--opt=value` accepted; a following `--...` token is a missing value; repeated option is an error (existing `parseArgs`) |
| empty page | `exportScopeSvg` returned null → `Page "<name>" has nothing to export.` |
| size limits | PNG `rasterDimensions` limits and PDF 14400 pt limit |
| fonts | section 3.4 "No usable font" |

Behavior:

- `runCli` becomes `async` (resvg `initWasm` and PDFKit streaming are
  asynchronous); `main.ts` awaits it. Existing commands keep their output.
- `CommandIo` gains `writeBytes(path, bytes)`; `writeFileAtomic` accepts
  `string | Uint8Array`. `CommandResult.stdout` stays a string (only SVG goes
  to stdout).
- Success writes `Wrote <format> (<w>x<h> px | <w>x<h> pt | <bytes> bytes)
  for page "<name>" to <file>.` on stderr; document warnings and encoder
  warnings precede it on stderr. Warnings do not change the exit code.
- Fonts are loaded only for PNG and PDF, and only when the SVG contains text.

Sidecar: `apps/cli/scripts/build-sidecar.ts` keeps `bun build --compile
--minify`; the resvg `.wasm` is embedded through the file import. No native
addon is added, so the existing code-signing and notarization flow is
unaffected.

## 6. Dependencies

| Package | Where | License | Why |
| --- | --- | --- | --- |
| `@resvg/resvg-wasm` (exact pin) | `apps/cli` | MPL-2.0 | Headless SVG to PNG with the same SVG model as browsers; WASM so the compiled, signed sidecar needs no native addon. Not loaded by the app (the webview rasterizes). |
| `pdfkit` (exact pin) | `packages/core` | MIT | PDF writer with TrueType/OpenType embedding and subsetting (via its dependency `fontkit`, MIT); runs in Bun and has a browser build. |
| `svg-to-pdfkit` (exact pin) | `packages/core` | MIT | Converts SVG to PDFKit vector drawing commands with its own XML parser, so it runs in Bun without a DOM shim. Last published 2022; see risks and user QA Q2. |
| `fontdb` (Rust crate) | `apps/desktop/src-tauri` | MIT | Lists installed font faces with family/weight/style for the desktop font catalogue. |

Rejected: `@resvg/resvg-js` (native addon), jsPDF + svg2pdf.js (needs a DOM;
the CLI would need a DOM shim), a hand-written PDF backend (a second renderer).

## 7. Validation and test plan

Unit tests (Bun):

- `packages/core`: `exportScopeSvg` scopes (page, selection, single-frame
  artboard, auto) and null on empty; hidden layer and hidden-ancestor
  exclusion; background normalization and transparent; `rasterDimensions`
  and `svgRasterDimensions` (moved tests); PDF page-size rule and limit;
  font usage scan (inheritance, bold/italic, escaped text); resolution order,
  generic expansion, coverage fallback and missing-glyph warning against a
  synthetic catalogue; `svgToPdf` output starts with `%PDF-`, MediaBox equals
  the viewBox, embeds a font (`/FontFile2` or `/FontFile3`) and contains the
  text through ToUnicode when a test font is available (skipped with a
  reported reason when the host has no installed font), warns on filters.
- `packages/ui-solid`: action enablement for the six new actions (page vs
  selection, viewer mode), Export menu entries, `rasterDimensions` re-export,
  existing raster tests unchanged.
- `apps/cli`: every row of the validation table; `--opt=value`; SVG stdout;
  PNG signature and IHDR width/height = `ceil(viewBox * scale)` for scales
  1 and 2; PNG background pixel equals the background color and is
  transparent with `--transparent`; PDF header and MediaBox; atomic write
  through the seam; SVG byte identity with `exportScopeSvg(new Editor(...),
  "page", ...)`, which is the function the app calls; sfnt name-table reader
  on synthetic table bytes.
- Rust: `write_export_atomic` extension check and binary round trip;
  `read_font_file` rejects paths not in the catalogue.

Fixture: `apps/cli/test-fixtures/erd-frames.jsonl`, an ERD page with
`erd.table` elements and logical `erd.relation` connectors inside frames,
plus one hidden layer.

Verification commands:

```bash
bun test packages/core packages/ui-solid apps/cli
bun run typecheck
mise run verify
bun run apps/cli/scripts/build-sidecar.ts
apps/desktop/src-tauri/binaries/nodetto-cli-<triple> export \
  apps/cli/test-fixtures/erd-frames.jsonl --format png --scale 2 --output /tmp/erd.png
apps/desktop/src-tauri/binaries/nodetto-cli-<triple> export \
  apps/cli/test-fixtures/erd-frames.jsonl --format pdf --output /tmp/erd.pdf
```

The sidecar check confirms the PNG signature and size and the PDF header and
MediaBox of the two files.

## 8. Rollout constraints

- Implementation order: (1) a spike that proves PDFKit + svg-to-pdfkit and
  resvg-wasm load in Vite, in `bun test` and inside the compiled sidecar with
  `font: null` and an embedded `.wasm`; the design is revisited only if the
  spike fails. (2) core modules. (3) CLI. (4) desktop/Tauri and UI.
  (5) README.
- README: document the Export menu and `nodetto-cli export` (app and CLI
  sections), and correct the font sentence: SVG still references installed
  fonts without embedding them; PDF embeds subsets of installed fonts; PNG
  uses installed fonts.
- No version bump, tag, release or Homebrew cask change.
