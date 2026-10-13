# bpmn-10-ui-solid-inspector progress

Plan: `impl-plans/active/bpmn-10-ui-solid-inspector.md`  
Mode: issue-resolution  
Issue reference: No GitHub issue. Workflow input: “Continue (2): BPMN 2.0 operation flow (business process) diagrams in diagra”; session-359.  
Dependency: `bpmn-03-core-editing` is accepted in the runtime-owned `acceptedPlanIds`.

## Implementation

- Added `packages/ui-solid/src/inspector/BpmnSection.tsx`, mounted once from `Inspector.tsx` for `bpmn.*` element types.
- Semantic controls cover names/text, task type and loop, sub-process/call activity options, event position and definition kinds, boundary event options, gateways, data objects, sequence flow options, association direction, and collapsed pools.
- All commits use `Editor.updateBpmnSemantic` with the selected element's existing id. Catch/throw and user/service switches therefore update semantics without replacing the element or its connections. Start/end position options are disabled when existing incoming/outgoing sequence flows make the transition illegal; core intent validation remains authoritative.
- Added pure edit helpers and focused tests for optional-field deletion, stable/new event-definition ids and timer defaults, disabled positions, and accepted/rejected same-id updates retaining flows.
- Required boolean fields preserve explicit `false`; optional boolean fields drop the key when cleared.

## Acceptance criteria

1. BPMN semantic edits, including task and catch/throw switching, use `updateBpmnSemantic` on the same id and keep connections: met.
2. Rule-violating position choices are disabled; BpmnSection has no generic `updateSemantic` path; other inspector branches are unchanged: met.
3. G1/G2 evidence is recorded under `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/`: met.

## Verification

- G1 `bun run typecheck`: exit 2. The final-source log has no diagnostics in this plan's owned paths. The only diagnostic is sibling-owned `packages/ui-solid/src/Toolbar.tsx(29,10)` TS6133 (`BPMN_TOOLS` declared but unused), outside this plan's `writePaths`; under design 11.1 rule 3 it is non-blocking for this plan. Log: `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/typecheck-final-r4.log`.
- G2 focused `bun test packages/ui-solid/src/inspector/bpmn-edits.test.ts`: exit 0, 5 pass, 0 fail, 17 expects. Log: `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/focused-tests-final-r4.log`.
- G2 package `bun test packages/ui-solid`: exit 0, 286 pass, 0 fail, 1493 expects across 37 files on the moving shared tree. Log: `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/ui-solid-tests-final-r4.log`.
- Selected-file `bunx biome check packages/ui-solid/src/inspector/BpmnSection.tsx packages/ui-solid/src/inspector/bpmn-edits.ts packages/ui-solid/src/inspector/bpmn-edits.test.ts packages/ui-solid/src/Inspector.tsx`: exit 0, 4 files checked. Log: `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/biome-final-r4.log`.
- Static contract: `BpmnSection.tsx` contains `updateBpmnSemantic` and no `updateSemantic"` call.

Earlier final-source attempt `typecheck-final.log` did not capture an exit code because zsh reserves the variable name `status`; the controlled reruns are preserved under `*-r2/r3/r4.log`. The first captured typecheck showed one owned Set inference error plus the same sibling Toolbar diagnostic. The owned error was fixed with a typed empty set, and the final G1 rerun shows only the sibling diagnostic. No formal test-integrity/adversarial review or serial integration acceptance is claimed here.

## Adversarial repair: BPMN10-ADV-01

The adversarial review found that the non-keyed Inspector branch can keep `BpmnSection` mounted across selection changes between BPMN element types. Replaced the component-body type snapshot with `type()` and updated each type-dependent JSX branch to read it reactively. Event position disabling is now an accessor that rebuilds the model from the current store snapshot and current selected element. `selectField` accepts a disabled-values accessor, reads it in both the option binding and change handler, and the Position control passes the accessor itself. All writes still use `Editor.updateBpmnSemantic`; no core, IR, Inspector, or sibling files changed for this repair.

Final-source verification after this repair:

- `bun run typecheck`: exit 0; log `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/typecheck-adv01-r1.log`.
- `bunx biome check packages/ui-solid/src/inspector/BpmnSection.tsx packages/ui-solid/src/inspector/bpmn-edits.ts packages/ui-solid/src/inspector/bpmn-edits.test.ts packages/ui-solid/src/Inspector.tsx`: exit 0; four files checked; log `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/biome-adv01-r1.log`.
- `bun test packages/ui-solid/src/inspector/bpmn-edits.test.ts`: exit 0, 5 pass, 0 fail, 17 expects; log `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/focused-tests-adv01-r1.log`.
- `bun test packages/ui-solid`: exit 0, 294 pass, 0 fail, 1595 expects across 38 files; log `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/ui-solid-tests-adv01-r1.log`.
- Static BPMN10-ADV-01 gates (no constant type or disabled-position snapshot; `updateBpmnSemantic` present; generic `updateSemantic` absent): exit 0; log `tmp/bpmn-operation-flow-s359/bpmn-10-ui-solid-inspector/static-adv01-r1.log`.

The earlier `typecheck-final-r4.log` exit 2 was sibling-only (`Toolbar.tsx` TS6133); the final-source typecheck above now exits 0. Independent adversarial re-review and serial integration gates remain downstream; this implementation record does not claim their acceptance.
