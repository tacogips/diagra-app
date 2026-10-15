# bpmn-11-ui-solid-problems-panel progress

Status: implementation complete; downstream formal review and serial integration remain pending.

## Completion criteria

- `bpmnProblemRows` runs the recommended BPMN lint config only for BPMN pages, preserves finding order, labels findings by element name/id or page name, and marks page-level findings nonselectable.
- `focusBpmnProblem` switches to the offending element's page, selects it and frames it in the supplied viewport. Page-level findings do not change selection.
- `BpmnProblemsPanel` renders only for the active BPMN page, lints on mount and after a 300 ms debounce, shows problem counts, the last rejection and import warnings, and cleans up timers/listeners.
- The public UI Solid barrel exports the component, props, row helper, focus helper and row type.
- Focused tests cover task findings, label fallback, page-level behavior, focus/framing, a clean page and non-BPMN filtering.

## Verification

Evidence root: `tmp/bpmn-operation-flow-s359/bpmn-11-ui-solid-problems-panel/`.

- `bun run typecheck`: final exit 2, log `typecheck-final-r2.log`. The only diagnostics are `packages/core/src/bpmn/notation.ts(122,23)` and `(123,23)`, both TS18048 in sibling-owned bpmn-04 code. The assigned owned-path gate `! grep -E '^packages/ui-solid/src/(BpmnProblemsPanel\.tsx|bpmn-problems\.ts|bpmn-problems\.test\.ts|index\.ts)\(' .../typecheck-final-r2.log` exited 0 (`owned-typecheck-gate.log`). This meets the plan's parallel-wave G1 gate; whole-repo typecheck remains an integration gate.
- `bunx biome check packages/ui-solid/src/BpmnProblemsPanel.tsx packages/ui-solid/src/BpmnProblemsPanel.css packages/ui-solid/src/bpmn-problems.ts packages/ui-solid/src/bpmn-problems.test.ts packages/ui-solid/src/index.ts`: exit 0, five files clean (`biome-final-r2.log`).
- `bun test packages/ui-solid/src/bpmn-problems.test.ts`: exit 0, 5 pass, 0 fail, 16 expects (`focused-tests-final-r2.log`).
- `bun test packages/ui-solid`: exit 0, 294 pass, 0 fail, 1594 expects (`ui-solid-tests-final-r2.log`).
- `grep -n BpmnProblemsPanel packages/ui-solid/src/index.ts`: exit 0; component and props exports at lines 105-107 (`export-check-final.log`); helper and row type exports follow.

Earlier attempts: Biome r2/r3 reported formatting and import-type issues, corrected before final Biome. Typecheck r2 reported only sibling bpmn-09 diagnostics; r3 exited 0; final-r2 reports only the current bpmn-04 notation diagnostics above. Logs are preserved separately and not overwritten.

Formal test-integrity/adversarial review, combined-tree whole-repo gates, commit and push belong to downstream workflow steps and are not claimed complete here.
