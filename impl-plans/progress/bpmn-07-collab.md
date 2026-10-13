# bpmn-07-collab progress

- Plan: `impl-plans/active/bpmn-07-collab.md`
- Branch: `feat/bpmn-operation-flow`
- Status: implemented and verified on session-359; source, behavioral tests,
  scoped formatting, and whole-repo typecheck pass.
- Production collaboration files changed: none.

## Completion criteria

- [x] Add `bpmnDocument()` to `allFixtures()` with a BPMN page, participant,
  two lanes, events, task, gateway, sequence flows, annotation, and association.
- [x] Round-trip BPMN through `irToYDoc` / `ydocToIr`, preserving page kind,
  `visual.labelBounds`, and event `definitions`.
- [x] Two bound clients converge after a task parent move and concurrent rename.
- [x] Two bound clients merge event definition edits by id and converge.
- [x] Keep production `packages/collab/src` unchanged.
- [x] `bun run typecheck` exits 0 with no owned or sibling diagnostics on the
  session-359 tree; see Resume (session-359) below.

## Verification

Commands were run in the foreground on the shared working tree. Complete logs:

| Command | Result | Log |
| --- | --- | --- |
| `bunx biome check packages/collab/src/test-fixtures.ts packages/collab/src/bpmn.test.ts` | exit 0; 2 files clean | `tmp/bpmn-operation-flow-s357/bpmn-07-collab/biome-final.log` |
| `bun test packages/collab/src/bpmn.test.ts` | exit 0; 3 pass, 0 fail | `tmp/bpmn-operation-flow-s357/bpmn-07-collab/focused-tests-final.log` |
| `bun test packages/collab` | exit 0; 129 pass, 0 fail across 6 files | `tmp/bpmn-operation-flow-s357/bpmn-07-collab/collab-tests.log` |
| `bun run typecheck` | exit 2; 16 diagnostics in files outside this plan | `tmp/bpmn-operation-flow-s357/bpmn-07-collab/typecheck-final.log` |

An earlier focused attempt exited 1 before test execution because the shared,
untracked `packages/core/src/bpmn/containment.ts` was being written and had a
temporary parse error. The later focused and package runs above passed after
the file became syntactically valid. The first scoped Biome run reported one
formatting issue in `bpmn.test.ts`; formatting that owned file fixed it and the
final scoped check passed.

## Blocker

The final `bun run typecheck` reports:

- `packages/core/src/bpmn/lint/engine.test.ts`: nine TS2783 duplicate `id`
  diagnostics at lines 14, 15, 17, and 28-33
- `packages/core/src/bpmn/lint/engine.ts`: unused `BpmnLintRuleId`
- `packages/core/src/bpmn/notation.ts`: `Box | { x: number; y: number }` has no
  `width` / `height` at line 229
- `packages/core/src/bpmn/routes.ts`: `Vec` is not exported from `@nodetto/ir`
- `packages/io/src/bpmn/import.ts`: unused `BPMNDI`, `DI`, and `laneParent`

These paths are outside bpmn-07's declared write paths and belong to other
plans. No source repair was made. Resume by rerunning `bun run typecheck` after
the owning plans resolve those diagnostics; do not modify their files here.

## Resume evidence

The owned source and test hashes at handoff are recorded in
`tmp/bpmn-operation-flow-s357/bpmn-07-collab/source-hashes.txt`. Formal
test-integrity, adversarial, and combined-tree integration review remain with
later workflow steps.

## Resume (session-359)

The initial s357 typecheck blocker was rechecked on the current combined
working tree. `bun run typecheck` exits 0; both the owned-path diagnostic
guard and the unattributed `error TS` guard pass. G1 therefore has 0 owned
diagnostics and 0 sibling diagnostics (none to list). The prior 16 diagnostics
listed under Blocker were resolved by sibling work; this plan made no changes
to their files. SHA-256 for both owned source files matches the s357 handoff:
`test-fixtures.ts` is
`f7bdf1c9981b93b130663513492202a26a5ad0f5972d2aa6aabb055e9fdce310`, and
`bpmn.test.ts` is
`8e903c3ebe6b39ece08f40eaf6e21dbfb734684c2e2f422e3ecfde23546b8a9b`.

| Command | Result | Log |
| --- | --- | --- |
| `bun run typecheck` | exit 0; 0 owned diagnostics, 0 sibling diagnostics | `tmp/bpmn-operation-flow-s359/bpmn-07-collab/typecheck-final.log` |
| `! grep -E '^packages/collab/src/(test-fixtures|bpmn\.test)\.ts\(' tmp/bpmn-operation-flow-s359/bpmn-07-collab/typecheck-final.log` | exit 0; no owned-path diagnostics | `tmp/bpmn-operation-flow-s359/bpmn-07-collab/typecheck-final.log` |
| `! grep -E '^error TS' tmp/bpmn-operation-flow-s359/bpmn-07-collab/typecheck-final.log` | exit 0; no TypeScript diagnostics | `tmp/bpmn-operation-flow-s359/bpmn-07-collab/typecheck-final.log` |
| `bunx biome check packages/collab/src/test-fixtures.ts packages/collab/src/bpmn.test.ts` | exit 0; 2 files clean | `tmp/bpmn-operation-flow-s359/bpmn-07-collab/biome.log` |
| `bun test packages/collab/src/bpmn.test.ts` | exit 0; 3 pass, 0 fail, 20 expects | `tmp/bpmn-operation-flow-s359/bpmn-07-collab/focused-tests.log` |
| `bun test packages/collab` | exit 0; 129 pass, 0 fail, 1255 expects across 6 files | `tmp/bpmn-operation-flow-s359/bpmn-07-collab/package-tests.log` |

The focused suite proves the BPMN Y.Doc round trip, page kind, label bounds,
event definitions, concurrent parent move plus rename, and id-keyed definition
merge. No production collaboration file changed. The earlier Blocker section
is retained as historical evidence of the s357 typecheck failure.
