# bpmn-15-desktop

- planId: bpmn-15-desktop
- planPath: impl-plans/active/bpmn-15-desktop.md
- wave: 4; dependsOn: bpmn-04-core-notation-svg (route resolver),
  bpmn-06-io-bpmn-xml, bpmn-11-ui-solid-problems-panel
- design: design-docs/specs/design-bpmn.md section 9 (desktop and Rust),
  7.4 (panel mounted by App.tsx)
- progress log: impl-plans/progress/bpmn-15-desktop.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Session-359 status and gate: read this first

- Status: NOT STARTED. Runs in wave 4, after the wave-3 join, which
  includes bpmn-11. bpmn-04 and bpmn-06 joined in wave 2. If an owned
  path already exists, re-read and inventory it instead of overwriting
  it.
- Gates: overview "Parallel-wave gate (design 11.1 rule 3)". This plan
  is alone in its wave, so every sibling diagnostic is from an earlier
  wave. Route it through G1 step 4.
- G1 ownRegex:
  `^apps/desktop/src/(App\.tsx|file/session\.ts|file/session\.test\.ts)\(`.
- Focused owned test (strictly blocking):
  `bun test apps/desktop/src/file/session.test.ts`. G2 applies to
  `bun test apps/desktop`.
- The cargo fmt, cargo check and cargo test commands, the Tauri config
  JSON parse, `bun --cwd=apps/desktop run build` and the src-tauri diff
  check cover only this plan's files. They stay strictly blocking. Run
  cargo with `CARGO_TERM_QUIET=true`.
- Evidence: `tmp/bpmn-operation-flow-s359/bpmn-15-desktop/`.

## Intent

Desktop app support for BPMN:
- `.bpmn` files open (open dialog, launch and Finder "Open With") as a
  detached imported document, exactly like Mermaid, so autosave never
  overwrites the `.bpmn`
- File menu "Import BPMN..." and "Export BPMN..."
- the BPMN problems panel is shown when the active page kind is `bpmn`,
  including BPMN import warnings
- minimal Rust: the open-dialog filter and the macOS file association

"Add BPMN page" is already in `PageTabs` (bpmn-09); the inspector kind
`<select>` offers `bpmn` through `PAGE_KINDS` (bpmn-01).

## Non-goals

- No native Tauri menu; no new Rust commands (`pick_export_path` already
  accepts any plain extension, dialogs.rs `normalize_extension`).
- No desktop lint config (user-QA Q2).
- No version bump, no Homebrew cask change, no `tauri.conf.json` other
  than the macOS release association file.

## writePaths

- apps/desktop/src/App.tsx
- apps/desktop/src/file/session.ts
- apps/desktop/src/file/session.test.ts
- apps/desktop/src-tauri/src/dialogs.rs
- apps/desktop/src-tauri/tauri.macos.release.conf.json
- impl-plans/progress/bpmn-15-desktop.md

sharedPaths: none.

## File-level changes

### apps/desktop/src/file/session.ts

- `isBpmnPath(path)`: `/\.bpmn$/i`; `bpmnTitle(path)` strips the
  extension (imitate `isMermaidPath`/`mermaidTitle`, session.ts:91-96).
