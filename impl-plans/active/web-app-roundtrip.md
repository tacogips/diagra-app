# Web/app design round trip

Design: [design-web-app-roundtrip.md](../../design-docs/specs/design-web-app-roundtrip.md)

Status: Complete

- [x] Shared relative attachment paths and legacy-compatible image validation.
- [x] Ephemeral editor asset resolution and all rendering/export consumers.
- [x] Desktop artifact backend, save migration, Save As and reopen lifecycle.
- [x] CLI relative-asset resolution and portable export.
- [x] Editable web/app control shapes and inspector/palette integration.
- [x] Static HTML capture/import into editable artboards with asset adoption.
- [x] HTML page export with copied relative dependencies and UI integration.
- [x] Regression, backend, build and native app validation; documentation.
- [x] Public commits/PR merge, then private submodule pin update in the consuming repository.

## Progress

2026-10-17: Audited existing artboard/prototype/handoff features and confirmed
missing external attachment and HTML import flows. Defined relative artifact
storage, host abstraction, legacy migration, HTML/control scope and acceptance
checks. No unrelated export-design files changed.

2026-10-17: Implemented content-addressed native artifacts, cache hydration,
legacy migration, Save As copying, CLI resolution, six editable controls, static
HTML import, and multi-page HTML/CSS/image ZIP export in app and CLI. Latest
TypeScript suite: 2,068 passed, 5 skipped. Native QA and final checks ongoing.

Verification: TypeScript 2,072 passed / 5 skipped / 0 failed; hosted tests
38 passed; Rust 44 passed; lint/typecheck, desktop and hosted production builds,
clippy with warnings denied, and an independent `unzip -t` check passed.
Native verification was initially blocked by computer-use window errors. Access
recovered on 2026-10-17. In the isolated desktop app: opened both templates,
verified Web/App modes and selected parent artboards, exported one selected
artboard and inspected its ZIP, imported HTML/CSS with an image and CSS
background, saved both references to one content-addressed artifact, edited text
through the inspector, verified autosave on disk, then reloaded with text and
images intact. In Brave, inspected exported web/iPhone pages, switch styling,
and the imported page's edited text, local image and control values. Scripts
from the HTML fixture did not run. PR #21 merged at user request as `79c7274`.

Follow-up audit: local CSS backgrounds now import as editable image layers
(and survive HTML export) rather than being omitted. CSS dependency paths
resolve relative to each stylesheet, reject directory escapes/remote URLs, and
deduplicate with ordinary image elements. The body is captured as a layer so
page backgrounds and direct body text survive. Native window access remains
unavailable.

Web/iPhone templates: three parent artboard shapes per design; every text,
control, chart bar, card and navigation part remains editable. Included JSONL,
per-screen SVG/PNG previews and three-page HTML/CSS exports. File and native
macOS menu entries create new template documents; HTML export supports one
selected artboard or all artboards. Fixed zero-inset text rendering for measured
HTML/design parts, RGB handoff colors and control appearance/typography found
while reviewing rendered examples. Latest suite: 2,080 passed, 5 skipped.
