# export-08-cli-export-command

- planId: export-08-cli-export-command
- planPath: impl-plans/active/export-08-cli-export-command.md
- wave: 3
- dependsOn: export-02-pdf-encoder, export-03-font-resolver,
  export-04-cli-system-fonts, export-05-cli-png-encoder
- design: `design-docs/specs/export.md` section 5 (and 3.2, 3.4 "No usable font")

## Intent and context

Add `nodetto-cli export <document.jsonl> --format png|svg|pdf [--page <id or
name>] [--output <file>] [--scale <n>] [--background <#rrggbb> |
--transparent]`, wired to `exportScopeSvg` (plan 01), `resolveExportFonts`
(plan 03), `createSystemFontCatalogue` (plan 04), `svgToPng` (plan 05) and
`svgToPdf` (plan 02). Make `runCli` async and add binary atomic writes.
Read `impl-plans/active/export-00-overview.md` worker rules first, and the
progress logs of plans 02-05 for any recorded deviations.

## Non-goals

- No `--check`, `--strict`, selection export or multi-page output.
- Do not change the output of `ddl`, `arrange`, `format`, `validate`.
- Do not edit `apps/cli/scripts/build-sidecar.ts` unless the compiled
  sidecar fails to embed the wasm (then record the reason and the minimal fix).

## writePaths

- apps/cli/src/commands.ts
- apps/cli/src/commands.test.ts
- apps/cli/src/export.ts (new)
- apps/cli/src/export.test.ts (new)
- apps/cli/src/main.ts
- apps/cli/src/write-atomic.ts
- apps/cli/src/write-atomic.test.ts
- apps/cli/test-fixtures/erd-frames.jsonl (new)
- apps/cli/scripts/build-sidecar.ts (only if required, see non-goals)
- impl-plans/active/export-08-cli-export-command.progress.md

sharedPaths: none.

## Contract changes

```ts
// commands.ts
export interface CommandIo { readText(path: string): string; writeText(path: string, text: string): void; writeBytes(path: string, bytes: Uint8Array): void; }
export async function runCli(args: readonly string[], io: CommandIo, version: string, deps?: ExportDeps): Promise<CommandResult>;
// export.ts
export interface ExportDeps { readonly fontCatalogue: () => FontCatalogue; }
export async function exportCommand(io: CommandIo, args: readonly string[], deps: ExportDeps): Promise<CommandResult>;
// write-atomic.ts
export function writeFileAtomic(path: string, data: string | Uint8Array): void;
```

`deps` defaults to `{ fontCatalogue: () => createSystemFontCatalogue() }`
and exists so tests can inject a catalogue. `exportCommand` lives in
`export.ts` to keep `commands.ts` small; it imports `parseArgs`,
`loadDocument`, `selectPage`, `ok`, `fail`, `writeOutput`, `USAGE` and the
exit codes from `commands.ts` (export them from `commands.ts` if they are
module-private today; avoid a circular import by having `commands.ts`
import `exportCommand` lazily inside the `case "export":` branch with
`await import("./export.ts")`).

## Behavior (validation table from design section 5)

- Options: value options `--format --page --output --scale --background`;
  flag `--transparent`. Reuse `parseArgs` (gives `--opt=value`, a following
  `--...` token is a missing value, repeated option is an error).
- Order of checks (each a `fail(...)` exit 2; argument errors append
  `\n\n${USAGE}` like other commands):
  1. parse errors; 2. exactly one positional; 3. `--format` missing or not
  png/svg/pdf -> `Unsupported format "<x>". Choose png, svg or pdf.`;
  4. `--scale` with svg/pdf -> `--scale applies only to --format png.`;
  `--scale` value not a number in `RASTER_SCALES` ->
  `Unsupported scale "<x>". Choose 0.5, 0.75, 1, 1.5, 2, 3 or 4.`;
  5. `--background` with `--transparent` -> `--background and --transparent cannot be combined.`;
  invalid background -> `Background must be a six-digit hex color such as #ffffff.`;
  6. png/pdf without `--output` -> `--format <f> requires --output <file>.`;
  7. load document (`loadDocument`); 8. page: with `--page` use
  `selectPage(document, query)`; without it, use the document's only page,
  else fail with `The document has several pages; choose one with --page:`
  followed by `  <id>\t<name>` lines (do NOT call `selectPage` without a
  query: its no-query branch picks ERD pages, see review finding R3-L1).
  9. `exportScopeSvg(new Editor({ document }), "page", { background, pageId })`
  null -> `Page "<name>" has nothing to export.`
- svg: no `--output` -> stdout = the SVG exactly; with `--output` ->
  `writeText` atomically.
- png/pdf: if `scanFontUsage(svg)` is non-empty, `resolveExportFonts(svg,
  deps.fontCatalogue())`; a string result -> `fail(message)`. Otherwise
  fonts `null`. Then `svgToPng(svg, scale, fonts)` or `svgToPdf(svg,
  fonts)`; encoder errors (size limits, renderer) -> `fail(message)`. Write
  with `io.writeBytes`; write failure -> `Cannot write <path>: <reason>`
  (same as `writeOutput`).
- stderr on success: document warnings, then each encoder/font warning as
  `warning: <text>`, then
  `Wrote PNG (<w>x<h> px) for page "<name>" to <file>.` /
  `Wrote PDF (<w>x<h> pt) for page "<name>" to <file>.` /
  `Wrote SVG (<n> bytes) for page "<name>" to <file>.`. Warnings never change
  the exit code (0).
