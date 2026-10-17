# Web/app design: portable assets and HTML round trips

## Request and current evidence

Web and native artboards, reusable components, auto layout, constraints, tokens,
prototype links, and generated HTML already exist. The missing end-to-end paths
are (1) external document attachments and (2) importing a static HTML page as
editable canvas content. Raster imports currently store data URLs inside JSONL;
IR rejects relative sources, the renderer uses sources verbatim, and file saving
writes only one JSONL file. The HTML handoff generates artboards but there is no
HTML-page importer or portable HTML-and-assets export workflow.

## Required behavior

1. Documents reference attachments by a normalized POSIX path relative to the
   JSONL file, for example `artifacts/<content-hash>.png`. Save the bytes beside
   the document, not inside JSONL. Keep legacy embedded documents readable.
2. Resolve assets through a host-independent adapter. Core/IR never read a local
   filesystem or fetch arbitrary URLs. Desktop and CLI implement local adapters;
   the web host can supply its own implementation later.
3. First save externalizes embedded assets. Save As copies referenced bytes to
   the destination's artifacts directory before atomically writing JSONL.
   Missing files produce actionable errors; do not silently write a broken copy.
   Never delete attachments during save or undo. Empty untitled documents still
   create no files. Copies of the JSONL plus its artifacts directory remain usable.
4. Display, image replacement/cropping, prototype preview, raster masks and
   SVG/PNG/PDF/HTML export resolve the same asset references. CLI export resolves
   from the input file's directory, independently of the working directory.
5. Import a local HTML page into an editable top-level artboard with editable
   child layers. Import layout, text, colors, borders, images, and common controls.
   Scripts, event handlers, active embeds and network fetches do not execute.
   Copy imported raster images into document artifacts on save. Keep the source
   HTML/CSS unchanged.
   Unsupported layout/content must be reported rather than silently disappearing.
6. Add web/app control shapes where the existing generic boxes cannot preserve
   control semantics (button, text input, textarea, select, checkbox and switch).
   Expose their editable values/states in the inspector and preserve them in HTML.
7. Export every top-level artboard on the current page as a separate HTML/CSS
   pair, with an index and shared raster assets in a portable ZIP. HTML and
   document attachments are independent features. Keep existing code exports.
   Provide visible import/export entry points consistent with the current UI.
8. Document supported static HTML/CSS behavior and limitations: this imports a
   design, not an application's JavaScript, backend, or authenticated state.

## Asset and lifecycle design

Use a shared normalized attachment-path contract, content-addressed file names,
strict raster signature validation, and an ephemeral resolved-asset cache on the
editor. The persisted model always contains the relative reference; loading and
rendering must not rewrite saved semantics or create history entries. Cache
changes notify rendering without marking the document dirty. Reset per document,
and guard asynchronous reads against document/page changes.

Local adapters reject absolute paths, URLs, encoded traversal, symlinks escaping
an authorized document directory, and unsupported file content. Writes are
append-only/content-addressed and precede JSONL replacement. Failed writes leave
the original document intact. Save As is coordinated with queued writes and
existing generation guards. Unreferenced files can remain for undo/history;
automatic garbage collection is out of scope.

## HTML import design

Parse inside an inert template before mounting in a sandboxed iframe. Sanitize
before mounting content for measurement. Use an isolated, script-disabled capture
surface and restrict imported CSS/URLs to local authorized dependencies. Static
layout is measured at a 1440px viewport (maximum 3,000 nodes / 8 MiB HTML). Preserve element hierarchy in frames,
editable text and image layers, and native control semantics. Report unsupported
features and use deterministic geometry/limits to bound deeply nested inputs.

Round-trip acceptance compares authored/imported structure, text, control state,
layout and local asset paths. Pixel-perfect recovery of arbitrary web applications
is not promised; unsupported features must be explicit in import results.

## Verification

Cover valid/invalid relative paths, signature and size limits, cache isolation,
legacy migration, failures before JSONL write, Save As across directories, stale
loads, CLI export from another cwd, HTML parsing/conversion, hostile HTML/CSS,
control semantics, and exported HTML asset resolution. Run lint/typecheck, the
existing TypeScript suite, Rust checks/tests after backend edits, desktop and
hosted builds, and real desktop import/edit/save/reopen/export checks using an
isolated test app and disposable files. Preserve unrelated export plans.

## Implemented import/export contract

Open `.html` or `.htm` through File/Open. Local stylesheets and raster images
resolve beneath the HTML file directory. Parent-directory/remote dependencies
are omitted with warnings. The result is a new unsaved document; source HTML
is never overwritten. Text, frames, colors, borders, controls and image layers
remain editable. Scripts, active embeds, SVG/canvas/media, CSS background images,
web fonts and responsive behavior are outside this static import. Source CSS
selectors cannot affect the editor. Raster files retain the existing 1 MiB limit.

Export/HTML creates a ZIP containing an index, separate HTML/CSS for every
top-level frame on the current page, and shared binary raster assets. CLI:
`nodetto-cli export design.jsonl --format html --output website.zip`. Generated
HTML is a static implementation starting point; application behavior and
prototype navigation are not generated. Missing images fail export instead of
producing an incomplete package.