- `SessionState` (session.ts:34) gains `readonly importWarnings: readonly
  BpmnImportWarning[]` (type-only import from `@diagra/io`), initial `[]`.
  Every load path that is not a BPMN import sets it to `[]` (the
  `openPath` JSONL branch and `importDocument`'s patch).
- In `openPath`, next to the Mermaid branch (session.ts:291-305): for
  `isBpmnPath(path)`, `const { importBpmnXml } = await
  import("@diagra/io/bpmn")`, check `stale()` again, import with `{title:
  bpmnTitle(path)}`, `await this.importDocument(report.document,
  baseName(path))`, and on success `this.patch({ importWarnings:
  report.warnings })`. A `BpmnParseError` -> `this.fail("could not import
  <name>: <message>")`, document untouched.
- Add a public `importBpmn(): Promise<boolean>` only if the existing
  `open()` cannot be reused; prefer reusing `open()` (the dialog filter
  includes `bpmn`), so "Import BPMN..." calls `session.open()`.

### apps/desktop/src/App.tsx

- File menu (App.tsx:729-791): add "Import BPMN..." (calls
  `props.session.open()`; disabled like "Open") and "Export BPMN..."
  (enabled only when the current page kind is `bpmn`).
- `exportBpmn()` imitating `exportSvg` (App.tsx:522-563):
  `exportBpmnXml(props.editor.store.getSnapshot(),
  props.editor.currentPageId, { routeOf: bpmnRouteResolver(props.editor) })`;
  file name `<exportBaseName(page name)>.bpmn`; desktop:
  `props.exportBackend.pickExportPath(name, "bpmn")` then `writeText`;
  browser: `downloadText(name, xml, "application/xml")`; errors through
  the existing `setExportError`. Load `exportBpmnXml` with a dynamic
  `await import("@diagra/io/bpmn")` inside `exportBpmn` (Mermaid pattern,
  keeps the startup bundle small); import `bpmnRouteResolver` statically
  from `@diagra/core`.
- Mount `<BpmnProblemsPanel editor={props.editor} viewport={viewport}
  importWarnings={file().importWarnings} />` (from `@diagra/ui-solid`)
  inside a `<Show>` that is true when the current page kind is `bpmn`
  (reactive via the existing editor signals used in App.tsx), placed in
  the side area next to the Inspector (App.tsx:~1137). Follow the
  existing layout classes; add no new CSS file (panel CSS ships with
  bpmn-11).

### apps/desktop/src-tauri/src/dialogs.rs

`OPEN_FILTER_EXTENSIONS` (dialogs.rs:14) becomes `&["jsonl", "mmd",
"mermaid", "bpmn"]`. Update any Rust unit test that asserts the list.

### apps/desktop/src-tauri/tauri.macos.release.conf.json

Add a file association entry after the Mermaid one: `"ext": ["bpmn"]`,
`"name": "BPMN diagram"`, `"description": "BPMN 2.0 process diagram"`,
`"role": "Viewer"`, `"rank": "Alternate"`. Keep JSON formatting.

## Pitfalls

- The imported BPMN document must stay detached: `filePath: null`,
  `dirty: true`, watcher `null` (as the Mermaid test asserts) so autosave
  can never write JSONL into the `.bpmn`.
- Re-check `stale()` after the dynamic import (the Mermaid branch does).
- Do not change `launch.rs`: it does not filter extensions.
- Run cargo commands with `CARGO_TERM_QUIET=true`; format Rust with
  `cargo fmt`.

## Tests (input -> expected) in `session.test.ts`

Imitate "opening Mermaid imports a detached document and never rewrites
the source" (session.test.ts:444):
- open `/docs/purchase.bpmn` with the content of
  `packages/io/src/__fixtures__/bpmn/purchase-request.bpmn` (read with
  `readFileSync` from `import.meta.dir`) -> opened true; state
  `filePath: null`, `fileName: "purchase.bpmn"`, `dirty: true`,
  `importWarnings: []`; first page kind `bpmn`; 13 flow nodes; watcher
  `null`; after an edit and the autosave timer, the backend file content
  at the `.bpmn` path is unchanged
- open a malformed `.bpmn` (`<bpmn:definitions`) -> opened false, error
  starts with "could not import", previous document untouched
- open a `.bpmn` containing a `transaction` -> `importWarnings` length 1
- opening a `.jsonl` afterwards -> `importWarnings` is `[]`

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck > tmp/bpmn-operation-flow-s359/bpmn-15-desktop/typecheck.log 2>&1   # gate G1 (overview): no ownRegex match, no unattributed "error TS" line; exit code recorded
bunx biome check apps/desktop/src/App.tsx apps/desktop/src/file/session.ts apps/desktop/src/file/session.test.ts   # exit 0
bun test apps/desktop/src/file/session.test.ts          # exit 0, pass count > 0, 0 fail (owned tests incl. the 4 new .bpmn cases, design 11.1 rule 1)
bun test apps/desktop                                   # exit 0 (existing session tests unchanged and passing)
CARGO_TERM_QUIET=true cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check   # exit 0; if it fails, it must list only dialogs.rs: then run the same command without "-- --check" and re-check
CARGO_TERM_QUIET=true cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # exit 0
CARGO_TERM_QUIET=true cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml dialogs   # exit 0
bun -e 'JSON.parse(require("fs").readFileSync("apps/desktop/src-tauri/tauri.macos.release.conf.json","utf8"))'   # exit 0 (valid JSON)
bun --cwd=apps/desktop run build                         # exit 0 (vite resolves @diagra/io/bpmn)
```

## Done criteria

- `grep -n '"bpmn"' apps/desktop/src-tauri/src/dialogs.rs apps/desktop/src-tauri/tauri.macos.release.conf.json`
  shows both edits.
- `git diff --stat apps/desktop/src-tauri` lists only those two files.
- All verification commands exit 0; recorded in the progress log.