- `main.ts`: `await runCli(...)`, `writeBytes: writeFileAtomic`; keep the
  existing catch that maps unexpected errors to exit 2.
- `writeFileAtomic`: accept `Uint8Array` (write as is) or string (UTF-8),
  everything else (symlink handling, mode preservation, fsync) unchanged.
- USAGE: add the `export` synopsis lines and a description paragraph in the
  same style as `ddl`/`arrange`.

## Fixture `apps/cli/test-fixtures/erd-frames.jsonl`

One document, one page named `Schema`: a frame containing two `erd.table`
elements (`users`, `orders`) and a logical `erd.relation` between them
(imitate `packages/core/src/arrange.test.ts` which creates
`erd.relation` with `logical: true`), plus one hidden rectangle
(`visual.hidden: true`) with id `hidden-note`. Generate it once with a
throwaway `bun -e` script using `Editor` + `serializeDocument` (do not
commit the script), then check `bun apps/cli/src/main.ts validate
apps/cli/test-fixtures/erd-frames.jsonl` exits 0 and
`bun apps/cli/src/main.ts format apps/cli/test-fixtures/erd-frames.jsonl --check`
exits 0.

## Pitfalls

- All existing `commands.test.ts` tests must `await runCli`; the memory io
  needs `writeBytes` storing `Uint8Array`s.
- stdout is a string: never write PNG/PDF bytes to stdout.
- Byte identity: the CLI must not post-process the SVG (no trailing newline
  changes); the identity test below guards it.
- Do not load fonts for SVG output or for text-free pages.

## Tests

`export.test.ts` (memory io; fake catalogue for font paths, real system
catalogue only in tests marked skip when no fonts are found):
- every validation row above -> exit 2 and the exact message start.
- `--format=svg` (equals form) -> exit 0, stdout is SVG.
- `--output --x` (following option token) -> `--output requires a value.`
- svg stdout for the fixture equals
  `exportScopeSvg(new Editor({ document }), "page", { background: "#f6f4ee", pageId })`
  byte for byte (this is the app/CLI identity check; the app calls the same
  function, see plan 09).
- `--transparent` svg -> no background rect; `--background #FFFFFF` -> `fill="#ffffff"`.
- fixture svg does not contain `hidden-note`.
- `--page Schema` and `--page <id>` -> same output; `--page nope` -> exit 2
  `No page has the id or name "nope".`; two-page document without `--page`
  -> exit 2 listing both pages.
- png `--scale 2 --output out.png` -> `writeBytes` called once with PNG
  signature and IHDR `ceil(w*2) x ceil(h*2)` (w, h from the SVG viewBox).
- pdf `--output out.pdf` -> bytes start with `%PDF-`, MediaBox equals viewBox.
- text with an empty fake catalogue -> exit 2 "No installed font" message,
  no write.
- write failure (io throws) -> exit 2 `Cannot write`.

`write-atomic.test.ts`: binary data round-trips exactly (include a `0x00`
and a `0xff` byte); existing tests unchanged.

`commands.test.ts`: existing tests awaited; `--help` lists `export`.

## Verification

```bash
mkdir -p /tmp/nodetto-export/export-08
bun test apps/cli > /tmp/nodetto-export/export-08/tests.log 2>&1   # exit 0
bun run typecheck > /tmp/nodetto-export/export-08/typecheck.log 2>&1   # exit 0
bunx biome check apps/cli > /tmp/nodetto-export/export-08/biome.log 2>&1   # exit 0
bun apps/cli/src/main.ts export apps/cli/test-fixtures/erd-frames.jsonl --format svg > /tmp/nodetto-export/export-08/erd.svg 2> /tmp/nodetto-export/export-08/svg.stderr.log   # exit 0
bun apps/cli/src/main.ts export apps/cli/test-fixtures/erd-frames.jsonl --format png --scale 2 --output /tmp/nodetto-export/export-08/erd.png > /tmp/nodetto-export/export-08/png.log 2>&1   # exit 0
bun apps/cli/src/main.ts export apps/cli/test-fixtures/erd-frames.jsonl --format pdf --output /tmp/nodetto-export/export-08/erd.pdf > /tmp/nodetto-export/export-08/pdf.log 2>&1   # exit 0
bun apps/cli/src/main.ts export apps/cli/test-fixtures/erd-frames.jsonl --format png > /tmp/nodetto-export/export-08/missing-output.log 2>&1; echo $?   # prints 2
bun run apps/cli/scripts/build-sidecar.ts > /tmp/nodetto-export/export-08/sidecar-build.log 2>&1   # exit 0
```

Then run the built binary (`apps/desktop/src-tauri/binaries/nodetto-cli-$(rustc -vV | sed -n 's/^host: //p')`)
with the same png and pdf commands (outputs under `/tmp/nodetto-export/export-08/sidecar.*`),
and record `head -c 8 ... | xxd` for the PNG and `head -c 5` for the PDF.

## Done criteria

- All commands meet the stated exit codes; sidecar PNG starts with the PNG
  signature, sidecar PDF starts with `%PDF-`.
- `git status --short apps/desktop/src-tauri/binaries` shows nothing tracked
  changed (binaries are build output; do not add them to git).
