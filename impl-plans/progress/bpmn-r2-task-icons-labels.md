# Progress: bpmn-r2-task-icons-labels

## Start (UTC)

2026-10-13 17:20:12 UTC. Branch: `feat/bpmn-operation-flow`. DAG dependencies: none; acceptedPlanIds is empty, which is valid for this dependency-free plan.

## Files (path, pre-hash, post-hash)

| Path | Pre-hash | Post-hash |
|---|---|---|
| `packages/core/src/bpmn/notation.ts` | `8a180f7c66a4b6ebbc9e39ccbc96750156dc730f5e6ad2a7157dcf7405b884cb` | `4b3f0969d049bdcd5af6f4e649fac44b1a991895d0ae42f705a10c929f4aaf0f` |
| `packages/core/src/bpmn/notation.test.ts` | `3261ae5c5901c81d25238c504a2da80da8cb88001f3f8aa7f6514ade802559c3` | `ab5c21eed3e829fb9dee8c0a9f3a05fe33e2bc25f968523b1c07b33538e5c2fb` |
| `packages/core/src/svg-export.ts` | `d113c50412ddc2787d33eebb1eb994a243cce2c62a9ba2c41b41f3cc34918634` | `2764133263f11f1a12e628c87706b03c3f2085ad81c90d5183d55f4e9f814137` |
| `packages/core/src/bpmn/svg-export-bpmn.test.ts` | `52df720526d91403995ce1292a51d8bac3a88724da1dc98f8b5e6cd480bc5aae` | `93cdfbf77a194817282e4bc14075172e39b3c91f167c4427a00776082ddd6d81` |
| `impl-plans/progress/bpmn-r2-task-icons-labels.md` | absent | final digest is included in the Step 6 result |

## Commands (command, exit, counts, log)

- `bun test packages/core/src/bpmn/svg-export-bpmn.test.ts packages/core/src/bpmn/notation.test.ts` — expected pre-change exit 1; 6 pass, 4 fail, 61 expectations. The stale `visual.x` label test failed with old x `-869`; the new icon grammar/group tests also failed against pre-change behavior. Complete log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/label-prechange.log`.
- `bun test packages/core/src/bpmn/notation.test.ts packages/core/src/bpmn/svg-export-bpmn.test.ts` — exit 0; 10 pass, 0 fail, 170 expectations. Width independence is asserted for all seven icons. Complete final-source log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/focused.log`.
- `bun test packages/core/src/bpmn/fixtures.test.ts packages/ui-solid/src/shapes/bpmn-primitive.test.ts packages/core/src/svg-export.test.ts` — exit 0; 63 pass, 0 fail, 220 expectations. Complete final-source log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/invariants.log`.
- `bunx biome check packages/core/src/bpmn/notation.ts packages/core/src/bpmn/notation.test.ts packages/core/src/svg-export.ts packages/core/src/bpmn/svg-export-bpmn.test.ts` — exit 0; four files checked. Complete log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/biome.log`.
- `bun run typecheck` — exit 0; no TypeScript diagnostics. Owner-scoped diagnostic grep printed nothing; global `error TS` grep printed nothing. Complete log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/typecheck.log`.
- `bun test packages/core packages/ui-solid` — exit 0; 1,302 pass, 0 fail, 7,034 expectations across 173 files. Complete log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/packages.log`.
- `test "$(grep -c 'h14 v14' packages/core/src/bpmn/notation.ts)" -eq 0` — exit 0. Complete log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/static-placeholder.log`.
- `test -z "$(git diff --name-only -- packages/ui-solid/src/shapes/BpmnShapeView.tsx packages/core/src/bpmn/fixtures.test.ts)"` — exit 0. Complete log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/static-scope.log`.
- `git diff --name-only -- packages/ui-solid/src/shapes/BpmnShapeView.tsx packages/core/src/bpmn/fixtures.test.ts packages/core/src/backdrops.ts` — exit 0; output contains only `packages/core/src/backdrops.ts`, concurrently edited by bpmn-r1; neither `BpmnShapeView.tsx` nor `fixtures.test.ts` changed. Complete log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/static-sibling-scope.log`. No edit to `backdrops.ts` was made by this plan.
- `git diff --check` — exit 0; no whitespace errors. Complete log: `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/diff-check.log`.

An initial pre-change shell wrapper used zsh's read-only variable name `status` after Bun had completed; the complete Bun log was still written. The later final-source test invocations used `rc` and captured their exit statuses normally. An initial post-implementation focused run (log `focused-initial.log`) reported 8 pass, 2 fail: it found identical send/receive envelope geometry and correctly exposed the existing text baseline offset in the SVG assertion. The flap geometry was distinguished and expected y was aligned to `textPrimitive`'s 5.5 offset; the final-source focused rerun passed.

## Pre-change proof

The pre-change log confirms the stale-label fixture fails before the fix: expected x 20, actual x -869 from stale `visual.x = 999`. It also confirms the original placeholder path violates the new allowed-path grammar and the group body was `#ffffff`. The SVG case (c) was corrected to locate the text within its containing translated shape group and passes on final source.

## Icon originality note

- `user`: a hand-drawn cubic shoulders/bust outline and a separate hollow head circle.
- `service`: deterministic eight-tooth gear generated from alternating inner/outer radii and rounded polar coordinates, with a hollow hub circle.
- `manual`: a hand-built closed palm/finger/thumb outline using line and quadratic segments.
- `send`: a filled hand-drawn envelope body with a contrasting flap stroke in the task fill color.
- `receive`: a hollow hand-drawn envelope body with an outlined flap.
- `script`: a scroll-like outline with wavy sides and three short text strokes.
- `businessRule`: a hollow table rectangle, filled header row, and hand-drawn row/column dividers.

No `.reference/`, bpmn-js, or bpmn-font artwork was read or copied for these paths.

## Sibling diagnostics (non-blocking)

No typecheck diagnostics were observed. `packages/core/src/backdrops.ts` is a concurrent bpmn-r1 write and was preserved.

## Sibling test failures (non-blocking)

None in the `packages/core` and `packages/ui-solid` aggregate suite (1,302 pass, 0 fail).

## Drift

Fresh final hashes match the post-hashes recorded above. No owned-file drift was found. Shared working tree also contains bpmn-r1 changes to `packages/core/src/backdrops.ts`, `packages/core/src/backdrops.test.ts`, and `packages/core/src/shapes/connector.test.ts`; they are outside this plan's writePaths and were preserved.

## Open issues

None for this plan. Formal integrity/adversarial review, reconciliation-wide checks, and commit/push remain downstream workflow steps.

## Done checklist

- [x] Verification step 1 log shows the expected pre-change stale-label failure.
- [x] Verification steps 2, 3 and 4 exit 0 with positive test counts where applicable.
- [x] Verification step 5 exits 0; owner-path and global TypeScript error greps are empty.
- [x] Verification step 6 exits 0 with no blocking failures.
- [x] Verification step 7: placeholder grep is zero; forbidden UI/fixture paths are unchanged. The only other-path diff is the concurrent bpmn-r1 `backdrops.ts` edit.
- [x] Progress record includes commands, exit codes, counts, complete log paths, and icon originality notes.
