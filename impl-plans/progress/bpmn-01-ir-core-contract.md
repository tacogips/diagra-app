# bpmn-01-ir-core-contract progress

## Start

- Started: 2026-10-13 07:37:03 UTC
- Branch: `feat/bpmn-operation-flow`
- Checkpoint: `86f955fff76569c4cced5a2e103ba796960b7f26`
- Review feedback: none (`reviewFeedback.findings=[]`; inbox `findings`, `feedback`, and `repairRequests` are null).
- Plan: `impl-plans/active/bpmn-01-ir-core-contract.md`; design sections 3.1-3.5, 4.1/4.4, 5.2, 11.

## Files

Pre-edit hashes and per-edit intentions are retained in `tmp/bpmn-operation-flow-s356/bpmn-01-ir-core-contract/edit-intents.md`; initial owned-file snapshot hashes are in `pre-format-hashes.txt` and `pre-format2-hashes.txt`. Final SHA-256 hashes:

| Path | Final SHA-256 |
|---|---|
| packages/ir/src/types.ts | 43b02fab0f0ef714df5ca91840670359f392650a2783f72492fb80105e56b431 |
| packages/ir/src/semantics.ts | f81d60fe0c072349bcd89730863c775b3f909219895d1ce16c2980a304c1a2c5 |
| packages/ir/src/registry.ts | 0ad2fb996965007d5d605b790fd4a3f88efa1218c47066f9b6e5824b1d18f0d2 |
| packages/ir/src/validate.ts | 46c8d5df657372a54b7e7c773673cf205a52a3c0ee82d95a73d8c2d69229f46f |
| packages/ir/src/keyOrder.ts | d1b889089b532aad3a8b26927f6604feba7e09fc43c5f55d305c2060bd81c15a |
| packages/ir/src/connector-waypoints.ts | 983538993d11462b2b6d86fbadb197a703138ca96aa595ad89342f9f9e738083 |
| packages/ir/src/index.ts | 75d3c5631d409acbdc724863d08b064fc75b139562c5f63611535c40c22aebe8 |
| packages/ir/src/bpmn.test.ts | 21ba9a5c556e7948827b9efce10582f6a3f6b9b752c59dc9e7fce569ddb78f94 |
| packages/core/src/bpmn/model.ts | 2968c4696ecf6e1c90dbb3f73bda432e472c2b8b5d2d1edf831462255704a740 |
| packages/core/src/bpmn/model.test.ts | ff62a5daaf6e76a31398682f326c8e0dd53be6b86b148eaba86cf63357ba99fe |
| packages/core/src/bpmn/index.ts | e58c3337317b68e3daff04f37b0a1232a018af4344a28d5625cd54bddf48f37c |
| packages/core/src/index.ts | 6ea9872c457cb8a8203c73d30e17af9eaf43f8b7f434d5bbe42f36365df434ab |
| packages/core/src/shapes/bpmn.ts | b059d82bfa151b249b3bd3315c3668f2b90e1388652f6a05921e534c4e5f59a9 |
| packages/core/src/shapes/bpmn.test.ts | 09cf3fe503e4806ffc66059b6e87f90b03c00834b8816157647c3843428d77e0 |
| packages/core/src/shapes/index.ts | 9c8776699527c70f7a6532d3d5ecb2792ae2a590d4a21cfbd960d399ba8c1716 |
| packages/core/src/shapes/outline.ts | 7a3e6284ee887a92e77658e9363ff505e1a54dc7684e45a867d53f3da039e5d2 |
| packages/core/src/shapes/connector.ts | 469ef5089721c2aec4ad8e0f433846929f7909a95af798de76cbeee2dc25530d |
| packages/io/src/jsonl/bpmn-compat.test.ts | 68c3d0fc896e12c29ad1ace417a43a93ad6909d54b17005f47c4b283302c923b |

`packages/ir/src/migrations.ts` is unchanged. BPMN registry literals count 16. `packages/core/src/bpmn/index.ts` has one export line.

## Commands

All final-source logs are complete under `tmp/bpmn-operation-flow-s356/bpmn-01-ir-core-contract/`.

