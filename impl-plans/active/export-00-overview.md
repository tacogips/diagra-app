# Export (PNG, SVG, PDF): plan overview

Design source of truth: `design-docs/specs/export.md` (accepted at step 3).
Owner defaults in `design-docs/user-qa/export-questions.md` (Q1 web PDF uses
standard fonts, Q2 pin svg-to-pdfkit, Q3 default background `#f6f4ee`) are
implemented as written.

This file is the serial index. Workers never edit it.

## Plans and waves

| Wave | planId | File | dependsOn |
| --- | --- | --- | --- |
| 1 | export-01-contracts | `impl-plans/active/export-01-contracts.md` | none |
| 2 | export-02-pdf-encoder | `impl-plans/active/export-02-pdf-encoder.md` | 01 |
| 2 | export-03-font-resolver | `impl-plans/active/export-03-font-resolver.md` | 01 |
| 2 | export-04-cli-system-fonts | `impl-plans/active/export-04-cli-system-fonts.md` | 01 |
| 2 | export-05-cli-png-encoder | `impl-plans/active/export-05-cli-png-encoder.md` | 01 |
| 2 | export-06-desktop-tauri-backend | `impl-plans/active/export-06-desktop-tauri-backend.md` | 01 |
| 2 | export-07-ui-export-menu | `impl-plans/active/export-07-ui-export-menu.md` | 01 |
| 3 | export-08-cli-export-command | `impl-plans/active/export-08-cli-export-command.md` | 02, 03, 04, 05 |
| 3 | export-09-desktop-export-flow | `impl-plans/active/export-09-desktop-export-flow.md` | 02, 03, 06, 07 |
| 4 | export-10-readme-and-final-verification | `impl-plans/active/export-10-readme-and-final-verification.md` | 08, 09 |

## Rules for every worker (all plans)

1. Repository: the public `nodetto-app`. Never add server code, auth, secrets,
   endpoints or infra config. Never bump versions, tag, release or touch the
   Homebrew cask.
2. Write only the paths listed in your plan's `writePaths`. Edit
   `sharedPaths` only as described in that plan's shared-path note.
3. Before each edit, re-read the file fresh (never edit from memory). In your
   progress log, record `shasum -a 256 <file>` before and after each edited
   file. If a file you own changed between your read and your write
   (a hash mismatch), or a file outside your paths that your work depends on
   changed in a way that breaks you, stop editing that file and record the
   drift in your progress log. Serial repair happens after the wave joins.
4. No git operations: no commit, stash, checkout, reset, branch or worktree.
5. No lockfile changes (`bun.lock`, `Cargo.lock`) and no dependency edits
   outside `export-01-contracts`. If you discover that a dependency is missing,
   record it in your progress log as a blocker and do not run `bun add`.
6. Format only your own files: `bunx biome format --write <your files>` and
   `bunx biome check <your files>`. Never run repo-wide `bun run format`.
   Rust: `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` is
   allowed only in plan 06; other plans do not touch Rust.
7. Run cargo commands with `CARGO_TERM_QUIET=true`.
8. Progress log: each plan has its own
   `impl-plans/active/<planId>.progress.md` (in its writePaths). Record:
   start time, each task with status (todo/doing/done/blocked), file hashes,
   every verification command with its exit code and the path of its full
   log (`/tmp/nodetto-export/<planId>/<step>.log`; create the directory), and
   any deviations from the plan with reasons.
9. Verification commands must run in the foreground to completion. A check
   passes only if its exit code is 0 and its full log exists.
10. Do not write code that the plan does not ask for: no extra options, no
    generalized frameworks, no refactors of unrelated code.
11. Artifact roots. Each plan's "artifactRoots" section lists generated,
    gitignored output that its commands write: dependency installs
    (`node_modules` directories), the Cargo build directory (`target`), the
    compiled sidecar directory (`apps/desktop/src-tauri/binaries`) and the
    Vite output (`apps/desktop/dist`). Each artifact root is also one of the
    plan's writePaths. Artifact roots are never authored by hand and never
    committed; only the owning plan may write them, and only during its wave.
    No two plans in the same wave own the same artifact root. Provenance
    (commands, exit codes, versions, sha256 digests) goes in the owning
    plan's tracked progress log, which is the audit manifest.
