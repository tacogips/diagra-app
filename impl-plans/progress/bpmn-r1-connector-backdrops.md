# BPMN R1 connector backdrops progress

## Start (UTC)

2026-10-13 UTC; exact start time was not captured. Final verification: 2026-10-13 17:22 UTC.

## Files (SHA-256)

| Path | Pre-edit | Post-edit / final |
| --- | --- | --- |
| `packages/core/src/backdrops.ts` | `2a53c8b806b27bb68487d6721b17a84357d6a1dd7b891e59dc8cc394b5b5be02` | `3c78d46bed1e3df7c5c5c7370c657547b2aa6f3ad6c964c6c43e24e98cc8db7e` |
| `packages/core/src/backdrops.test.ts` | absent | `9efbddc49855b0913823bdf6ca8ce016c808154facff794f9e53de3b0df7edf8` |
| `packages/core/src/bpmn/svg-export-layers.test.ts` | absent | `c796dec9360c7269ac27d00c0764ae0d00e44103ad0d6eb607983751b19ccb16` |
| `packages/core/src/shapes/connector.test.ts` | `a779de2fe290ee02d61b6f5f609963ce871240b85df57812e519cc40ffe8847a`; first test hunk `3d0b4d0729bef29db8ed55818e89341bccf0e6d353501cafae2d874f2005ec97`; BPMN document correction `e7d6629a30c90da0c5b565dacc69272b1386ba33fed134e102c5d2069c48bbda` | `e7d6629a30c90da0c5b565dacc69272b1386ba33fed134e102c5d2069c48bbda` |
| `packages/ui-solid/src/bpmn-backdrop.test.ts` | absent | `ef75fcb3d0c856323430c511d98aed5553366c6742cc600229d12d137006cb83` |
| `impl-plans/progress/bpmn-r1-connector-backdrops.md` | absent | recorded in `tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/final-hashes.txt` after writing |

Per-edit intent snapshots are in `tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/edit-01-intent.txt` through `edit-09-intent.txt`, including the failed contextual patch retry and the correction to construct routing fixtures on a BPMN page.

## Commands

All verification ran in the foreground from the repository root. Final-source log paths are under `tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/`.

| Command | Exit | Result | Log |
| --- | ---: | --- | --- |
| `bun test packages/core/src/backdrops.test.ts packages/core/src/bpmn/svg-export-layers.test.ts packages/core/src/shapes/connector.test.ts packages/ui-solid/src/bpmn-backdrop.test.ts` | 0 | 31 passed, 0 failed, 153 assertions | `focused-final.log` |
| `bun test packages/core/src/svg-export.test.ts packages/core/src/bpmn/fixtures.test.ts packages/core/src/bpmn/routes.test.ts` | 0 | 59 passed, 0 failed, 218 assertions | `existing-final.log` |
| `bunx biome check packages/core/src/backdrops.ts packages/core/src/backdrops.test.ts packages/core/src/bpmn/svg-export-layers.test.ts packages/core/src/shapes/connector.test.ts packages/ui-solid/src/bpmn-backdrop.test.ts` | 0 | 5 files checked, no fixes | `biome-final.log` |
| `bun run typecheck` | 0 | `tsc --noEmit` clean | `typecheck-final.log` |
| Owner-scoped typecheck grep (`! grep -E '^(packages/core/src/(backdrops|backdrops\.test|bpmn/svg-export-layers\.test|shapes/connector\.test)\.ts|packages/ui-solid/src/bpmn-backdrop\.test\.ts)\(' ... && ! grep -E '^error TS' ...`) | 0 | No owned diagnostics or TS errors | `typecheck-final.log` |
| `bun test packages/core packages/ui-solid` | 0 | 1,302 passed, 0 failed, 7,034 assertions across 173 files | `packages-final.log` |
| `bun test apps/cli/src/bpmn-commands.test.ts` | 0 | 7 passed, 0 failed, 49 assertions | `cli-bpmn-final.log` |
| `grep -n '"bpmn.participant"\|"bpmn.lane"\|"bpmn.group"\|"bpmn.subProcess"' packages/core/src/backdrops.ts` | 0 | All four named types appear | console output of final audit |
| `test -z "$(git diff --name-only -- packages/ui-solid/src/Canvas.tsx packages/core/src/shapes/connector.ts)"` | 0 | Neither shared consumer was edited by this plan | console output of final audit |

