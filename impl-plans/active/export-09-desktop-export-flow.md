# export-09-desktop-export-flow

- planId: export-09-desktop-export-flow
- planPath: impl-plans/active/export-09-desktop-export-flow.md
- wave: 3
- dependsOn: export-02-pdf-encoder, export-03-font-resolver,
  export-06-desktop-tauri-backend, export-07-ui-export-menu
- design: `design-docs/specs/export.md` sections 3.2, 3.3 (app PNG, PDF),
  3.5, 4.1-4.3

## Intent and context

Wire the Export menu into the desktop shell (which is also what runs in a
plain browser): open `ExportDialog` for (scope, format), build the SVG with
`exportScopeSvg`, encode (SVG as is, PNG with the existing browser
`rasterizeSvg`, PDF with lazily imported `svgToPdf` plus the desktop font
catalogue or `null` in a browser), then save through the native dialog or
download. Rewire the existing `exportSvg` onto `exportScopeSvg(..., "auto")`
so its bytes do not change. Read `impl-plans/active/export-00-overview.md`
worker rules first, plus the plan-01 progress log note about PDFKit in a
browser bundle.

## Non-goals

- No change to `AssetExportSection.tsx` behavior.
- No new Tauri commands (plan 06 added them).
- No change to the Cmd/Ctrl+Shift+E behavior or the error texts of the
  existing `exportSvg` flow.

## writePaths

- apps/desktop/src/App.tsx
- apps/desktop/src/export/export-flow.ts (new, DOM-light orchestration)
- apps/desktop/src/export/export-flow.test.ts (new)
- apps/desktop/vite.config.ts (only if the PDFKit browser bundle needs it)
- impl-plans/active/export-09-desktop-export-flow.progress.md

sharedPaths: none. (Plan 07 left an `openExport: () => {}` stub in
`App.tsx`; replace it. Re-read `App.tsx` fresh before editing.)

## Pinned API (`export-flow.ts`)

```ts
export interface EncodedExport { readonly bytes: Uint8Array | string; readonly extension: ExportFormat; readonly mime: string; readonly warnings: readonly string[] }
export async function encodeExport(svg: string, format: ExportFormat, scale: number, fonts: () => Promise<FontCatalogue | null>, signal?: AbortSignal): Promise<EncodedExport>;
```

- svg -> `{ bytes: svg, mime: "image/svg+xml" }`, fonts never requested.
- png -> `rasterizeSvg(svg, scale, signal)` (from `@nodetto/ui-solid`'s
  raster module; import the same way `AssetExportSection.tsx` does or via the
  package export if available) -> `new Uint8Array(await blob.arrayBuffer())`,
  mime `image/png`. Fonts never requested (the webview uses installed fonts).
- pdf -> `const { svgToPdf } = await import("@nodetto/core/pdf-export")`;
  catalogue = `await fonts()`; if a catalogue exists and
  `scanFontUsage(svg)` is non-empty -> `resolveExportFonts(svg, catalogue)`;
  string result -> throw `new Error(message)`; no catalogue -> `null` fonts
  (browser, design 3.5). Mime `application/pdf`. Warnings from `svgToPdf`.

## App.tsx changes

- Import `DEFAULT_EXPORT_BACKGROUND`, `exportScopeSvg`, `exportFileName`,
  `svgRasterDimensions` from `@nodetto/core`; delete the local
  `CANVAS_BACKGROUND` constant (its only use is export). Keep
  `EXPORT_EXTENSION`, `exportBaseName`, `downloadText` as needed.
- `exportSvg()`: replace the scope branching with
  `exportScopeSvg(props.editor, "auto", { background: DEFAULT_EXPORT_BACKGROUND })`.
  Keep both existing error messages: decide the artboard wording the same way
  as today (single selected frame) before calling. Everything after (name,
  download vs dialog, error handling) unchanged.
- New state `exportRequest: { scope, format } | null`; `actionContext()`
  `openExport: (scope, format) => setExportRequest({ scope, format })`.
