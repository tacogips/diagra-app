# bpmn-r1-connector-backdrops

- planId: bpmn-r1-connector-backdrops
- planPath: impl-plans/completed/bpmn-r1-connector-backdrops.md
- wave: 1; dependsOn: none (runs in parallel with bpmn-r2-task-icons-labels)
- design: design-docs/specs/design-bpmn.md section 6.4 (paint layers and
  routing obstacles), section 11 "rendering-defect regressions" (the
  backdrops, svg-export-layers, connector and ui-solid bullets), section 13
  (flows below flow nodes)
- progress log: impl-plans/progress/bpmn-r1-connector-backdrops.md
- evidence: tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/ (tmp/ is
  git-ignored)
- branch: feat/bpmn-operation-flow, same working directory as the sibling
  plan. No worktrees, no private branches, no git write operations.

## Completion (session-360)

- Status: COMPLETE. Implemented in session-360 (step6-implement attempt 3,
  after the IR-R1-REPORT-01 report-format repair) and accepted through
  test-integrity, adversarial and branch-evidence review; archived to
  `impl-plans/completed/` in Step 8.
- Final verification: the session-360 serial integration review
  (comm-006310) passed on the combined r1+r2 tree with 0 high and 0
  medium findings: `bun run typecheck`, `bunx biome check .` (518 files),
  `bun test packages/core packages/ui-solid` (1302 pass), `bun test`
  (1852 pass, 0 fail). Evidence (local, untracked):
  `tmp/bpmn-render-fix-s360/reconcile-attempt3/`.
- Browser E2E was skipped (comm-006311): the repository has no browser
  E2E harness. Canvas paint order is verified through the shared
  predicate only; a manual desktop check of `purchase-request.bpmn` is
  recommended before merge.
- The `svg-export.ts` item in the done checklist below is met for this
  plan's own edits; `svg-export.ts` differs from a4083501 only because of
  the sibling bpmn-r2-task-icons-labels change.

## Intent

On a BPMN page with flows, the white bodies of pools and lanes paint over
every sequence and message flow, in the ui-solid canvas and in SVG export.
The cause is `isConnectorBackdrop` in `packages/core/src/backdrops.ts`,
which lowers only ungrouped `frame` elements beneath the connector layer.
Broaden that one predicate. It is the single source for three consumers,
which need no code change:
- `packages/core/src/svg-export.ts:1815` (`connectorBackdropIds` puts
  backdrops in `<g data-layer="backdrops">` before `<g data-layer="connectors">`)
- `packages/ui-solid/src/Canvas.tsx:321` (`diagra-backdrop-layer` before the
  connector svg)
- `packages/core/src/shapes/connector.ts:417` (`obstacleBoxes` skips
  backdrops, so routes cross pools and lanes)

Then add the regression tests that prove the new paint order and routing.

## Non-goals

- Do NOT edit `svg-export.ts`, `Canvas.tsx` or `shapes/connector.ts`. They
  already call the predicate. If one of them seems to need a change, stop
  and record it under Open issues.
- No new layer, z-index, sort or reordering. Backdrop paint order stays the
  page z-order.
- No change to frame behaviour, the `!isGrouped` rule or the "only on pages
  with a connector" rule in `connectorBackdropIds`.
- Do NOT touch `packages/core/src/bpmn/notation.ts`,
  `packages/core/src/bpmn/notation.test.ts`,
  `packages/core/src/bpmn/svg-export-bpmn.test.ts` or
  `packages/core/src/bpmn/fixtures.test.ts` (owned by bpmn-r2 or
  unchanged).
- Do NOT edit any fixture under `packages/io/src/__fixtures__/`. Read it
  only.
- No `.reference/` content, no new dependencies, no emojis.

## writePaths

- packages/core/src/backdrops.ts
- packages/core/src/backdrops.test.ts (new)
- packages/core/src/bpmn/svg-export-layers.test.ts (new)
- packages/core/src/shapes/connector.test.ts
- packages/ui-solid/src/bpmn-backdrop.test.ts (new)
- impl-plans/progress/bpmn-r1-connector-backdrops.md (new)

sharedPaths: none.

## File-level changes

### packages/core/src/backdrops.ts

