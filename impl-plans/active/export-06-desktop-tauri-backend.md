# export-06-desktop-tauri-backend

- planId: export-06-desktop-tauri-backend
- planPath: impl-plans/active/export-06-desktop-tauri-backend.md
- wave: 2
- dependsOn: export-01-contracts
- design: `design-docs/specs/export.md` sections 3.4 (Catalogue, Desktop),
  4.3 (Saving), 6 (`fontdb`)

## Intent and context

The desktop app needs two host capabilities that the webview lacks: an
atomic binary write for PNG/PDF exports, and read access to installed fonts
for PDF text embedding. Add three Tauri commands and their TypeScript
clients. The export flow that calls them is plan 09. Read
`impl-plans/active/export-00-overview.md` worker rules first.

## Non-goals

- No UI and no `App.tsx` changes (plan 09).
- Do not change `write_document_atomic`, `pick_export_path` behavior, or
  the document session (`FileBackend`).
- No new Tauri plugins, no capability broadening beyond what custom commands
  need (custom `invoke_handler` commands need no extra permission today; keep
  `capabilities/default.json` unchanged unless the build proves otherwise and
  then record why).

## writePaths

- apps/desktop/src-tauri/src/fonts.rs (new)
- apps/desktop/src-tauri/src/fs.rs
- apps/desktop/src-tauri/src/lib.rs
- apps/desktop/src/file/backend.ts
- apps/desktop/src/export/desktop-fonts.ts (new)
- apps/desktop/src/export/desktop-fonts.test.ts (new)
- impl-plans/active/export-06-desktop-tauri-backend.progress.md

sharedPaths: none. (`apps/desktop/src-tauri/Cargo.toml` and `Cargo.lock`
were updated by plan 01 with `fontdb`; do not edit them. If `fontdb` is
missing, record a blocker.)

## Rust changes

1. `fs.rs`:
   - Generalize `write_then_rename` / `write_atomic` to take `&[u8]`; keep
     `write_document_atomic(path: String, contents: String)` working by
     passing `contents.as_bytes()` (no behavior change, existing tests stay).
   - New command `write_export_atomic(request: tauri::ipc::Request<'_>) ->
     Result<(), String>`: body must be `tauri::ipc::InvokeBody::Raw(bytes)`
     (JSON body -> `Err("export bytes must be sent as a raw body")`); path
     from header `x-nodetto-path`, percent-decoded (JS sends
     `encodeURIComponent(path)`); lower-cased extension must be `svg`, `png`
     or `pdf` else `Err("unsupported export file type: <ext>")`; write via
     `write_atomic`. Error strings follow the existing `failed to write
     {path}: {error}` style.
   - Percent-decoding: implement a small decoder for `%XX` sequences over
     UTF-8 bytes (reject invalid sequences with an error); do not add a crate.
2. `fonts.rs`:
   - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] struct
     FontFaceDto { source: String, index: u32, postscript_name: String,
     families: Vec<String>, weight: u16, italic: bool }` (JSON keys match
     `FontFaceInfo`).
   - Managed state `FontCatalogueState(Mutex<Option<Vec<FontFaceDto>>>)`
     registered with `.manage(...)` in `lib.rs`.
   - `#[tauri::command] fn list_font_faces(state) -> Vec<FontFaceDto>`:
     build once with `fontdb::Database::new()` +
     `load_system_fonts()`; map each face with a file source
     (`Source::File(path)` or `Source::SharedFile(path, _)`); skip binary
     sources; families: English entries first (`fontdb::Language::English_UnitedStates`),
     then the rest, de-duplicated; weight `face.weight.0`; italic when
     `face.style != fontdb::Style::Normal`. Sort by (source, index) and cache.
   - `#[tauri::command] fn read_font_file(state, source: String) ->
     Result<tauri::ipc::Response, String>`: only when `source` equals the
     `source` of a cached face (call `list_font_faces` logic first if not
     cached); otherwise `Err("font file is not in the system catalogue")`.
     Return `tauri::ipc::Response::new(bytes)` (raw bytes, not JSON numbers).
   - Keep `fontdb` usage behind small pure helpers so unit tests can cover
     the mapping and the allow-list check without a GUI (`fn
     is_catalogued(faces: &[FontFaceDto], source: &str) -> bool`, `fn
     to_dto(face: &fontdb::FaceInfo) -> Option<FontFaceDto>`).
