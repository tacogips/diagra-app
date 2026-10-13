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
bun run typecheck                                   # exit 0
bunx biome check packages/collab/src/test-fixtures.ts packages/collab/src/bpmn.test.ts   # exit 0
bun test packages/collab                            # exit 0, includes the new tests
```

## Done criteria

- `git diff --stat packages/collab/src` lists only `test-fixtures.ts` and
  `bpmn.test.ts`.
- Tests pass; exit codes in the progress log. Any merge defect is
  reported as an open issue, not patched.
