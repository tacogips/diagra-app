# Drag page tabs to reorder pages

Implemented on 2026-10-16.

Page-name buttons now capture the primary pointer and preview an insertion marker
before/after the tab under the pointer. Releasing performs one `reorderPageTo`
command, retaining the active page, camera and selection. Normal clicks and
renaming remain available; existing Move left/right menu actions remain the
keyboard alternative. Wrapped tab rows are supported.

Escape, window blur, pointer cancellation, drops outside the tabs, read-only mode,
a removed source/target or a replaced document do not reorder pages. Drag targets
use stable page IDs and are resolved against the current order at release, so a
peer's rename or independent reorder is retained. Only the final page-order change
is persisted/synchronized and added to undo history.

Verification:

- `page-tab-drag.test.ts`: arbitrary moves, one-step undo/redo, JSONL reopen,
  camera/selection preservation, wrapped rows, cancellation, pointer ownership,
  concurrent changes and read-only transitions.
- Existing page-order and collaboration tests exercise the same fractional page
  keys and updatePage command transport.
- Brave against an isolated Vite build: real pointer drag changed
  `Alpha, Beta, Gamma` to `Beta, Gamma, Alpha`; one Undo restored the original order.
  This used a temporary fixture rendering the actual PageTabs component, not a
  simulated click handler. The fixture and input diagnostics were removed.