| Command | Exit | Result |
|---|---:|---|
| `bun run typecheck` | 0 | TypeScript check passed (`typecheck-final-source.log`). |
| `bunx biome check packages/ir/src packages/core/src/bpmn packages/core/src/shapes packages/core/src/index.ts packages/io/src/jsonl` | 0 | 52 files checked, no fixes (`biome-final-source.log`). |
| `bun test packages/ir/src/bpmn.test.ts packages/core/src/bpmn packages/core/src/shapes/bpmn.test.ts packages/io/src/jsonl/bpmn-compat.test.ts` | 0 | 11 passed, 0 failed, 81 assertions (`focused-owned-source-final.log`). |
| `bun test packages/ir packages/core/src/bpmn packages/core/src/shapes packages/io` | 1 | 273 passed, 2 failed, 2061 assertions; failures in unchanged `packages/ir/src/registry.test.ts` (hard-coded pre-BPMN registry contents) and `packages/io/src/jsonl/golden.test.ts` (BPMN types absent from its top-level golden fixture set) (`affected-final-source.log`). |
| `bun test` | 1 | 1655 passed, 2 failed, 10132 assertions; same two failures (`whole-final-source.log`). |
| Structural completion checks | 0 | `bpmn` page kind, 16 registry types, `labelBounds`, waypoint export/move, one-line core barrel, unchanged migrations (`structural-final-source.log`). |
| `bunx biome check --write ...` (explicit owned source/test files) | 0 | Formatting applied only to owned files; logs `biome-format.log`, `biome-format2.log`, `biome-format-final.log`. |

An earlier focused run identified and corrected two local test issues (missing-field code and approximate ellipse chord distance); that complete log is `focused-owned-final1.log`. Earlier typecheck and compatibility attempts are also retained as `typecheck-initial.log`, `typecheck-pass2.log`, and `affected-tests-final.log`.

## Drift

The sibling `bpmn-02-fixtures` worker added four BPMN XML fixtures under `packages/io/src/__fixtures__/bpmn/` and its own progress file during this run. Those paths are outside this plan's `writePaths`; they were not modified. No edits to owned source files were detected from other workers.

## Open issues

- Historical note: the two test gates were blocked in session-356. Session-357 amended this plan's `writePaths` to include both pinned-list tests and the canonical BPMN fixture; the Resume evidence below records their passing reruns.
- No GitHub issue exists. Intake reference is workflow issue `BPMN 2.0 operation flow (business process) diagrams in nodetto`, communications `comm-006074..comm-006083`, execution `opus-luna-design-and-implement-review-loop-session-356`.

## Done checklist

- [x] Add final `bpmn` page kind, typed semantic payloads, and 16 structural registry definitions.
- [x] Add `Visual.labelBounds`, canonical JSONL key ordering/rounding, and reference-type warnings without BPMN legality errors.
- [x] Move waypoint conversion functions into `@nodetto/ir`; core locally imports and re-exports them.
- [x] Add the read-only BPMN model, one-line barrel, 12 node/container/annotation ShapeUtils, 4 connector utils, and BPMN outlines.
- [x] Add focused IR/model/shape/JSONL tests; owned focused tests pass.
- [x] Keep migrations unchanged and progress hashes/test counts recorded.
- [x] Run all four plan-required verification commands with exit 0; the list-pinning updates and fixture coverage pass.

## Resume (2026-10-13; session-357)

- Continued the existing implementation without rewriting prior work. Added all 16 BPMN types to `packages/ir/src/registry.test.ts`, added `bpmn` last in `packages/io/src/jsonl/golden.test.ts`, and created the canonical `packages/io/src/__fixtures__/bpmn.jsonl` golden page covering all 16 types.
- Ownership drift from the earlier session is resolved. `packages/ir/src/migrations.ts` remains unchanged (SHA-256 `c1a7dd2bfe02c669bb8c4e24fc93325769fc2422ec563add74128d43c0835520`). Final SHA-256 values for all 21 plan-owned source/test/fixture files are recorded in `tmp/bpmn-operation-flow-s357/bpmn-01-ir-core-contract/final-source-hashes.txt`.
- Verification ran on the final source. Every command exited 0; complete logs are under `tmp/bpmn-operation-flow-s357/bpmn-01-ir-core-contract/`:
  - `bun run typecheck`: exit 0 (`typecheck.log`).
  - `bunx biome check packages/ir/src packages/core/src/bpmn packages/core/src/shapes packages/core/src/index.ts packages/io/src/jsonl`: exit 0, 52 files checked (`biome.log`).
  - `bun test packages/ir/src/bpmn.test.ts packages/ir/src/registry.test.ts packages/core/src/bpmn/model.test.ts packages/core/src/shapes/bpmn.test.ts packages/io/src/jsonl/bpmn-compat.test.ts packages/io/src/jsonl/golden.test.ts`: exit 0, 94 passed, 0 failed, 323 assertions (`focused-tests.log`).
  - `bun test packages/ir packages/core/src/bpmn packages/core/src/shapes packages/io`: exit 0, 284 passed, 0 failed, 2131 assertions (`affected-tests.log`).
  - `bun test`: exit 0, 1666 passed, 0 failed, 10208 assertions (`whole-tests.log`).
  - List-pinning regression tests: exit 0, 83 passed, 0 failed (`list-pinning-tests.log`).
  - Structural assertions: exit 0 (`structural-checks.log`).
