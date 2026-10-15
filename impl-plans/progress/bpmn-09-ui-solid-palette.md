# bpmn-09-ui-solid-palette progress

Plan: `impl-plans/active/bpmn-09-ui-solid-palette.md`
Branch: `feat/bpmn-operation-flow`
Checkpoint: `b25a9fcf6a222721712cf346478562d3c3971aa8`
Dependency: `bpmn-03-core-editing` is present in runtime `acceptedPlanIds`.

## Implementation

- `packages/ui-solid/src/tools.ts` adds the ordered `BPMN_TOOLS` registry and
  complete creation descriptors for all 20 tools. Existing tools remain in
  their original order. The timer palette default uses `PT1H`: the plan lists
  an empty value, but `validateDocument` rejects an empty timer value with
  `value.empty`; the valid initial duration satisfies the plan's required
  zero-error placement behavior.
- `packages/ui-solid/src/Toolbar.tsx` exports a separate `BPMN_TOOL_MENU` and
  renders it only when the current page kind is `bpmn`. The toolbar reads page
  changes through `signals.rev()`. `TOOL_MENUS` and `ACTION_MENUS` definitions
  are unchanged.
- `packages/ui-solid/src/interaction.ts` routes lane placement through
  `editor.addBpmnLane`, selects the new lane, leaves empty-canvas lane clicks
  empty, replaces event-definition placeholder ids per placed element, and
  routes BPMN connector reconnects through `editor.reconnectBpmnFlow`.
  Generic connector reconnects retain the previous `updateSemantic` path.
- `packages/ui-solid/src/PageTabs.tsx` adds the read-only-aware "Add BPMN page"
  button, creating and focusing a page named "Process".
- `packages/ui-solid/src/bpmn-palette.test.ts` owns exact palette payload,
  placement and validation assertions; lane membership and empty-canvas
  behavior; unique definition ids; BPMN reconnect conversion; rejected end
  event connection; unchanged generic reconnect behavior; legacy menu ids;
  and BPMN page creation.

## Verification

All commands ran in the foreground from the repository root. Logs include the
exact final command exit status.

### G1: typecheck

- Command: `bun run typecheck`
- Exit: 0. Complete log:
  `tmp/bpmn-operation-flow-s359/bpmn-09-ui-solid-palette/typecheck-final-r4.log`.
  The final log contains no diagnostics, including none in this plan's owned
  paths.

### G2: tests

- `bun test packages/ui-solid/src/bpmn-palette.test.ts`: exit 0, 8 passed,
  0 failed, 101 expects. Log:
  `tmp/bpmn-operation-flow-s359/bpmn-09-ui-solid-palette/focused-tests-final-r4.log`.
- `bun test packages/ui-solid`: exit 0, 294 passed, 0 failed, 1,595 expects
  across 38 files. This includes unchanged `Toolbar.test.ts` and
  `interaction.test.ts`. Log:
  `tmp/bpmn-operation-flow-s359/bpmn-09-ui-solid-palette/package-tests-final-r3.log`.
- `bunx biome check packages/ui-solid/src/tools.ts packages/ui-solid/src/Toolbar.tsx packages/ui-solid/src/interaction.ts packages/ui-solid/src/PageTabs.tsx packages/ui-solid/src/bpmn-palette.test.ts`:
  exit 0, five files checked. Log:
  `tmp/bpmn-operation-flow-s359/bpmn-09-ui-solid-palette/biome-final-r4.log`.
- `test -z "$(git diff -- packages/ui-solid/src/Toolbar.test.ts packages/ui-solid/src/interaction.test.ts)"`:
  exit 0; both protected tests are unchanged.
- `grep -n -E 'reconnectBpmnFlow|addBpmnLane' packages/ui-solid/src/interaction.ts`:
  exit 0; calls are at lines 1756 and 1233 respectively.
- `grep -n validateDocument packages/ui-solid/src/bpmn-palette.test.ts`:
  exit 0; the all-tools placement test validates the resulting document.

### Prior attempts and resolution

- `focused-tests-attempt2.log`: exit 1, 7 passed and 1 failed because the
  empty timer default produced `value.empty`. Resolved by changing the
  palette default to `PT1H`; focused final r4 passes.
- `typecheck-final.log`: exit 2 with an owned unused-import diagnostic and
  the readonly-array comparison type error. Resolved by removing the unused
  import and comparing against a mutable copy. `typecheck-final-r2.log`
  passed before the final test-only changes. `typecheck-final-r3.log` then
  showed two temporary sibling bpmn-04 notation diagnostics, which no longer
  reproduce: final `typecheck-final-r4.log` exits 0.
- `biome-final.log` and `biome-format-attempt1.log`: exit 1 on formatting and
  an assignment-expression lint finding in the new test helper. Formatted
  only assigned files and changed the helper to a block body. Final selected
  Biome check exits 0.
- `focused-tests-attempt1.log` was produced before a zsh `status` variable
  assignment failed (zsh reserves that variable). The reproducible test run
  and exit were captured by attempt2 and later final logs.

## Completion criteria

- [x] Separate descriptive BPMN menu with ordered complete tool payloads;
  legacy `TOOL_MENUS` and `ACTION_MENUS` remain unchanged.
- [x] Every non-lane palette tool places exactly one BPMN element with no
  error-severity document validation issues.
- [x] Lane placement delegates to `addBpmnLane`; BPMN reconnect delegates to
  `reconnectBpmnFlow`; generic reconnect behavior remains unchanged.
- [x] PageTabs exposes a read-only-aware Add BPMN page action.
- [x] Focused and package tests pass; selected-file Biome passes.
- [x] Whole-repo typecheck exits 0 with zero diagnostics.

Independent test-integrity and adversarial review, combined-tree integration,
serial commit and push remain downstream workflow steps.
