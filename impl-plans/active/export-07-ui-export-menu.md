# export-07-ui-export-menu

- planId: export-07-ui-export-menu
- planPath: impl-plans/active/export-07-ui-export-menu.md
- wave: 2
- dependsOn: export-01-contracts
- design: `design-docs/specs/export.md` sections 4.1, 4.2

## Intent and context

Add the six Export menu actions (Page/Selection x PNG/SVG/PDF) and the
`ExportDialog` that collects background and PNG scale. The dialog does no
file I/O; it calls back into the shell (plan 09 implements the callback).
Existing "Export SVG" (`exportSvg`, Cmd/Ctrl+Shift+E) stays exactly as is.
Read `impl-plans/active/export-00-overview.md` worker rules first.

## Non-goals

- No encoding, saving, downloading or font work.
- Do not change `AssetExportSection.tsx` or `raster-export.ts`.
- No keyboard shortcuts for the new actions.

## writePaths

- packages/ui-solid/src/shortcuts.ts
- packages/ui-solid/src/shortcuts.test.ts
- packages/ui-solid/src/viewer-actions.test.ts
- packages/ui-solid/src/Toolbar.tsx
- packages/ui-solid/src/Toolbar.test.ts
- packages/ui-solid/src/ExportDialog.tsx (new)
- packages/ui-solid/src/ExportDialog.css (new)
- packages/ui-solid/src/export-dialog.ts (new, DOM-free helpers)
- packages/ui-solid/src/export-dialog.test.ts (new)
- packages/ui-solid/src/index.ts
- impl-plans/active/export-07-ui-export-menu.progress.md

## sharedPaths

- apps/desktop/src/App.tsx

sharedPathNotes: `apps/desktop/src/App.tsx` -> in `actionContext()` only,
add `openExport: () => {}` so the app typechecks after `ActionContext`
gains the field. Touch nothing else in the file. Plan 09 (wave 3) replaces
this stub with the real handler.

## Pinned contracts

`shortcuts.ts`:

```ts
// ActionId union gains:
| "exportPagePng" | "exportPageSvg" | "exportPagePdf"
| "exportSelectionPng" | "exportSelectionSvg" | "exportSelectionPdf"
// ActionContext gains:
readonly openExport: (scope: "page" | "selection", format: ExportFormat) => void;
```

`ExportFormat` is imported from `@nodetto/core`.

`ExportDialog.tsx`:

```ts
export interface ExportDialogProps {
  readonly scope: "page" | "selection";
  readonly format: ExportFormat;
  /** viewBox size of the SVG that would be exported, or null if empty. */
  readonly contentSize: { readonly width: number; readonly height: number } | null;
  readonly onExport: (options: { readonly background: string | null; readonly scale: number }) => Promise<readonly string[]>; // resolves to warnings
  readonly onClose: () => void;
}
export function ExportDialog(props: ExportDialogProps): JSX.Element;
```

`export-dialog.ts` (pure, tested):

```ts
export type BackgroundChoice = { readonly kind: "canvas" } | { readonly kind: "transparent" } | { readonly kind: "custom"; readonly value: string };
export function resolveBackground(choice: BackgroundChoice): string | null | Error; // canvas -> DEFAULT_EXPORT_BACKGROUND, transparent -> null, custom -> parseExportBackground or Error("Background must be a six-digit hex color.")
export function pngSizeLabel(size: { width: number; height: number } | null, scale: number): string; // "1200 x 800 px" or the rasterDimensions error message
export function exportDialogTitle(scope: "page" | "selection", format: ExportFormat): string; // "Export page as PNG"
```

## Key points

- Actions (in `ACTION_DEFINITIONS`, group `"export"`, placed after
  `exportSvg`): labels `Page as PNG...`, `Page as SVG...`, `Page as PDF...`,
  `Selection as PNG...`, `Selection as SVG...`, `Selection as PDF...`; use the
  three-dot ASCII `...` like other labels in the file use (check for an
  existing ellipsis convention first and follow it). Page actions:
  `enabled: pageHasElements`; selection actions: `enabled: hasSelection`
  (existing helpers in `shortcuts.ts`). `run: (c) => c.openExport(scope, format)`.
