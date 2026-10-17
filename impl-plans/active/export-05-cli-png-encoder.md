# export-05-cli-png-encoder

- planId: export-05-cli-png-encoder
- planPath: impl-plans/active/export-05-cli-png-encoder.md
- wave: 2
- dependsOn: export-01-contracts
- design: `design-docs/specs/export.md` section 3.3 (PNG, CLI), 3.4 (PNG
  face set), 5 (sidecar)

## Intent and context

The headless PNG encoder for `nodetto-cli export --format png`. It rasterizes
the export SVG with `@resvg/resvg-wasm`, whose `.wasm` is embedded in the
`bun build --compile` sidecar through a file import. The app keeps its
browser rasterizer; this module is CLI-only. Read
`impl-plans/active/export-00-overview.md` worker rules first.

## Non-goals

- No font discovery (plan 04) or resolution (plan 03); the caller passes
  `ResolvedExportFonts | null`.
- No CLI argument handling (plan 08). Do not touch
  `packages/ui-solid/src/raster-export.ts`.

## writePaths

- apps/cli/src/png.ts (new)
- apps/cli/src/png.test.ts (new)
- apps/cli/src/wasm.d.ts (new, only if typecheck needs a `*.wasm` module declaration)
- impl-plans/active/export-05-cli-png-encoder.progress.md

sharedPaths: none.

## Pinned API

```ts
export interface PngExportResult { readonly bytes: Uint8Array; readonly width: number; readonly height: number; readonly warnings: readonly string[] }
export async function svgToPng(svg: string, scale: number, fonts: ResolvedExportFonts | null): Promise<PngExportResult>;
```

## Key points

- WASM: `import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" };`
  then `initWasm(await Bun.file(resvgWasm).arrayBuffer())` exactly once per
  process (module-level promise; a second `initWasm` call throws). This is the
  pattern the spike in plan 01 proved; check its progress log first.
- Size: `pixels = rasterDimensions(...svgRasterDimensions(svg), scale)` from
  `@nodetto/core` (enforces `RASTER_SCALES` and the 8192 / 32 MP limits; let
  its error propagate). Render with `fitTo: { mode: "width", value:
  pixels.width }`. After `render()`, if `image.height !== pixels.height` or
  `image.width !== pixels.width`, throw
  `PNG renderer produced <w>x<h> instead of <W>x<H>.`.
- Background: never pass resvg's `background` option; svg-export already
  painted the background rect (or not, for transparent).
- Fonts: `font: { fontBuffers: fonts.faces.map(f => f.data),
  defaultFontFamily: fonts.genericFamilies.sansSerif, sansSerifFamily,
  serifFamily, monospaceFamily }` with only defined fields; with `fonts`
  null or no faces, pass `fontBuffers: []` (no text expected; plan 08 errors
  earlier when text has no font). `loadSystemFonts` must not be set (not
  supported in WASM).
- Images: before rendering, count `<image` elements whose `href` does not
  start with `data:`; add one warning
  `Skipped <n> image(s) that are not embedded data.` when > 0. Do not fetch.
- Free resvg objects (`resvg.free()`, `image.free()`) in `finally`.
- Return `image.asPng()` as `Uint8Array`.

## Do not

- Do not import `@resvg/resvg-js` or any native addon.
- Do not import from `packages/ui-solid`.
- Do not read files other than the embedded wasm.

## Tests (`apps/cli/src/png.test.ts`)

Parse the PNG in the test only (no new exports, no decoder dependency):
signature `89 50 4E 47 0D 0A 1A 0A`; IHDR width/height as big-endian uint32
at bytes 16 and 20; color type at byte 25 (expect 6, RGBA 8-bit). For the
top-left pixel, concatenate all `IDAT` chunk payloads, `inflateSync` them
(`node:zlib`), and read bytes 1..4 of the result: on the first row the
first pixel equals the raw RGBA for every PNG filter type, because the
left and upper neighbours are zero.

- `exportScopeSvg` of a page with one rect, background `#f6f4ee`, scale 1 ->
  PNG signature, IHDR = `ceil(viewBox w) x ceil(viewBox h)`.
- same page at scale 2 -> IHDR = `ceil(w*2) x ceil(h*2)`; scale 0.5 -> ceil.
- top-left pixel equals `#f6f4ee` opaque; with background `null` -> alpha 0.
- scale 5 -> rejects (unsupported scale message from `rasterDimensions`).
- viewBox 9000 wide at scale 1 -> rejects (8192 limit).
- `<image href="https://example.invalid/x.png">` -> warning, still renders.
- calling `svgToPng` twice in one process -> both succeed (single init).

## Verification

```bash
mkdir -p /tmp/nodetto-export/export-05
bun test apps/cli/src/png.test.ts > /tmp/nodetto-export/export-05/tests.log 2>&1   # exit 0
bun run typecheck > /tmp/nodetto-export/export-05/typecheck.log 2>&1   # exit 0
bunx biome check apps/cli/src/png.ts apps/cli/src/png.test.ts > /tmp/nodetto-export/export-05/biome.log 2>&1   # exit 0
bun build --compile apps/cli/src/png.ts --outfile /tmp/nodetto-export/export-05/png-compile-check > /tmp/nodetto-export/export-05/compile.log 2>&1   # exit 0 (compiles with the embedded wasm)
```

## Done criteria

- All commands exit 0.
- `grep -n "loadSystemFonts\|resvg-js" apps/cli/src/png.ts` prints nothing.