- Render `<ExportDialog>` when `exportRequest()` is set, with
  `contentSize` = `svgRasterDimensions(svg)` of
  `exportScopeSvg(editor, scope, { background: null })` computed at open
  time (null when that returns null), and `onExport(options)`:
  1. Capture `svg = exportScopeSvg(editor, scope, { background:
     options.background })`; null -> throw `Error("Nothing to export.")`.
  2. Abort controller tied to page switch / document replacement, same
     rule as `AssetExportSection.tsx` (subscribe, compare `currentPageId`
     and `store.getMeta()`).
  3. `encodeExport(svg, format, options.scale, fontsProvider, signal)`;
     `fontsProvider` = `props.exportBackend.available ?
     () => createDesktopFontCatalogue() : async () => null`.
  4. Name: `exportFileName(exportBaseName(<doc title or file name, as in
     exportFileName() today>), scope, format, scale)`.
  5. Desktop: `pickExportPath(name, format)`; cancelled -> resolve with
     `[]` without writing (dialog closes); string -> `writeText`; bytes ->
     `writeBytes`. Browser: Blob download with the mime (generalize
     `downloadText` to accept `string | Uint8Array`, or add a sibling helper).
  6. Return warnings.
- Errors propagate to the dialog (it shows them); do not also call
  `setExportError` for dialog exports.

## Vite

Run `bun --cwd=apps/desktop run build`. If it fails because the PDFKit
browser build needs Node globals (for example `Buffer`), add the minimal
`vite.config.ts` change (an `optimizeDeps`/`define` entry or alias to
`pdfkit/js/pdfkit.standalone.js`) and record the reason. Do not add npm
dependencies; if a polyfill package is required, stop and record a blocker
(plan 01 owns dependencies).

## Pitfalls

- PDF code must stay out of the main chunk: only `import()` it. Check the
  Vite build output lists a separate chunk containing pdfkit.
- PNG in the app must keep using `rasterizeSvg` (fonts = editor fonts);
  never import `@resvg/resvg-wasm` in the app.
- Byte identity with the CLI comes from calling `exportScopeSvg` with
  `DEFAULT_EXPORT_BACKGROUND`; never post-process the SVG string.
- Selection scope with a single frame selected exports the artboard
  (design 3.2).

## Tests (`export-flow.test.ts`)

- svg format -> bytes equal the input string, fonts callback not called.
- pdf format with `fonts` returning null -> `%PDF-` bytes, mime `application/pdf`.
- pdf with a fake catalogue that has no faces and an SVG with text ->
  rejects with the "No installed font" message.
- page SVG used by the dialog flow equals the CLI output for the fixture:
  load `apps/cli/test-fixtures/erd-frames.jsonl` with `parseDocumentResult`,
  `new Editor({ document })`, compare
  `exportScopeSvg(editor, "page", { background: DEFAULT_EXPORT_BACKGROUND })`
  with the stdout of `runCli(["export", fixture, "--format", "svg"], io, "test")`
  (import `runCli` from `apps/cli/src/commands.ts` by relative path) ->
  identical strings. This is the app/CLI byte-identity acceptance test.
- `exportScopeSvg(editor, "auto", ...)` for a page with no selection equals
  `editor.exportPageSvg({ background: "#f6f4ee" })` (Export SVG unchanged).
- png path is browser-only (`Image`/canvas); do not unit-test it here.

## Verification

```bash
mkdir -p /tmp/nodetto-export/export-09
bun test apps/desktop > /tmp/nodetto-export/export-09/tests.log 2>&1   # exit 0
bun run typecheck > /tmp/nodetto-export/export-09/typecheck.log 2>&1   # exit 0
bunx biome check apps/desktop/src/App.tsx apps/desktop/src/export > /tmp/nodetto-export/export-09/biome.log 2>&1   # exit 0
bun --cwd=apps/desktop run build > /tmp/nodetto-export/export-09/vite-build.log 2>&1   # exit 0; log shows a separate chunk with pdfkit
```

## Done criteria

- All commands exit 0.
- `grep -n "CANVAS_BACKGROUND" apps/desktop/src/App.tsx` prints nothing.
- `grep -n "openExport: () => {}" apps/desktop/src/App.tsx` prints nothing.
- Progress log records the chunk file name that contains pdfkit.
- Manual check is listed as a verification gap in the progress log if no
  GUI run was possible (PNG/PDF save via the native dialog).