- Final source hashes and the exact pre-edit hashes/intended hunks are retained in `final-source-hashes.txt`, `pre-edit-hashes.txt`, and `edit-intents.md` in the same evidence directory.

## Recovery Resume (2026-10-13; session-357 implementation redispatch)

- Re-read the assigned plan and design, then compared all 22 plan-owned paths against the immutable `before:step6-implement` snapshot supplied at `tmp/riela-fanout/BC3FD9FB-E50E-492A-9473-18DFAAB36B9A/FE72A271-8D66-4B3A-B187-78ECFA74BA62.json`. Every SHA-256 matched exactly; no source or fixture reimplementation was needed. The six bpmn-02 paths also match the after-test-integrity snapshot at `tmp/riela-fanout/B8DB4BA0-8E66-43A0-8F3E-38685A316ED6/73A5A08E-2814-4C84-81F8-DF739B8DD2EA.json`; this plan did not edit them.
- Current-source verification was rerun with complete logs under `tmp/bpmn-operation-flow-s357/bpmn-01-ir-core-contract/`: focused six-file `bun test` exit 0, 94 passed / 0 failed (`focused-tests-rerun.log`); `bun run typecheck` exit 0 (`typecheck-rerun.log`); `bunx biome check .` exit 0, 470 files checked (`biome-rerun.log`); affected package `bun test` exit 0, 284 passed / 0 failed (`affected-tests-rerun.log`); whole-repo `bun test` exit 0, 1666 passed / 0 failed (`whole-tests-rerun.log`).
- Structural assertions exit 0 (`structural-checks-rerun.log`): 16 registry definitions, waypoint functions moved and exported, exactly one `bpmn` golden fixture page, `bpmn` in GOLDEN, exactly one core BPMN barrel export, ASCII fixture, and unchanged `migrations.ts`/`bun.lock`. The migration/lock-specific command exited 0 (`migration-lock-check-rerun.log`). The first structural wrapper had a shell quoting error (exit 2); it did not indicate a source failure and is preserved in `rerun-exit-status.tsv`; a corrected wrapper reran every assertion and exited 0.
- Current source hashes for all 21 plan-owned code/test/fixture files are in `final-source-hashes-rerun.txt`. All seven verification command exits are recorded in `rerun-exit-status.tsv`; command logs are complete.
- The earlier missing independent typed test-integrity, adversarial-review, and branch-evidence decisions were not authored by this implementation node. They remain pending the workflow's designated review steps; no review approval is claimed here.

## Adversarial Repair Resume (2026-10-13; comm-006117)

- Addressed `BPMN01-VALIDATE-QUADRATIC` in `packages/ir/src/validate.ts`: `elementById` is built during the existing first element pass, stores the first element for each string id, and BPMN reference target lookup now uses the map only inside the `bpmn.*` branch. Removed the per-reference `elements.find`; dangling warnings, duplicate-id reporting, warning codes, paths, messages, severities, and iteration order remain unchanged. Added a regression case in `packages/ir/src/bpmn.test.ts` where the child precedes the invalid parent and still receives `bpmn.parentType`.
- Addressed `BPMN01-SCOPES-COLLAPSED-SUBPROCESS` in `packages/core/src/bpmn/model.ts`: `scopes()` now includes every `bpmn.subProcess`, independent of `expanded`; the collapsed-participant filter is unchanged. Added `packages/core/src/bpmn/model.test.ts` coverage proving collapsed subprocess scope resolution/inclusion and continued exclusion of a collapsed participant. Existing model assertions remain intact.
- Final hashes for all 21 code/test/fixture paths are recorded in `tmp/bpmn-operation-flow-s357/bpmn-01-ir-core-contract/adversarial-repair-comm-006117/final-source-hashes.txt`. Updated hashes: `validate.ts` `bd0232f7d848729d78ba3cfa24693c0ab1b662d0c6b9203933b6f7033b297efd`; `bpmn.test.ts` `b99304b628340f4c477a2818fe650b6edde896e88369f7975ead86fa625bdae6`; `model.ts` `0cd860eeb75329376d68320c71bcecef12086f0c127b72fb192f861cda92ee65`; `model.test.ts` `0d202a398e2ea428df1ef814da702f53e507b69564c5878be63f57afbec962a6`.
- Final-source commands all exited 0; complete logs and `final-exit-status.tsv` are under `tmp/bpmn-operation-flow-s357/bpmn-01-ir-core-contract/adversarial-repair-comm-006117/`: `bun run typecheck` (`final-typecheck.log`); scoped `bunx biome check packages/ir/src packages/core/src/bpmn packages/core/src/shapes packages/core/src/index.ts packages/io/src/jsonl` (`final-biome.log`); focused `bun test packages/ir/src/bpmn.test.ts packages/ir/src/registry.test.ts packages/ir/src/validate.test.ts packages/core/src/bpmn/model.test.ts packages/core/src/shapes/bpmn.test.ts packages/io/src/jsonl/bpmn-compat.test.ts packages/io/src/jsonl/golden.test.ts` (134 passed, 0 failed; `final-focused-tests.log`); whole-repo `bun test` (1668 passed, 0 failed across 188 files; `final-whole-tests.log`); `! grep -n "elements.find" packages/ir/src/validate.ts` (`final-no-linear-search.log`); and `git diff --quiet HEAD -- packages/ir/src/migrations.ts bun.lock` (`final-migration-lock-check.log`).
- The plan-local 12,000-node plus 12,000-edge validation probe exited 0, reported 44.0 ms and zero issues (`validate-benchmark.ts`, `final-timing-probe.log`). The initial scoped Biome run before formatting exited 1 on formatting in the two edited files (`biome.log`); only those owned files were formatted (`biome-format.log`) and the final scoped Biome rerun passed.
- Adversarial review `comm-006117` rejected the prior source for the two findings above. The corrections and final evidence are ready for the designated test-integrity/adversarial review rerun; this progress entry does not claim reviewer acceptance.

