# Web/app design round trip

Design: [design-web-app-roundtrip.md](../../design-docs/specs/design-web-app-roundtrip.md)

Status: In progress

- [x] Shared relative attachment paths and legacy-compatible image validation.
- [x] Ephemeral editor asset resolution and all rendering/export consumers.
- [x] Desktop artifact backend, save migration, Save As and reopen lifecycle.
- [x] CLI relative-asset resolution and portable export.
- [x] Editable web/app control shapes and inspector/palette integration.
- [x] Static HTML capture/import into editable artboards with asset adoption.
- [x] HTML page export with copied relative dependencies and UI integration.
- [ ] Regression, backend, build and native app validation; documentation.
- [ ] Public commits/PR merge, then private submodule pin update.

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
Native visual verification is pending: computer-use returns `cgWindowNotFound`
for both isolated audit apps and `timeoutReached` for Safari. No visual pass
is claimed. Keep the public PR draft and the private pin unchanged until this
check can run.

Follow-up audit: local CSS backgrounds now import as editable image layers
(and survive HTML export) rather than being omitted. CSS dependency paths
resolve relative to each stylesheet, reject directory escapes/remote URLs, and
deduplicate with ordinary image elements. The body is captured as a layer so
page backgrounds and direct body text survive. Native window access remains
unavailable.
