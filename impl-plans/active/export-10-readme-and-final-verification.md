# export-10-readme-and-final-verification

- planId: export-10-readme-and-final-verification
- planPath: impl-plans/active/export-10-readme-and-final-verification.md
- wave: 4
- dependsOn: export-08-cli-export-command, export-09-desktop-export-flow
- design: `design-docs/specs/export.md` sections 7, 8

## Intent and context

Document the feature in `README.md` (app and CLI sections) and run the full
verification suite plus the sidecar check against the ERD fixture. This is
the serial finalization plan: it runs alone, after every other plan joined.
Read `impl-plans/active/export-00-overview.md` worker rules first and every
`impl-plans/active/export-0*.progress.md` for open blockers or drift notes.

## Non-goals

- No feature code changes. If verification fails, record the failing
  command, its log and the owning plan in the progress log and stop; repair
  belongs to the owning plan's fix round, not here.
- No version bump, tag, release, cask or CHANGELOG release entry.

## writePaths

- README.md
- impl-plans/active/export-10-readme-and-final-verification.progress.md

sharedPaths: none.

## README changes

1. "Command line (`nodetto-cli`)" section (`README.md` around line 94): add
   to the code block
   `nodetto-cli export schema.jsonl --format png --scale 2 --output schema.png`,
   `nodetto-cli export schema.jsonl --format pdf --output schema.pdf`,
   `nodetto-cli export schema.jsonl --format svg > schema.svg`, and a short
   paragraph: formats, `--page` (required when the document has several
   pages), `--output` required for PNG/PDF and atomic, SVG to stdout,
   `--scale` PNG only (0.5, 0.75, 1, 1.5, 2, 3, 4), `--background
   <#rrggbb>` (default canvas color `#f6f4ee`) or `--transparent`, exit 2 on
   errors, SVG byte-identical to the app's page export, and fonts: PNG/PDF
   use installed fonts that resolve the editor's font stacks, PDF embeds
   font subsets, and a page with text fails with exit 2 when no installed
   font can render it.
2. New app section `## Export` (place it next to "Database schema export"
   or the PNG paragraph near line 600, whichever keeps related text
   together): Export menu items (Export SVG with Cmd/Ctrl+Shift+E unchanged;
   Page as PNG/SVG/PDF; Selection as PNG/SVG/PDF), the dialog (background:
   canvas color, transparent or custom hex; PNG scale with pixel size and
   the 8192 px / 32 MP limit), a single selected artboard exports at its
   exact size, desktop save dialog vs browser download, PDF is vector with
   one canvas unit = one point and a 14400 pt side limit, layer effects and
   blend modes are dropped in PDF with a warning, and in a plain browser PDF
   text uses standard PDF fonts (non-Latin text needs the desktop app or
   the CLI). Hidden layers and editor chrome are never exported.
3. Fix the font sentence near line 411 ("Fonts must be installed on the
   viewing system; exports do not embed fonts.") to: SVG references fonts
   by name and does not embed them; PDF embeds subsets of the installed
   fonts; PNG renders with installed fonts.
4. Keep the existing inspector Download PNG paragraph as is.

Imitate the README's existing tone: plain sentences, no marketing, no emojis.

## Verification (run in order, record exit codes and logs)

```bash
mkdir -p /tmp/nodetto-export/export-10
bun test packages/core packages/ui-solid apps/cli > /tmp/nodetto-export/export-10/bun-tests.log 2>&1   # exit 0
bun run typecheck > /tmp/nodetto-export/export-10/typecheck.log 2>&1   # exit 0
CARGO_TERM_QUIET=true mise run verify > /tmp/nodetto-export/export-10/verify.log 2>&1   # exit 0 (biome, tsc, bun tests, cargo test, clippy)
bun run apps/cli/scripts/build-sidecar.ts > /tmp/nodetto-export/export-10/sidecar-build.log 2>&1   # exit 0
TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
apps/desktop/src-tauri/binaries/nodetto-cli-$TRIPLE export apps/cli/test-fixtures/erd-frames.jsonl --format png --scale 2 --output /tmp/nodetto-export/export-10/erd.png > /tmp/nodetto-export/export-10/sidecar-png.log 2>&1   # exit 0
apps/desktop/src-tauri/binaries/nodetto-cli-$TRIPLE export apps/cli/test-fixtures/erd-frames.jsonl --format pdf --output /tmp/nodetto-export/export-10/erd.pdf > /tmp/nodetto-export/export-10/sidecar-pdf.log 2>&1   # exit 0
apps/desktop/src-tauri/binaries/nodetto-cli-$TRIPLE export apps/cli/test-fixtures/erd-frames.jsonl --format svg > /tmp/nodetto-export/export-10/sidecar.svg 2> /tmp/nodetto-export/export-10/sidecar-svg.log   # exit 0
bun apps/cli/src/main.ts export apps/cli/test-fixtures/erd-frames.jsonl --format svg > /tmp/nodetto-export/export-10/bun.svg   # exit 0
cmp /tmp/nodetto-export/export-10/sidecar.svg /tmp/nodetto-export/export-10/bun.svg   # exit 0
xxd -l 24 /tmp/nodetto-export/export-10/erd.png   # PNG signature; IHDR width/height = ceil(viewBox x 2)
head -c 8 /tmp/nodetto-export/export-10/erd.pdf   # %PDF-1.x
grep -a -o "/MediaBox \[[^]]*\]" /tmp/nodetto-export/export-10/erd.pdf   # equals the viewBox width/height of sidecar.svg
grep -c "hidden-note" /tmp/nodetto-export/export-10/sidecar.svg   # 0
gitleaks detect --no-banner --source . > /tmp/nodetto-export/export-10/gitleaks.log 2>&1   # exit 0 (if gitleaks is installed)
```

## Done criteria

- Every command meets its stated result; evidence (exit codes, log paths,
  PNG IHDR numbers, PDF MediaBox vs viewBox) is in the progress log.
- `grep -n "nodetto-cli export" README.md` and `grep -n "^## Export" README.md` match.
- No open blocker or unrepaired drift remains in any
  `impl-plans/active/export-0*.progress.md`; otherwise the plan is reported
  incomplete with the list.
