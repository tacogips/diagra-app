# Progress: bpmn-05-core-lint

## Inventory (session-359)

- Accepted dependency readiness: `bpmn-01-ir-core-contract` is present in `fanoutItem.acceptedPlanIds`.
- The committed plan and accepted design were read before implementation: `impl-plans/active/bpmn-05-core-lint.md` and `design-docs/specs/design-bpmn.md` sections 7.1-7.3 and 14.
- The preserved implementation was already present in `packages/core/src/bpmn/lint/`: config/parser, model-backed engine, 23 rule implementations, test builder, and focused tests. `packages/core/src/bpmn/index.ts` already exported `./lint/index.ts` once; that shared file was not changed.
- Existing lint coverage had positive and negative tests for every pinned rule, config behavior tests, a draft-fixture-equivalent engine test, and deterministic ordering/severity tests.

## Implementation (session-359)

- Strengthened `config.test.ts` to assert the exact ordered 23 rule ids and recommended severity for every id.
- Updated `rules.ts` so `no-implicit-end` exempts intermediate throw link events as required by design section 7.3. Added a regression assertion for link throw and link catch exemptions.
- No dependency, lockfile, or shared-path changes.

## G1: typecheck / owned diagnostics

- `bun run typecheck > tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/typecheck-final-r3.log 2>&1` exited **2**. The sole diagnostic is `packages/io/src/bpmn/import.ts(10,94): error TS6133: 'XmlNode' is declared but its value is never read.` That file is in `bpmn-06-io-bpmn-xml`'s declared writePaths, not this plan's `packages/core/src/bpmn/lint/` writePath.
- `! grep -E '^packages/core/src/bpmn/lint/' tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/typecheck-final-r3.log && ! grep -E '^error TS' tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/typecheck-final-r3.log` exited **0**: no owned-path diagnostics and no unattributed TS error lines.
- An earlier whole-repo typecheck on the moving tree exited 0 (`typecheck-r2.log`); the later importer diagnostic is retained as current sibling evidence and should route to bpmn-06.

## G2: tests and formatting

- `bunx biome check packages/core/src/bpmn/lint` exited **0**, log `tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/biome-final-r3.log`.
- `bun test packages/core/src/bpmn/lint` exited **0**: 59 pass, 0 fail, 94 expect calls across 3 files; log `tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/focused-tests-final-r3.log`.
- `bun test packages/core` exited **0**: 961 pass, 0 fail, 5052 expect calls across 128 files; log `tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/core-tests-final-r3.log`.
- Contract shell check for all 23 rule strings in `rules.test.ts` and exactly one lint export line in `packages/core/src/bpmn/index.ts` exited **0**.
- During the moving-tree implementation, an initial new regression assertion incorrectly expected a link throw and link catch to be exempt from both implicit-boundary rules. It failed; the assertion was corrected to match the distinct design exemptions, and the final focused suite above passes. An earlier concurrent `packages/core` run also observed a nested lane resize assertion failure in `containment.test.ts`; the final current-tree run above passes without that failure.

## Evidence files

- `tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/typecheck-final-r3.log`
- `tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/biome-final-r3.log`
- `tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/focused-tests-final-r3.log`
- `tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/core-tests-final-r3.log`
- Edit intentions: `edit-012-intent.md` through `edit-015-intent.md` in the same evidence directory.

Implementation criteria for this plan are complete. Integration review, whole-repository gates, and commit/push remain downstream workflow work.