3. `lib.rs`: `mod fonts;`, register `fs::write_export_atomic`,
   `fonts::list_font_faces`, `fonts::read_font_file` in the existing
   `generate_handler!` list, `.manage(fonts::FontCatalogueState::default())`.

Imitate: `apps/desktop/src-tauri/src/fs.rs:write_document_atomic` (error
mapping), `fs.rs` test module with `tempfile::tempdir`.

## TypeScript changes

1. `apps/desktop/src/file/backend.ts`:
   - `ExportBackend` gains `writeBytes(path: string, bytes: Uint8Array): Promise<void>`.
   - Tauri: `invoke<void>("write_export_atomic", bytes, { headers: { "x-nodetto-path": encodeURIComponent(path) } })`.
   - Unavailable backend: `writeBytes: unavailable` (existing helper).
2. `apps/desktop/src/export/desktop-fonts.ts`:
   - `export function createDesktopFontCatalogue(invokeFn = invoke): Promise<FontCatalogue>`:
     `list_font_faces` -> `faces`; `platform` from `navigator.userAgent`
     (`Mac` -> macos, `Win` -> windows, else linux); `readFace(face)` ->
     `invokeFn<ArrayBuffer>("read_font_file", { source: face.source })` ->
     `new Uint8Array(buffer)`. Cache the catalogue promise for the session.
   - Only for Tauri; plan 09 passes `null` fonts in a plain browser.

## Pitfalls

- Sending bytes as a JSON array (`Array.from(bytes)`) is wrong: it is
  orders of magnitude slower for large PNGs. Send the `Uint8Array` as the
  raw invoke payload.
- Never let `read_font_file` read arbitrary paths: the allow-list check is
  the security boundary for the webview.
- Path header: non-ASCII paths must survive (percent-encode in JS, decode
  in Rust); test it.
- Run `cargo fmt` and clippy with `-D warnings` as the repo does
  (`mise run clippy`).

## Tests

Rust (`fs.rs` / `fonts.rs` test modules):
- `write_atomic` with bytes `[0x89, 0x50, 0x4e, 0x47]` -> file has exactly those bytes; no temp siblings left.
- extension check: `a.png`, `a.PDF`, `a.svg` accepted; `a.jsonl`, `a` rejected (test the pure helper).
- percent-decode: `%2Ftmp%2F%E5%9B%B3.png` -> `/tmp/図.png`; `%ZZ` -> error.
- `is_catalogued` true only for listed sources.
- existing `write_document_atomic` tests still pass.

TS (`apps/desktop/src/export/desktop-fonts.test.ts`, with a fake `invokeFn`):
- `list_font_faces` result maps to `faces` unchanged; `readFace` calls
  `read_font_file` with `{ source }` and returns a `Uint8Array`.
- catalogue promise is cached (one `list_font_faces` call for two awaits).

## Verification

```bash
mkdir -p /tmp/nodetto-export/export-06
CARGO_TERM_QUIET=true cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml > /tmp/nodetto-export/export-06/fmt.log 2>&1   # exit 0
CARGO_TERM_QUIET=true mise run clippy > /tmp/nodetto-export/export-06/clippy.log 2>&1   # exit 0, no warnings
CARGO_TERM_QUIET=true cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml > /tmp/nodetto-export/export-06/cargo-test.log 2>&1   # exit 0
bun test apps/desktop/src/export/desktop-fonts.test.ts > /tmp/nodetto-export/export-06/ts-tests.log 2>&1   # exit 0
bun run typecheck > /tmp/nodetto-export/export-06/typecheck.log 2>&1   # exit 0
bunx biome check apps/desktop/src/file/backend.ts apps/desktop/src/export/desktop-fonts.ts apps/desktop/src/export/desktop-fonts.test.ts > /tmp/nodetto-export/export-06/biome.log 2>&1   # exit 0
```

## Done criteria

- All commands exit 0.
- `grep -n "write_export_atomic\|list_font_faces\|read_font_file" apps/desktop/src-tauri/src/lib.rs` shows all three.
- `git diff --stat -- apps/desktop/src-tauri/capabilities` is empty (or the
  progress log explains a required change).
