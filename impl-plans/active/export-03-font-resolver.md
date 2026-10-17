# export-03-font-resolver

- planId: export-03-font-resolver
- planPath: impl-plans/active/export-03-font-resolver.md
- wave: 2
- dependsOn: export-01-contracts
- design: `design-docs/specs/export.md` section 3.4 (Resolution, PNG/PDF
  face sets, No usable font)

## Intent and context

Given an export SVG and a catalogue of installed fonts, choose
deterministically which font files to load so PNG (CLI) and PDF (app and
CLI) draw text with the fonts that resolve the editor's CSS font stacks. Pure
logic plus `fontkit` coverage checks, no filesystem access: catalogues come
from plan 04 (CLI) and plan 06 (desktop). Read
`impl-plans/active/export-00-overview.md` worker rules first.

## Non-goals

- No directory scanning, no Tauri calls, no PDF or PNG encoding.
- No bundled fonts, no synthetic bold/italic, no variable-font instancing
  (default instance only).

## writePaths

- packages/core/src/export-fonts.ts
- packages/core/src/export-fonts.test.ts
- impl-plans/active/export-03-font-resolver.progress.md

Notes: both source files are new.

artifactRoots: none.

## sharedPaths

- packages/core/src/index.ts

sharedPathNotes: `packages/core/src/index.ts` -> append one
`export { GENERIC_FONT_FAMILIES, resolveExportFonts } from "./export-fonts.ts";`
line in the file's existing style. Re-read the file fresh right before the
edit; plan 01 edited it in wave 1 and no other wave-2 plan touches it.

## Pinned API

```ts
export const GENERIC_FONT_FAMILIES: Readonly<Record<FontCatalogue["platform"], { readonly sansSerif: readonly string[]; readonly serif: readonly string[]; readonly monospace: readonly string[]; readonly fallback: readonly string[] }>>;
export async function resolveExportFonts(
  svg: string,
  catalogue: FontCatalogue,
  options?: { readonly covers?: (data: Uint8Array, face: FontFaceInfo, codePoint: number) => boolean },
): Promise<ResolvedExportFonts | string>; // string = user-facing error
```

`options.covers` is the only test seam (default implementation uses
`fontkit.create(data, face.postscriptName)` and `hasGlyphForCodePoint`).
Cache the parsed fontkit font per face inside one call.

Lazy loading (required): `export-fonts.ts` must not import `fontkit` at the
top level. This module is re-exported from `packages/core/src/index.ts`, so
a top-level import would put fontkit into the app's main bundle and every
CLI start (design 3.1: PDF support is lazy). Load it inside
`resolveExportFonts`, only when a coverage check is actually needed and no
`options.covers` was given: `const fontkit = await import("fontkit");`
(handle a default-export interop if the type declaration requires
`(await import("fontkit")).default ?? ...`; record the chosen form). Type-only
imports (`import type`) are allowed at the top level.

## Algorithm (keep exactly this order)

1. `usage = scanFontUsage(svg)`. No usage (no text) -> return
   `{ faces: [], choices: [], genericFamilies: {}, warnings: [] }` without
   reading any face.
2. For each usage stack, expand each family in order: generic tokens
   `system-ui`, `ui-sans-serif`, `-apple-system`, `BlinkMacSystemFont`,
   `sans-serif` -> `GENERIC_FONT_FAMILIES[platform].sansSerif`; `serif`,
   `ui-serif` -> `.serif`; `ui-monospace`, `monospace` -> `.monospace`;
   other names stay as is. Family matching against `FontFaceInfo.families`
   is case-insensitive and exact otherwise. Remove duplicates keeping the
   first position.
3. Candidates = installed families from step 2, then
   `GENERIC_FONT_FAMILIES[platform].fallback` families that are installed.
4. Pick the first candidate whose best face (step 5) covers every code
   point of the usage; if none covers all, pick the candidate covering the
   most code points (ties -> earlier candidate) and add the warning
   `<n> character(s) in "<stack>" have no glyph in the installed fonts.`.
5. Face inside a family: italic flag match first, then the smallest
   `|weight - target|` where target is 700 for bold and 400 otherwise, then
   the smaller weight, then `source`, then `index` (total order ->
   deterministic).
6. No candidate at all for a stack -> return the string
   `No installed font can render text in "<stack>"; install a font for it.`