## Completion (session-359)

- Status: COMPLETE. Wave 1 was accepted by the s357 integration review
  after the comm-006117 repair round. Serial reconciliation round 2
  (`tmp/bpmn-operation-flow-s357/reconcile-wave1-r2/reconcile-summary.md`)
  found the current tree equal to the bpmn-01 snapshot (22/22). Its
  combined-tree typecheck, biome (470 files) and whole-repo bun test
  (1668 pass / 0 fail / 188 files) all exited 0.
- Recorded by the session-359 plan author (workflow execution
  `opus-luna-design-and-implement-review-loop-session-359`, intake
  comm-006132). Session-359 does not dispatch this plan
  (`acceptedPlanIds` in
  `impl-plans/active/bpmn-operation-flow-s359-dispatch.json`). No source
  file was changed for this entry.
- Later waves: `packages/core/src/bpmn/index.ts` and
  `packages/core/src/shapes/connector.ts` are shared. bpmn-03, bpmn-04
  and bpmn-05 append their own lines or branches there under the
  overview's hash protocol, so their hashes are expected to differ from
  the wave-1 snapshot.

## Re-verify (session-359 Step 6 redispatch)

- Read the assigned plan and accepted design. Dispatch dependency readiness is satisfied (`dependsOn: []`); accepted completion evidence remains the session-359 completion above. Review feedback is empty and the direct inbox has no findings, feedback, or repair requests.
- Compared all 22 tracked paths with the immutable `before:step6-implement` snapshot at `tmp/riela-fanout/3AE0B9DB-8124-4F0D-A361-1A58DCD4A7F1/C151A552-F0CD-4732-AF07-E5514D6FD934.json`; every SHA-256 matched. No source edits were made.
- Verification ran on the snapshotted source. Complete evidence is under `tmp/bpmn-operation-flow-s359/bpmn-01-ir-core-contract/`:
  - `bun run typecheck`: exit 0; `typecheck.log` is complete (15 bytes, no diagnostics).
  - `! grep -E '^(packages/ir/src/|packages/core/src/bpmn/model(\\.test)?\\.ts\\(|packages/core/src/index\\.ts\\(|packages/core/src/shapes/(bpmn|bpmn\\.test|index|outline)\\.ts\\(|packages/io/src/jsonl/(bpmn-compat|golden)\\.test\\.ts\\()' tmp/bpmn-operation-flow-s359/bpmn-01-ir-core-contract/typecheck.log`: exit 0; no owned diagnostics.
  - `! grep -E '^error TS' tmp/bpmn-operation-flow-s359/bpmn-01-ir-core-contract/typecheck.log`: exit 0; no unattributed TypeScript diagnostics.
  - `bun test packages/ir/src/bpmn.test.ts packages/ir/src/registry.test.ts packages/core/src/bpmn/model.test.ts packages/core/src/shapes/bpmn.test.ts packages/io/src/jsonl/bpmn-compat.test.ts packages/io/src/jsonl/golden.test.ts`: exit 0, 96 passed, 0 failed, 327 assertions (`focused-tests.log`).
- The additional expected aggregate reconciliation and formal downstream review/commit/push work remain with their owning workflow steps; no review acceptance is claimed here.
- Per-edit intent for this append is recorded in `tmp/bpmn-operation-flow-s359/bpmn-01-ir-core-contract/reverify-session-359-node2/edit-intents.md`.