## Pre-change proof

- Initial attempt `bun test packages/core/src/shapes/connector.test.ts` exited 1 with 20 passed / 4 failed. Two failures were intended positive routing failures; two BPMN container constructions were rejected because the helper used the default freeform page. Full output: `connector-prechange.log`. This was setup evidence only and is not the canonical proof.
- After adapting fixtures to `new Editor({document: document(..., [{...TEST_PAGE, kind: "bpmn"}])})`, the same command exited 1 with 21 passed / 3 failed. The pool/lane, expanded sub-process and BPMN group route tests failed on the original predicate; the collapsed sub-process control passed. Full output: `connector-prechange-rerun.log`.
- The four routing tests pass in the final focused run.

## Sibling diagnostics (non-blocking)

No TypeScript diagnostics or package test failures were observed in the final shared-tree checks. The parallel `bpmn-r2-task-icons-labels` work is visible in `packages/core/src/bpmn/notation.ts`, `packages/core/src/bpmn/notation.test.ts`, `packages/core/src/bpmn/svg-export-bpmn.test.ts`, `packages/core/src/svg-export.ts`, and `impl-plans/progress/bpmn-r2-task-icons-labels.md`. Those are outside this plan's writePaths; the SVG exporter edit is sibling-owned. No changes were made to `Canvas.tsx` or `shapes/connector.ts`.

## Sibling test failures (non-blocking)

None observed in the required final verification commands.

## Drift

The shared tree gained sibling-owned SVG export and notation files while this plan was being implemented. The owned files were re-read and final verification was rerun after observing the shared tree. No owned source hash changed during final verification.

## Open issues

None for the assigned plan. Whole-repository `bun test` and `bunx biome check .` are reconciliation gates owned by the orchestrator. Formal review, documentation/index reconciliation, exact staging, commit and push remain downstream workflow steps.

## Done checklist

- [x] Predicate recognizes only ungrouped frame, participant (collapsed or expanded), lane, expanded sub-process and BPMN group.
- [x] `backdrops.test.ts` and SVG paint-layer tests cover predicates, no-connector gating, collapsed message-flow pool, and the 12-flow purchase-request fixture.
- [x] Four routing regressions pass; the three positive cases were shown failing before the predicate change and the collapsed control passed.
- [x] Existing frame, ERD/BPMN SVG and route tests pass unchanged.
- [x] Focused tests, owner-scoped typecheck, changed-file Biome, core/ui-solid suites, and CLI BPMN suite pass.
- [x] Only this plan's files were edited by this plan; `svg-export.ts` is a visible sibling-owned change. No edits to `Canvas.tsx` or `shapes/connector.ts`.
- [x] Progress and verification evidence recorded under this plan's evidence root.

## Final-source rerun after comment wrapping

The shared predicate's final comment-only edit was followed by a complete rerun. These logs are the final-source evidence and supersede the earlier `*-final.log` entries above:

| Command | Exit | Result | Log |
| --- | ---: | --- | --- |
| `bun test packages/core/src/backdrops.test.ts packages/core/src/bpmn/svg-export-layers.test.ts packages/core/src/shapes/connector.test.ts packages/ui-solid/src/bpmn-backdrop.test.ts` | 0 | 31 passed, 0 failed, 153 assertions | `focused-final-source.log` |
| `bun test packages/core/src/svg-export.test.ts packages/core/src/bpmn/fixtures.test.ts packages/core/src/bpmn/routes.test.ts` | 0 | 59 passed, 0 failed, 218 assertions | `existing-final-source.log` |
| `bunx biome check packages/core/src/backdrops.ts packages/core/src/backdrops.test.ts packages/core/src/bpmn/svg-export-layers.test.ts packages/core/src/shapes/connector.test.ts packages/ui-solid/src/bpmn-backdrop.test.ts` | 0 | 5 files checked, no fixes | `biome-final-source.log` |
| `bun run typecheck` | 0 | `tsc --noEmit` clean | `typecheck-final-source.log` |
| Owner-scoped typecheck grep described above | 0 | no owned diagnostics or TS errors | `typecheck-final-source.log` |
| `bun test packages/core packages/ui-solid` | 0 | 1,302 passed, 0 failed, 7,034 assertions across 173 files | `packages-final-source.log` |
| `bun test apps/cli/src/bpmn-commands.test.ts` | 0 | 7 passed, 0 failed, 49 assertions | `cli-bpmn-final-source.log` |