7. Read each chosen face once (`catalogue.readFace`), assign keys
   `nodetto-font-0`, `nodetto-font-1`, ... in order of first use (usage order
   from `scanFontUsage`, which is sorted).
8. PNG preload: also add the best regular face of the first installed family
   of each expanded stack (if not already chosen), so resvg's per-glyph
   fallback stays within these faces.
9. `genericFamilies`: the first installed family name of each generic list
   (sansSerif/serif/monospace), omitted when none is installed.

Platform tables (content, keep short and as listed; edit only with a reason
in the progress log):
- macos: sansSerif `SF Pro`, `SF Pro Text`, `System Font`, `Helvetica Neue`,
  `Helvetica`, `Arial`; serif `Times New Roman`, `Times`; monospace
  `SF Mono`, `Menlo`, `Monaco`, `Courier New`; fallback `Hiragino Sans`,
  `Hiragino Kaku Gothic ProN`, `PingFang SC`, `Apple SD Gothic Neo`,
  `Arial Unicode MS`.
- linux: sansSerif `DejaVu Sans`, `Liberation Sans`, `Noto Sans`; serif
  `DejaVu Serif`, `Liberation Serif`, `Noto Serif`; monospace
  `DejaVu Sans Mono`, `Liberation Mono`, `Noto Sans Mono`; fallback
  `Noto Sans CJK JP`, `Noto Sans CJK SC`, `Droid Sans Fallback`.
- windows: sansSerif `Segoe UI`, `Arial`; serif `Times New Roman`;
  monospace `Consolas`, `Courier New`; fallback `Yu Gothic`, `Meiryo`,
  `Microsoft YaHei`, `Malgun Gothic`, `Arial Unicode MS`.

## Pitfalls

- `Inter` must be tried first when installed (it is first in the stack);
  generics only expand where they appear.
- Face reads: never read every catalogue face (catalogues can list
  thousands, some 20+ MB). Read only the step-5 best face of each candidate
  family, in candidate order, and stop at the first face that covers every
  code point. Read a face at most once per call (memoize bytes and the parsed
  font by `source` + `postscriptName`). Faces that were read for coverage
  but not chosen are not returned in `faces` (except the step-8 preload).
- `.ttc` faces share one `source`; `readFace` returns the whole collection,
  and `postscriptName` selects the face (both for fontkit and PDFKit).
- Results must not depend on catalogue order beyond the documented
  tie-breaks: sort candidates' faces with the total order in step 5.

## Tests (`packages/core/src/export-fonts.test.ts`)

Use a synthetic `FontCatalogue` whose `readFace` returns
`new Uint8Array([index])` and counts calls, and a `covers` stub driven by a
table `{ postscriptName -> Set<codePoint> }`.

- no text -> empty result, `readFace` never called.
- primary family covers everything -> `readFace` called exactly once for
  that usage (no reads of later candidates).
- the same face needed by two usages -> read once (call counter).
- stack `Inter, ui-sans-serif, ...` with `Inter` installed -> Inter chosen.
- Inter missing on macos, `Helvetica Neue` installed -> Helvetica Neue.
- Japanese text, primary family lacks the glyphs, `Hiragino Sans` covers ->
  Hiragino Sans chosen, no warning.
- no candidate covers all -> best-coverage choice + "have no glyph" warning.
- bold usage with Regular (400) and Bold (700) faces -> Bold; italic usage
  with no italic face -> nearest-weight upright face.
- empty catalogue with text -> the "No installed font" string.
- shuffled catalogue order -> identical result (deep equal).
- `genericFamilies.monospace` = `Menlo` when only Menlo is installed (macos).
- preload adds the first installed family's regular face once.

## Verification

```bash
mkdir -p /tmp/nodetto-export/export-03
bun test packages/core/src/export-fonts.test.ts > /tmp/nodetto-export/export-03/tests.log 2>&1   # exit 0
bun run typecheck > /tmp/nodetto-export/export-03/typecheck.log 2>&1   # exit 0
bunx biome check packages/core/src/export-fonts.ts packages/core/src/export-fonts.test.ts packages/core/src/index.ts > /tmp/nodetto-export/export-03/biome.log 2>&1   # exit 0
```

## Done criteria

- Commands above exit 0.
- `grep -n "export-fonts" packages/core/src/index.ts` shows one export line.
- No `node:fs` import in `packages/core/src/export-fonts.ts`.