- `isConnectorBackdrop(element: Element, isGrouped: (id: ElementId) => boolean): boolean`
  keeps its signature. It returns true when `!isGrouped(element.id)` and one
  of these holds:
  - `element.type === "frame"` (unchanged)
  - `element.type` is `"bpmn.participant"`, `"bpmn.lane"` or `"bpmn.group"`.
    A participant qualifies whether or not `semantic.collapsed` is true.
  - `element.type === "bpmn.subProcess"` and
    `(element.semantic as Record<string, unknown>)["expanded"] === true`.
    Use the same read idiom as `packages/core/src/bpmn/notation.ts:fields`.
    A missing or false `expanded` is NOT a backdrop.
- Update the header comment and the JSDoc on `isConnectorBackdrop` and
  `connectorBackdropIds`: they currently say "frames" only. One or two
  sentences: BPMN pools, lanes, expanded sub-processes and BPMN groups are
  surfaces too (design-bpmn.md 6.4). Keep the comment density of the file.
- `connectorBackdropIds` and `groupedIds`: no logic change.
- Pitfalls:
  - Do not test `element.type.startsWith("bpmn.")`. Tasks, events,
    gateways, data objects, data stores, text annotations, call activities,
    boundary events and collapsed sub-processes must stay false.
  - Do not confuse `bpmn.group` (a BPMN artifact type) with the diagra
    `group` type. The diagra `group` stays false, as today.
  - Keep the `!isGrouped` check for every type.

### packages/core/src/backdrops.test.ts (new)

Imitate the style of `packages/core/src/bpmn/routes.test.ts` (bun:test,
`element` from `../test-helpers.ts`). Test `isConnectorBackdrop` directly
with `isGrouped = () => false` unless stated otherwise:
- `frame` -> true; `frame` with `isGrouped = () => true` -> false
- `bpmn.participant` `{collapsed: false}` -> true; `{collapsed: true}` -> true
- `bpmn.lane` -> true; `bpmn.group` -> true
- `bpmn.subProcess` `{expanded: true}` -> true; `{expanded: false}` -> false;
  semantic without `expanded` -> false
- `bpmn.task`, `bpmn.event`, `bpmn.gateway`, `bpmn.dataObject`,
  `bpmn.textAnnotation`, `bpmn.callActivity`, `node.generic`, `group` -> false
- `bpmn.lane` with `isGrouped = () => true` -> false
- `connectorBackdropIds([pool, lane, task])` (no edge) -> empty set;
  `connectorBackdropIds([pool, lane, task, sequenceFlow])` -> exactly
  `{pool.id, lane.id}`.

### packages/core/src/bpmn/svg-export-layers.test.ts (new)

Imitate `packages/core/src/bpmn/svg-export-bpmn.test.ts` (Store,
`createDefaultRegistry`, `renderPageSvg`, `document`/`element`/`TEST_PAGE`)
and `packages/core/src/bpmn/fixtures.test.ts` (fixture loading with
`readFileSync` + `importBpmnXml` from `@diagra/io`, `repositoryRoot`
resolved from `import.meta.dir`). Locate layers by string index in the SVG:
`backdrops = svg.indexOf('data-layer="backdrops"')`, `connectors =
svg.indexOf('data-layer="connectors"')`, `shapes =
svg.indexOf('data-layer="shapes"')`.

- Test (a): an expanded pool (`bpmn.participant`, collapsed false, index a1),
  two lanes (a2, a3, `parent: pool`), two `bpmn.task`s with `parent` set to
  the lanes, one `bpmn.sequenceFlow` between the tasks, a collapsed pool
  (`collapsed: true`) placed below the expanded pool, and one
  `bpmn.messageFlow` from a task to the collapsed pool. Elements get indexes
  in that order, flows last. Use a page `{...TEST_PAGE, kind: "bpmn"}` as in
  `routes.test.ts`. Expected:
  - `backdrops > -1` and `backdrops < connectors < shapes`
  - every `class="bpmn-participant-body"` and every `class="bpmn-lane-body"`
    occurrence index is between `backdrops` and `connectors`
  - `data-id="<expanded pool id>"` comes before `data-id="<lane id>"`
    (z-order kept inside the backdrop layer)
  - each flow's `data-id="<flow id>"`, the `class="bpmn-sequence-arrow"`
    and the `class="bpmn-message-arrow"` lie between `connectors` and
    `shapes`
  - each task's `data-id` comes after `shapes`
- Test (b): import `packages/io/src/__fixtures__/bpmn/purchase-request.bpmn`,
  render with `renderPageSvg(new Store(imported.document),
  createDefaultRegistry(), imported.pageId)`. Expected:
  - the document has 12 `bpmn.sequenceFlow` elements (assert, so the test
    fails loudly if the fixture changes)
  - all 12 `class="bpmn-sequence-arrow"` occurrences and each sequence
    flow's `data-id` lie after the LAST `bpmn-participant-body` /
    `bpmn-lane-body` occurrence and after `connectors`
  - the participant body and the 3 lane bodies lie between `backdrops` and
    `connectors`
