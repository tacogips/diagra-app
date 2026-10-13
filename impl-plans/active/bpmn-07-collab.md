# bpmn-07-collab

- planId: bpmn-07-collab
- planPath: impl-plans/active/bpmn-07-collab.md
- wave: 2; dependsOn: bpmn-01-ir-core-contract
- design: design-docs/specs/design-bpmn.md sections 3.2 (definition ids
  for id-keyed array merge), 3.3 (collab needs no key list change), 11
  (collab tests)
- progress log: impl-plans/progress/bpmn-07-collab.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Session-359 status and gate: read this first

- Status: IMPLEMENTED, awaiting gate. In s357 the focused test passed
  (3 pass, 0 fail) and `bun test packages/collab` passed (129 pass, 0
  fail). The only blocker was the whole-repo `bun run typecheck` (exit 2):
  16 diagnostics, all in files of bpmn-04, bpmn-05 and bpmn-06
  (`impl-plans/progress/bpmn-07-collab.md`, "Blocker").
- Session-359 work: re-gate only.
  1. Re-hash `packages/collab/src/test-fixtures.ts` and
     `packages/collab/src/bpmn.test.ts` and compare them with
     `tmp/bpmn-operation-flow-s357/bpmn-07-collab/source-hashes.txt`. Log
     any drift.
  2. Run "Verification" below under gates G1/G2.
  3. Append a "Resume (session-359)" section to the progress log with
     commands, exit codes, counts, log paths and the "Sibling diagnostics
     (non-blocking)" list. Tick the typecheck item when G1 passes.
- Edit source only if G1 matches an owned file or the focused test
  fails. Still no production collab change (non-goals).
- G1 ownRegex: `^packages/collab/src/(test-fixtures|bpmn\.test)\.ts\(`.
- Focused owned test (strictly blocking):
  `bun test packages/collab/src/bpmn.test.ts`. G2 applies to
  `bun test packages/collab`.
- Evidence: `tmp/bpmn-operation-flow-s359/bpmn-07-collab/`.

## Intent

Prove that BPMN documents round-trip through the Yjs binding and merge
field-granularly, with no production code change. The Yjs mapping is
generic (packages/collab/src/ydoc.ts `toY`/`fromY`, diff.ts reconciles
id-carrying arrays), so `parent` moves, renames and `definitions` edits
must already merge; this plan adds the fixture and the tests.

## Non-goals

- No change to `ydoc.ts`, `diff.ts`, `binding.ts` or any production file.
  If a test reveals a real defect, record it as an open issue in the
  progress log with the failing assertion and stop; do not patch
  production code in this plan (the orchestrator decides).
- No sync server code (public repo).

## writePaths

- packages/collab/src/test-fixtures.ts
- packages/collab/src/bpmn.test.ts (new)
- impl-plans/progress/bpmn-07-collab.md

sharedPaths: none.

## File-level changes

### packages/collab/src/test-fixtures.ts

- Add `export const BPMN_PAGE: Page = { id: "p-bpmn", name: "Purchase",
  kind: "bpmn" }` and `export function bpmnDocument(): Document`
  imitating `sequenceDocument()` (test-fixtures.ts:116): one participant,
  two lanes (parent = participant), a start event (lane 1), a user task
  (lane 1) with `visual.labelBounds` absent, an intermediate throw event
  with one message definition `{id: "d-msg", kind: "message"}` (lane 2),
  an exclusive gateway, an end event, sequence flows between them, one
  text annotation with an association. Use the `bpmn.*` payload shapes
  from packages/ir/src/semantics.ts (bpmn-01). Give the end event
  `visual.labelBounds`.
- Append `bpmnDocument()` to `allFixtures()` (test-fixtures.ts:231) so the
  existing "round-trips every fixture through the Y.Doc" test
  (ydoc.test.ts:111) covers it.

### packages/collab/src/bpmn.test.ts (new)

Imitate the two-client merge tests in `binding.test.ts` and
`diff.test.ts` (two `Y.Doc`s exchanging updates with
`Y.encodeStateAsUpdate`/`Y.applyUpdate`).

## Pitfalls

- The document must be valid (`assertValidDocument`) or the round-trip
  test will fail for the wrong reason.
- Do not change the order or content of the existing fixtures.

## Tests (input -> expected)

- `irToYDoc(bpmnDocument())` then `ydocToIr` -> deep-equal to the input,
  including `labelBounds` and `definitions`
- client A moves the task to lane 2 (`semantic.parent` changed, whole
  payload written through the binding/diff path) while client B renames
  the task -> both converge to `parent = lane 2` and the new name
- client A edits `definitions[0].kind` metadata (e.g. sets `ref`) while
  client B appends a second definition `{id: "d-timer", kind: "timer",
  timer: {type: "duration", value: "PT1H"}}` -> both converge to two
  definitions with A's change kept (array merged by id)
- page `kind: "bpmn"` survives the page round trip

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck > tmp/bpmn-operation-flow-s359/bpmn-07-collab/typecheck.log 2>&1   # gate G1 (overview): no ownRegex match, no unattributed "error TS" line; exit code recorded
bunx biome check packages/collab/src/test-fixtures.ts packages/collab/src/bpmn.test.ts   # exit 0
bun test packages/collab/src/bpmn.test.ts           # exit 0, pass count > 0, 0 fail (owned tests, design 11.1 rule 1)
bun test packages/collab                            # exit 0, includes the new tests; ydoc.test.ts unedited (it loops allFixtures() without a pinned count)
```

## Done criteria

- `git diff --stat packages/collab/src` lists only `test-fixtures.ts` and
  `bpmn.test.ts`.
- Tests pass; exit codes in the progress log. Any merge defect is
  reported as an open issue, not patched.