12. Commands that would write an artifact root you do not own (for example
    `cargo` writing `target`, or `bun build --compile` writing temporary
    files into the current directory) must not be run. Run `bun build
    --compile` checks from `/tmp/nodetto-export/<planId>` with absolute paths,
    then confirm `git status --short --ignored` at the repo root shows no new
    `*.bun-build` file; record the check.
13. Peer drift during a wave: `bun run typecheck` and `bun test` see the whole
    shared tree. If they fail only in files owned by another plan of the same
    wave, do not edit those files. Record the failure (file, error, log path)
    in your progress log as peer drift, make sure your own files and tests
    are clean (run your plan's scoped tests), and mark the repo-wide check
    "re-run after join". Serial reconciliation re-runs it.

## Intentional divergences from the design (accepted at planning)

- Design 3.1/3.4 put the font types and the SVG usage scan in
  `export-fonts.ts`. The plans move them to
  `packages/core/src/export-font-usage.ts` (wave 1) so that the font types
  shared by plans 02, 03, 04, 05, 06 and 09 are pinned before the parallel
  wave. `export-fonts.ts` keeps the resolver and the generic-family tables.
- Design 3.4 sketches `resolveExportFonts(usage, catalogue, platform)`. The
  plans pin `resolveExportFonts(svg, catalogue, options?)`: the resolver runs
  `scanFontUsage` itself, and the platform comes from
  `FontCatalogue.platform`. Behavior is unchanged.

## Shared contract summary (pinned by export-01-contracts)

- `packages/core/src/export-formats.ts`: `ExportScope`, `ExportFormat`,
  `DEFAULT_EXPORT_PADDING`, `DEFAULT_EXPORT_BACKGROUND`, `RASTER_SCALES`,
  `MAX_PDF_PAGE_POINTS`, `parseExportBackground`, `svgRasterDimensions`,
  `rasterDimensions`, `pdfPageSize`, `exportScopeSvg`, `exportFileName`.
- `packages/core/src/export-font-usage.ts`: `FontFaceInfo`, `FontCatalogue`,
  `FontUsage`, `ResolvedFace`, `ResolvedExportFonts`, `normalizeFontStack`,
  `isBoldWeight`, `scanFontUsage`.
- Dependencies: `pdfkit`, `svg-to-pdfkit`, `fontkit` in `@nodetto/core`;
  `@resvg/resvg-wasm` in `@nodetto/cli`; `fontdb` in the Tauri crate.
- `@nodetto/core/pdf-export` subpath (package export + tsconfig path), file
  created by export-02.
- `fontkit` is only loaded with a dynamic `await import("fontkit")` inside
  `resolveExportFonts` (export-03), so it never enters the app's main chunk.
- `rasterizeSvg` is re-exported from `@nodetto/ui-solid` (export-07); app code
  imports it from the package, never through a relative path into
  `packages/`.

## Artifact roots by plan

| planId | artifactRoots |
| --- | --- |
| export-01-contracts | `node_modules`, `apps/cli/node_modules`, `apps/desktop/node_modules`, `packages/core/node_modules`, `packages/ui-solid/node_modules`, `packages/io/node_modules`, `packages/collab/node_modules`, `packages/ir/node_modules`, `target` |
| export-06-desktop-tauri-backend | `target` |
| export-08-cli-export-command | `apps/desktop/src-tauri/binaries` |
| export-09-desktop-export-flow | `apps/desktop/dist`, `apps/desktop/node_modules` |
| export-10-readme-and-final-verification | `target`, `apps/desktop/src-tauri/binaries` |

`apps/desktop/src-tauri/gen/schemas` is tracked output that `tauri-build`
rewrites on every cargo build. It is a normal source writePath of the plans
that run cargo (01, 06, 10). They must record whether `git diff --stat --
apps/desktop/src-tauri/gen/schemas` is empty and explain any change.

## Final verification (export-10)

```bash
bun test packages/core packages/ui-solid apps/cli
bun run typecheck
mise run verify
bun run apps/cli/scripts/build-sidecar.ts
apps/desktop/src-tauri/binaries/nodetto-cli-<triple> export apps/cli/test-fixtures/erd-frames.jsonl --format png --scale 2 --output /tmp/nodetto-export/erd.png
apps/desktop/src-tauri/binaries/nodetto-cli-<triple> export apps/cli/test-fixtures/erd-frames.jsonl --format pdf --output /tmp/nodetto-export/erd.pdf
```