- Pitfall: find occurrences with a loop over `indexOf(needle, from)`, not
  only the first match. Check how `data-id` is written in the SVG (look at
  `elementGroup` in `svg-export.ts`) before asserting on it. If it is
  absent for connectors, assert on the arrow classes and connector count
  instead, and log the reason.

### packages/core/src/shapes/connector.test.ts

Append tests next to "orthogonal routes cross frames instead of detouring
around them" (around line 562) and imitate it exactly (`makeEditor`,
`node.generic` endpoints at x 0 and x 600, `edge.generic` with
`routing: "orthogonal"`, `resolveConnector(..., readDirectEndpoints)`,
straight line means every point has `y === 50`):
- a `bpmn.participant` (x 220, y -250, w 260, h 600, collapsed false) plus a
  `bpmn.lane` (x 250, y -200, w 200, h 500, `parent` = the pool id) between
  the two nodes -> the route stays straight
- an expanded `bpmn.subProcess` (`expanded: true`) in the same place ->
  straight
- a `bpmn.group` in the same place -> straight
- control: a collapsed `bpmn.subProcess` (`expanded: false`) in the same
  place -> NOT straight (`points.length > 2` and not every `y === 50`)

If `editor.createElement` rejects a `bpmn.*` type on the default page, build
the document with `element()` + `document(..., [{...TEST_PAGE, kind:
"bpmn"}])` and `new Editor({document})` as `bpmn/routes.test.ts` does, and
record that in the progress log. Each positive case must fail on the
pre-change predicate. Prove this once: run the new tests before editing
`backdrops.ts` and record the failure in the progress log (see
Verification step 1).

Do not change any existing test in this file.

### packages/ui-solid/src/bpmn-backdrop.test.ts (new)

The canvas partition is the memo in `Canvas.tsx:320-338`:
`connectorBackdropIds(elements, (id) => groupOf(store, id) !== null)`. There
is no rendered-canvas frame backdrop test to imitate, so test that exact call
through `@diagra/core`. Build the document with `Editor` +
`createPage({kind: "bpmn"})` (imitate `packages/ui-solid/src/bpmn-palette.test.ts:editorOnBpmnPage`)
or with `new Editor({document})` and explicit elements. Read
`store.getPageElements(pageId)` as Canvas does:
- pool, two lanes, two tasks, a sequence flow -> the backdrop set is
  exactly `{pool, lane1, lane2}`
- filtering the page elements by that set keeps z-order: pool before both
  lanes (mirrors `backdropRoots`)
- the visual roots (non-connector, ungrouped, not in the set) are exactly
  the two tasks (mirrors `visualRoots`; use `isConnector`/`groupOf` from
  `@diagra/core` only if exported there, otherwise compare against the
  element category)
- the same page without the flow -> empty set (backdrops only with a
  connector)

Only import from `@diagra/core` / `@diagra/ir`; do not import `Canvas.tsx`
(it needs a DOM).

## Invariants

- The existing frame tests stay unchanged and pass:
  `packages/core/src/svg-export.test.ts` "frames as connector backdrops"
  and `packages/core/src/shapes/connector.test.ts` frame routing tests.
- Class counts in `packages/core/src/bpmn/fixtures.test.ts` are unchanged
  by this plan (layers move elements, they do not add or remove primitives).
- Strict TypeScript: no `any`, no `@ts-ignore`, no non-null assertion
  beyond the pattern already used in `connector.test.ts`.

## Acceptance criteria

- `isConnectorBackdrop` is true exactly for the types in the design 6.4
  list, and the new `backdrops.test.ts` passes.
- `svg-export-layers.test.ts` (a) and (b) pass.
- The four new routing tests in `connector.test.ts` pass, and the positive
  ones fail before the `backdrops.ts` change (evidence in the progress log).
- `bpmn-backdrop.test.ts` passes.
- `git diff --name-only` lists, from this plan, only the writePaths above.

## Verification

All logs go to `tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/`.
Run every command in the foreground from the repository root. Record the
exact command, exit code, pass/fail counts and log path in the progress
log.

1. Pre-change proof (before editing `backdrops.ts`, after writing the new
   connector tests):
   `bun test packages/core/src/shapes/connector.test.ts > tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/connector-prechange.log 2>&1`
   -> expected NON-zero exit, with the pool/lane, expanded sub-process and
   group cases failing and the collapsed control passing.