## Attempt 3 final-source verification

This rerun repairs the verification report format flagged by `IR-R1-REPORT-01`; implementation and test sources were not edited. Before the rerun, SHA-256 values for all five owned source/test files matched the values recorded in the file table above: `backdrops.ts` `3c78d46bed1e3df7c5c5c7370c657547b2aa6f3ad6c964c6c43e24e98cc8db7e`, `backdrops.test.ts` `9efbddc49855b0913823bdf6ca8ce016c808154facff794f9e53de3b0df7edf8`, `svg-export-layers.test.ts` `c796dec9360c7269ac27d00c0764ae0d00e44103ad0d6eb607983751b19ccb16`, `connector.test.ts` `e7d6629a30c90da0c5b565dacc69272b1386ba33fed134e102c5d2069c48bbda`, and `bpmn-backdrop.test.ts` `ef75fcb3d0c856323430c511d98aed5553366c6742cc600229d12d137006cb83`. Before this append, the progress log hash was `ad95d042b879dd5512a12695d09af982cef687174b75679e6df76d80acb49483`, matching `final-hashes-2.txt`.

| Final-source command | Exit | Result | Log |
| --- | ---: | --- | --- |
| `bun test packages/core/src/backdrops.test.ts packages/core/src/bpmn/svg-export-layers.test.ts packages/core/src/shapes/connector.test.ts packages/ui-solid/src/bpmn-backdrop.test.ts` | 0 | 31 passed, 0 failed, 153 assertions | `focused-attempt3.log` |
| `bun test packages/core/src/svg-export.test.ts packages/core/src/bpmn/fixtures.test.ts packages/core/src/bpmn/routes.test.ts` | 0 | 59 passed, 0 failed, 218 assertions | `existing-attempt3.log` |
| `bun test packages/core packages/ui-solid` | 0 | 1,302 passed, 0 failed, 7,034 assertions across 173 files | `packages-attempt3.log` |
| `bun test apps/cli/src/bpmn-commands.test.ts` | 0 | 7 passed, 0 failed, 49 assertions | `cli-bpmn-attempt3.log` |
| `bunx biome check packages/core/src/backdrops.ts packages/core/src/backdrops.test.ts packages/core/src/bpmn/svg-export-layers.test.ts packages/core/src/shapes/connector.test.ts packages/ui-solid/src/bpmn-backdrop.test.ts` | 0 | 5 files checked, no fixes applied | `biome-attempt3.log` |
| `bun run typecheck` | 0 | `tsc --noEmit` passed | `typecheck-attempt3.log` |
| `! grep -E '^(packages/core/src/(backdrops|backdrops\.test|bpmn/svg-export-layers\.test|shapes/connector\.test)\.ts|packages/ui-solid/src/bpmn-backdrop\.test\.ts)\(' tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/typecheck-attempt3.log && ! grep -E '^error TS' tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/typecheck-attempt3.log` | 0 | No owned-file diagnostics and no TypeScript errors | `typecheck-attempt3.log` |

The existing `Pre-change proof` section is unchanged. Its two expected regression failures remain historical pre-change evidence only: `connector-prechange.log` (exit 1, 20 passed / 4 failed) and `connector-prechange-rerun.log` (exit 1, 21 passed / 3 failed). They are not final-source verification commands.
