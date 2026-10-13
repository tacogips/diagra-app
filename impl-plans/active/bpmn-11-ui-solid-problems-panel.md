# bpmn-11-ui-solid-problems-panel

- planId: bpmn-11-ui-solid-problems-panel
- planPath: impl-plans/active/bpmn-11-ui-solid-problems-panel.md
- wave: 3; dependsOn: bpmn-03-core-editing, bpmn-05-core-lint,
  bpmn-06-io-bpmn-xml
- design: design-docs/specs/design-bpmn.md sections 6.3 (rejection
  message in the panel status line), 7.4 (problems panel), 9 (import
  warnings listed in the panel), user-QA Q2 (recommended config only)
- progress log: impl-plans/progress/bpmn-11-ui-solid-problems-panel.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Intent

A BPMN problems panel for the desktop: lint findings of the active `bpmn`
page (recommended config), each row selecting and framing the offending
element; a status line showing the last connection rejection; and an
"Import warnings" list for a freshly imported `.bpmn`.

## Non-goals

- No config file or rule editing in the desktop (Q2 default).
- Mounting in the desktop app is bpmn-15.
- No new notification system.

## writePaths

- packages/ui-solid/src/BpmnProblemsPanel.tsx (new)
- packages/ui-solid/src/BpmnProblemsPanel.css (new)
- packages/ui-solid/src/bpmn-problems.ts (new)
- packages/ui-solid/src/bpmn-problems.test.ts (new)
- packages/ui-solid/src/index.ts
- impl-plans/progress/bpmn-11-ui-solid-problems-panel.md

sharedPaths: none (this plan is the only one editing
`packages/ui-solid/src/index.ts`).

## Contracts (pinned; bpmn-15 relies on them)

```ts
export interface BpmnProblemRow {
  readonly key: string;              // `${ruleId}:${elementId}:${index}`
  readonly severity: "error" | "warning";
  readonly elementId: string;
  readonly label: string;            // element name, else element id; page name for page-level findings
  readonly message: string;
  readonly ruleId: string;
  readonly selectable: boolean;      // false for page-level findings
}
export function bpmnProblemRows(document: Document, pageId: PageId): readonly BpmnProblemRow[];
export function focusBpmnProblem(editor: Editor, row: BpmnProblemRow, viewport: ViewportSize): boolean;
export interface BpmnProblemsPanelProps {
  readonly editor: Editor;
  readonly viewport: () => ViewportSize;
  readonly importWarnings?: readonly BpmnImportWarning[]; // from @diagra/io
}
export function BpmnProblemsPanel(props: BpmnProblemsPanelProps): JSX.Element;
```

Export `BpmnProblemsPanel`, `BpmnProblemsPanelProps`, `bpmnProblemRows`,
`focusBpmnProblem`, `BpmnProblemRow` from `packages/ui-solid/src/index.ts`.

## File-level changes

### bpmn-problems.ts (pure apart from editor calls)

- `bpmnProblemRows`: `lintBpmnPage(document, pageId,
  recommendedLintConfig())` mapped to rows in finding order.
- `focusBpmnProblem`: when `selectable` and the element exists, switch to
  its page if needed (`editor.setCurrentPage`), `editor.selection.set([id])`,
  `editor.zoomToSelection(viewport)`; return true. Page-level rows return
  false and change nothing.

### BpmnProblemsPanel.tsx

- Re-lint on document change debounced 300 ms (`editor.subscribe`, a
  `setTimeout` cleared on each change and on `onCleanup`); also lint once on
  mount.
- Rows: severity, label, message, rule id (plain text, no symbols or
  emojis); clicking a row calls `focusBpmnProblem`.
- Status line: subscribe to `editor.onBpmnRejection`; show the last
  rejection message; clear it on the next document change.
- "Import warnings" heading with one line per warning (`element`, `xmlId`,
  `message`) when `importWarnings` is non-empty.
- Summary line `N problems (E errors, W warnings)` or "No problems".
- Styles in `BpmnProblemsPanel.css`, imported by the component (imitate
  `Toolbar.css` import in Toolbar.tsx).

## Pitfalls

- Lint only when the current page kind is `bpmn`; otherwise render nothing.
- Unsubscribe both listeners and clear the timer on cleanup (Solid
  `onCleanup`).
- Use `editor.store.getSnapshot()` as the lint input; do not mutate it.

## Tests (input -> expected) in `bpmn-problems.test.ts`

- Editor with a bpmn page containing an unnamed user task with no outgoing
  flow -> rows include `label-required` and `no-implicit-end` with
  `elementId` = task id, `label` = task id
- `focusBpmnProblem` on that row -> selection is `[taskId]`, returns true
- page-level `start-event-required` row (pool-less page with a task only)
  -> `selectable: false`; `focusBpmnProblem` returns false and selection
  unchanged
- clean page -> empty rows

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck                                       # exit 0
bunx biome check packages/ui-solid/src/BpmnProblemsPanel.tsx packages/ui-solid/src/BpmnProblemsPanel.css packages/ui-solid/src/bpmn-problems.ts packages/ui-solid/src/bpmn-problems.test.ts packages/ui-solid/src/index.ts   # exit 0
bun test packages/ui-solid                              # exit 0
```

## Done criteria

- `grep -n "BpmnProblemsPanel" packages/ui-solid/src/index.ts` shows the
  export.
- Tests pass; exit codes in the progress log.