2. Focused owned tests (strictly blocking, exit 0, positive pass count,
   0 fail):
   `bun test packages/core/src/backdrops.test.ts packages/core/src/bpmn/svg-export-layers.test.ts packages/core/src/shapes/connector.test.ts packages/ui-solid/src/bpmn-backdrop.test.ts > tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/focused.log 2>&1`
3. Existing frame and BPMN export tests (strictly blocking for this plan,
   because a failure here is caused by the predicate change):
   `bun test packages/core/src/svg-export.test.ts packages/core/src/bpmn/fixtures.test.ts packages/core/src/bpmn/routes.test.ts > tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/existing.log 2>&1`
   -> exit 0.
4. `bunx biome check packages/core/src/backdrops.ts packages/core/src/backdrops.test.ts packages/core/src/bpmn/svg-export-layers.test.ts packages/core/src/shapes/connector.test.ts packages/ui-solid/src/bpmn-backdrop.test.ts > tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/biome.log 2>&1`
   -> exit 0. To fix formatting, use `bunx biome check --write <these files>` only.
5. Gate G1, owner-scoped typecheck:
   `bun run typecheck > tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/typecheck.log 2>&1`.
   Then
   `grep -E '^(packages/core/src/(backdrops|backdrops\.test|bpmn/svg-export-layers\.test|shapes/connector\.test)\.ts|packages/ui-solid/src/bpmn-backdrop\.test\.ts)\(' tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/typecheck.log`
   must print nothing. A line starting with `error TS` and no file blocks.
   Other diagnostics are listed under "Sibling diagnostics (non-blocking)"
   when they are in bpmn-r2's writePaths. Diagnostics anywhere else block
   when they name `isConnectorBackdrop`/`connectorBackdropIds`.
6. Gate G2, package tests:
   `bun test packages/core packages/ui-solid > tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/packages.log 2>&1`.
   Record the exit code and counts. A failing file in this plan's
   writePaths, or one that fails because of the predicate change (routing
   or layer assertions), blocks. A failure only in bpmn-r2's files
   (`notation.test.ts`, `svg-export-bpmn.test.ts`) or in their icon/label
   assertions goes under "Sibling test failures (non-blocking)".
7. Routing consumers outside core (the CLI `bpmn export` resolves
   waypoints through core routing):
   `bun test apps/cli/src/bpmn-commands.test.ts > tmp/bpmn-render-fix-s360/bpmn-r1-connector-backdrops/cli-bpmn.log 2>&1`
   -> exit 0. A failure here (for example a changed exported waypoint or a
   `--check` mismatch) is caused by this plan and blocks. Do not
   "fix" it by editing the CLI test or a fixture. Record it under Open
   issues with the diff for orchestrator decision.
8. The whole-repo `bun test` and `bunx biome check .` are run by the
   orchestrator at reconciliation, not here.

## Progress log and protocol

Create `impl-plans/progress/bpmn-r1-connector-backdrops.md` with these
sections: Start (UTC), Files (path, pre-hash, post-hash via `shasum -a 256`),
Commands (command, exit, counts, log), Pre-change proof, Sibling
diagnostics (non-blocking), Sibling test failures (non-blocking), Drift,
Open issues, Done checklist.
- Do a fresh read and record a pre-hash before each edit, and a post-hash
  after it. Before finishing, re-hash every owned file. If a hash differs
  from your last post-hash, re-read, re-apply your intent and log the drift.
- Foreground commands only. No `git add/commit/stash/checkout` or other git
  writes. Never touch `.reference/`.
- Edit only the writePaths above. bpmn-r2 edits `notation.ts`,
  `svg-export.ts` and their tests at the same time.

## Done checklist (mechanical)

- [x] `grep -n '"bpmn.participant"\|"bpmn.lane"\|"bpmn.group"\|"bpmn.subProcess"' packages/core/src/backdrops.ts` shows the four types
- [x] Verification step 1 log shows the expected pre-change failures
- [x] Verification steps 2, 3 and 4 exit 0
- [x] The step 5 own-path grep prints nothing
- [x] Step 6 has no blocking failure; step 7 exits 0
- [x] `git diff --name-only -- packages/core/src/svg-export.ts packages/ui-solid/src/Canvas.tsx packages/core/src/shapes/connector.ts` is empty
  (met for this plan's edits; `svg-export.ts` changed only through the
  sibling bpmn-r2 plan)
- [x] The progress log is complete