- Add all six ids to `VIEWER_ACTIONS` (read-only documents may export, like
  `exportSvg`).
- `Toolbar.tsx` `TOOL_MENUS` "export" entry: `exportSvg` first, then the
  three page items, then the three selection items, via the existing
  `actions([...])` helper.
- `ExportDialog`: Solid component; modal semantics like the existing
  dialog in `PrototypePreview.tsx` (`role="dialog"`, `aria-modal`, labelled
  title, Escape closes, focus the Export button on open). Background radio:
  Canvas color (default) / Transparent / Custom + text input (`#rrggbb`).
  Scale `<select>` over `RASTER_SCALES` (default 1), only for PNG, with
  `pngSizeLabel` under it; disable Export when the label is an error or the
  custom color is invalid. While `onExport` runs: Export disabled, status
  "Exporting...". On resolve: if warnings are empty, call `onClose`; else
  show the warnings list and a Close button. On reject: show the error
  message and keep the dialog open. Import `./ExportDialog.css` (pattern:
  `HelpHint.tsx` imports `./HelpHint.css`); keep CSS minimal, using existing
  CSS variables seen in `Toolbar.css`.
- `index.ts`: export `ExportDialog`, `type ExportDialogProps`.

## Pitfalls

- Do not remove or rename `exportSvg` or change its shortcut; the existing
  tests asserting it must keep passing unchanged in meaning.
- `hasSelection` must reflect the live selection; a viewer (read-only)
  editor still enables the actions.
- The dialog must not capture the SVG itself; the shell does that on Export.

## Tests

`shortcuts.test.ts` / `viewer-actions.test.ts` (extend existing helpers;
add `openExport` recording calls to the fake context):
- empty page -> all six disabled; page with one element and no selection ->
  page actions enabled, selection actions disabled; with a selection -> all enabled.
- read-only editor with elements and selection -> all six enabled.
- running `exportSelectionPdf` -> `openExport("selection", "pdf")` called once.
- `exportSvg` behavior unchanged (existing assertions).

`Toolbar.test.ts`: export menu action ids equal
`["exportSvg", "exportPagePng", "exportPageSvg", "exportPagePdf", "exportSelectionPng", "exportSelectionSvg", "exportSelectionPdf"]`.

`export-dialog.test.ts`:
- `resolveBackground({kind:"canvas"})` -> `"#f6f4ee"`; transparent -> null;
  custom `"#ABCDEF"` -> `"#abcdef"`; custom `"blue"` -> Error.
- `pngSizeLabel({width: 100.5, height: 10}, 2)` -> `"201 x 20 px"`;
  `({width: 9000, height: 10}, 1)` -> the 8192 limit message; null -> a
  "Nothing to export" label.
- `exportDialogTitle("selection", "pdf")` -> `"Export selection as PDF"`.

## Verification

```bash
mkdir -p /tmp/nodetto-export/export-07
bun test packages/ui-solid > /tmp/nodetto-export/export-07/tests.log 2>&1   # exit 0
bun run typecheck > /tmp/nodetto-export/export-07/typecheck.log 2>&1   # exit 0 (App.tsx compiles with the stub)
bunx biome check packages/ui-solid/src/shortcuts.ts packages/ui-solid/src/shortcuts.test.ts packages/ui-solid/src/viewer-actions.test.ts packages/ui-solid/src/Toolbar.tsx packages/ui-solid/src/Toolbar.test.ts packages/ui-solid/src/ExportDialog.tsx packages/ui-solid/src/export-dialog.ts packages/ui-solid/src/export-dialog.test.ts packages/ui-solid/src/index.ts apps/desktop/src/App.tsx > /tmp/nodetto-export/export-07/biome.log 2>&1   # exit 0
```

## Done criteria

- Commands exit 0.
- `grep -c "openExport" apps/desktop/src/App.tsx` is 1 (the stub only).
- `grep -n "\"exportSvg\"" packages/ui-solid/src/shortcuts.ts` still shows
  the action and its viewer entry.
