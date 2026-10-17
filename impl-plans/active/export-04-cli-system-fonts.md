# export-04-cli-system-fonts

- planId: export-04-cli-system-fonts
- planPath: impl-plans/active/export-04-cli-system-fonts.md
- wave: 2
- dependsOn: export-01-contracts
- design: `design-docs/specs/export.md` section 3.4 (Catalogue, CLI)

## Intent and context

The CLI (Bun and the compiled sidecar) needs a `FontCatalogue` of installed
fonts without native addons. Scan the platform font directories and read only
the sfnt table directory plus the `name`, `OS/2` and `head` tables with
positioned reads, so scanning hundreds of system fonts stays fast. Full
bytes are read only by `readFace` for chosen faces. Read
`impl-plans/active/export-00-overview.md` worker rules first.

## Non-goals

- No font resolution (plan 03), no rendering (plans 02, 05), no CLI command
  wiring (plan 08).
- No WOFF/WOFF2/dfont/Type1 support; no fontconfig.
- No caching across processes.

## writePaths

- apps/cli/src/system-fonts.ts (new)
- apps/cli/src/system-fonts.test.ts (new)
- impl-plans/active/export-04-cli-system-fonts.progress.md

sharedPaths: none.

## Pinned API

```ts
export function fontDirectories(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>, home: string): readonly string[];
export function readSfntFaces(path: string): readonly FontFaceInfo[]; // [] for unreadable/malformed
export function createSystemFontCatalogue(options?: { readonly directories?: readonly string[]; readonly platform?: NodeJS.Platform }): FontCatalogue;
```

`FontCatalogue` and `FontFaceInfo` come from `@nodetto/core` (plan 01).

## Key points

- Directories (design 3.4): darwin `/System/Library/Fonts`,
  `/System/Library/Fonts/Supplemental`, `/Library/Fonts`,
  `<home>/Library/Fonts`; linux `/usr/share/fonts`, `/usr/local/share/fonts`,
  `<home>/.local/share/fonts`, `<home>/.fonts`; win32 `%WINDIR%\Fonts`
  (default `C:\Windows\Fonts`), `%LOCALAPPDATA%\Microsoft\Windows\Fonts`.
  `catalogue.platform` maps darwin->macos, win32->windows, else linux.
- Walk: recursive up to depth 4, skip unreadable directories silently,
  follow symlinked files but track visited real directory paths to avoid
  loops, extensions `.ttf .otf .ttc .otc` case-insensitive, sort entries by
  name for deterministic `faces` order.
- Read with `openSync` + `readSync(fd, buffer, 0, length, position)`; close
  in `finally`. Never `readFileSync` during scanning.
- sfnt parsing (big-endian): tag `0x00010000`, `true`, `OTTO` -> single face
  at offset 0; `ttcf` -> `numFonts` (uint32 at 8) offsets (uint32 each from
  12) -> one face per offset with `index`. Table directory: `numTables`
  (uint16 at +4), records of 16 bytes from +12 (tag, checksum, offset,
  length). Reject tables whose offset+length exceed the file size.
- `name` table: format 0/1, `count`, `stringOffset`; prefer nameID 16
  (typographic family) then nameID 1; platform 3 encoding 1 or 10 (UTF-16BE)
  with language 0x0409 first, then any language of platform 3, then platform
  1 encoding 0 (Mac Roman; decode bytes < 0x80 as ASCII and skip the face's
  name if it has other bytes). `families` = distinct names, English first.
  `postscriptName` = nameID 6 (same preference order); faces without one get
  `""` and are still listed.
- `OS/2`: `usWeightClass` (uint16 at 4) -> `weight` (default 400 when the
  table is missing or the value is 0); italic from `fsSelection` bit 0
  (uint16 at 62), else `head.macStyle` bit 1 (uint16 at 44).
- Any parsing error for one file -> skip that file (no throw, no stderr).
- `readFace(face)` -> `new Uint8Array(readFileSync(face.source))`; it may
  throw (the CLI reports it).
- Size guard: skip files larger than 256 MB.

## Do not

- Do not use `@resvg/resvg-wasm`'s `loadSystemFonts` (not available in WASM).
- Do not add a font-parsing dependency; `fontkit` is not used here (it would
  read whole files).
- Do not import from `apps/cli/src/commands.ts` (plan 08 owns it).

## Tests (`apps/cli/src/system-fonts.test.ts`)

Build synthetic sfnt buffers in the test (helper that writes a table
directory with `name`, `OS/2`, `head`) into a temp dir from
`mkdtempSync(join(tmpdir(), "nodetto-fonts-"))`:

- TTF with nameID 1 "Test Sans", nameID 6 "TestSans-Regular", weight 400 ->
  one face with those values, `index` 0.
- nameID 16 "Test Family" + nameID 1 "Test Family Bold" -> families start
  with "Test Family".
- TTC with two faces -> two faces with indices 0 and 1, same `source`.
- `fsSelection` italic bit -> `italic: true`; missing `OS/2` -> weight 400.
- truncated file, `.txt` file, directory loop via symlink -> skipped, no throw.
- `fontDirectories("darwin", {}, "/Users/x")` includes
  `/Users/x/Library/Fonts`; win32 with `WINDIR=D:\\Win` includes `D:\\Win\\Fonts`.
- `createSystemFontCatalogue({ directories: [tmp] }).faces` sorted
  deterministically; `readFace` returns the full bytes.
- Smoke (skip when the directory does not exist): the real platform
  catalogue lists at least one face and scanning finishes; record the face
  count and elapsed milliseconds in the progress log.

## Verification

```bash
mkdir -p /tmp/nodetto-export/export-04
bun test apps/cli/src/system-fonts.test.ts > /tmp/nodetto-export/export-04/tests.log 2>&1   # exit 0
bun run typecheck > /tmp/nodetto-export/export-04/typecheck.log 2>&1   # exit 0
bunx biome check apps/cli/src/system-fonts.ts apps/cli/src/system-fonts.test.ts > /tmp/nodetto-export/export-04/biome.log 2>&1   # exit 0
```

## Done criteria

- Commands exit 0; progress log records the real-catalogue face count and
  scan time on this machine (target: under 2 s on macOS).
- `grep -n "readFileSync" apps/cli/src/system-fonts.ts` matches only inside `readFace`.
