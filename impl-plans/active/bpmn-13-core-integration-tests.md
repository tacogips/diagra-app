# bpmn-13-core-integration-tests

- planId: bpmn-13-core-integration-tests
- planPath: impl-plans/active/bpmn-13-core-integration-tests.md
- wave: 3; dependsOn: bpmn-03-core-editing, bpmn-04-core-notation-svg,
  bpmn-05-core-lint, bpmn-06-io-bpmn-xml
- design: design-docs/specs/design-bpmn.md sections 7.3 (required fixture
  lint outcome, reference rule-id multisets), 11 (SVG structural test of
  the complete fixture, four fixture lint outcomes)
- progress log: impl-plans/progress/bpmn-13-core-integration-tests.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Session-359 status and gate: read this first

- Status: NOT STARTED. Runs in wave 3, after the wave-2 join, which
  includes bpmn-03, bpmn-04, bpmn-05 and bpmn-06. If an owned path
  already exists, re-read and inventory it instead of overwriting it.
- Gates: overview "Parallel-wave gate (design 11.1 rule 3)".
- G1 ownRegex:
  `^packages/core/src/bpmn/(fixtures|reference-lint)\.test\.ts\(`.
- Focused owned test (strictly blocking): the third "Verification"
  command (both owned test files). G2 applies to the whole-repo
  `bun test`.
- If a focused assertion fails because production code in a wave-2 plan
  is wrong (for example, a lint outcome or an SVG role count), do not
  weaken the assertion and do not edit production code (non-goal).
  Record it under Open issues with the failing assertion and the owning
  plan, and stop. The orchestrator routes it.
- Evidence: `tmp/bpmn-operation-flow-s359/bpmn-13-core-integration-tests/`.

## Intent

Cross-package acceptance tests that need both the io importer and core
lint/rendering. They live in `@diagra/core` because only core
dev-depends on `@diagra/io` (packages/core/package.json); io cannot import
core. They pin acceptance criteria 2 (SVG structure of the original
purchase-request fixture) and 4 (exact lint outcomes).

## Non-goals

- No production code changes. If a test fails because of a defect in
  another plan's code, record the failing assertion and the suspected
  file as an open issue in the progress log; do not edit files outside
  writePaths. The orchestrator routes the fix to the owning plan.
- No copying of reference labels or text into tests.

## writePaths

- packages/core/src/bpmn/fixtures.test.ts (new)
- packages/core/src/bpmn/reference-lint.test.ts (new)
- impl-plans/progress/bpmn-13-core-integration-tests.md

sharedPaths: none.

## File-level changes

### packages/core/src/bpmn/fixtures.test.ts

Load each fixture from `packages/io/src/__fixtures__/bpmn/` (resolve from
`import.meta.dir`) with `importBpmnXml` from `@diagra/io`.

Tests (input -> expected):
- complete -> `lintBpmnPage(doc, pageId, recommendedLintConfig())` is
  empty
- draft -> exactly three findings, as a sorted list of
  `[ruleId, elementId]`: `["label-required", "Task_PlaceOrder"]`,
  `["no-implicit-end", "Task_PlaceOrder"]`,
  `["no-implicit-start", "Event_OrderNoticeProcurement"]`; all severity
  `error`
- swapped -> empty; inverted -> empty
- complete, rendered with `new Editor({document}).exportPageSvg()` (set
  the current page to the imported page first) -> counts of class
  attributes in the SVG string:
  - `bpmn-participant-header` 1, `bpmn-lane-header` 3
  - `bpmn-task-icon-user` 3
  - `bpmn-event-icon-message-filled` 3, `bpmn-event-icon-message-hollow` 3
  - `bpmn-event-border-intermediate` 6 (double circles), `bpmn-event-border-start` 1,
    `bpmn-event-border-end` 2
  - `bpmn-gateway-marker-exclusive` 1
  - `bpmn-sequence-arrow` 12
  - text content `YES` and `NO` each present once inside `bpmn-flow-label`
    elements
- complete -> the SVG viewBox contains every label box (the lowest label,
  under `Event_OrderNoticeProcurement`, has bottom <= viewBox bottom)
- complete -> `connectBpmn` from `End_PurchaseComplete` to
  `Task_SubmitRequest` is rejected with `bpmn.connection.endEventOutgoing`
  (acceptance case on a real fixture)

Count classes with a regex over `class="..."` attribute values split on
spaces; do not depend on attribute order.

### packages/core/src/bpmn/reference-lint.test.ts

- `describe.skipIf(!existsSync(<repo>/.reference/bpmn-article/docs))`.
- For each of the four reference files: import, lint with recommended,
  compare the sorted rule-id multiset only:
  - `purchase_request_draft` -> `["label-required", "no-implicit-end",
    "no-implicit-start"]`
  - `purchase_request`, `purchase_request_swapped`,
    `purchase_request_inverted` -> `[]`
- Do not assert element ids, names or any text from the reference files.

## Pitfalls

- Use `exportPageSvg` on the imported page, not a hand-built document.
- If a count is off by one because of a role naming mismatch, check the
  pinned role list in bpmn-04 before suspecting the fixture.

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck > tmp/bpmn-operation-flow-s359/bpmn-13-core-integration-tests/typecheck.log 2>&1   # gate G1 (overview): no ownRegex match, no unattributed "error TS" line; exit code recorded
bunx biome check packages/core/src/bpmn/fixtures.test.ts packages/core/src/bpmn/reference-lint.test.ts   # exit 0
bun test packages/core/src/bpmn/fixtures.test.ts packages/core/src/bpmn/reference-lint.test.ts   # exit 0; reference tests not skipped locally
bun test                                                # exit 0
```

## Done criteria

- Both files exist; all tests pass locally with reference tests executed
  (record pass/skip counts).
- `grep -n "Office supply\|Submit purchase" packages/core/src/bpmn/reference-lint.test.ts`
  returns nothing (no labels asserted there).
- Open issues (if any) name the owning plan.
