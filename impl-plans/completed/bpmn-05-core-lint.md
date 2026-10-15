# bpmn-05-core-lint

- planId: bpmn-05-core-lint
- planPath: impl-plans/completed/bpmn-05-core-lint.md
- wave: 2; dependsOn: bpmn-01-ir-core-contract
- design: design-docs/specs/design-bpmn.md sections 7.1, 7.2, 7.3, 13
  (own wording, bpmnlint rule ids and recommended severities), 14 (rule
  semantics risk)
- progress log: impl-plans/progress/bpmn-05-core-lint.md
- protocol: follow impl-plans/completed/bpmn-00-overview.md "Per-worker
  protocol".

## Completion (session-359)

- Status: COMPLETE. Implemented in session-359 and accepted through
  test-integrity, adversarial and branch-evidence review; archived to
  `impl-plans/completed/` in Step 8.
- Final verification: the session-359 serial integration review
  (comm-006269) passed on the combined tree: whole-repo
  `bun run typecheck`, `bunx biome check .` (515 files), `bun test`
  (1838 pass, 0 fail), cargo check/fmt/dialogs tests, the desktop build
  and gates FV1-FV7. Evidence (local, untracked):
  `tmp/bpmn-operation-flow-s359/reconcile-wave5-s359/reconcile-summary.md`.
- The session-359 status section below is the historical dispatch-time
  status.

## Session-359 status and gate: read this first

- Status: PARTIAL, continue. The s357 worker was terminated after a
  network outage. Its work is in the working tree, uncommitted. Never
  revert, regenerate, `git checkout`, `git stash` or delete it. Follow
  the overview's "Continuation (session-359)" resume rules.
- Already present (re-read and inventory, do not rewrite):
  `packages/core/src/bpmn/lint/` with `index.ts`, `engine.ts`,
  `config.ts`, `rules.ts`, `test-builder.ts`, `engine.test.ts`,
  `config.test.ts`, `rules.test.ts`. Intent notes:
  `tmp/bpmn-operation-flow-s357/bpmn-05-core-lint/edit-001-intent.md` ..
  `edit-011-intent.md`. Check that all 23 rule ids are implemented and
  each has a positive and a negative test.
- Last observed own diagnostics (re-run G1 because they may be stale):
  - `lint/engine.test.ts`: nine TS2783 "'id' is specified more than once"
    at lines 14, 15, 17 and 28-33.
  - `lint/engine.ts`: unused `BpmnLintRuleId`.
- `packages/core/src/bpmn/index.ts` already contains
  `export * from "./lint/index.ts";`. Append it only if missing.
  `lint/index.ts` must not re-export `test-builder.ts`.
- Create `impl-plans/progress/bpmn-05-core-lint.md` with an "Inventory
  (session-359)" section first.
- G1 ownRegex: `^packages/core/src/bpmn/lint/`. Shared path
  `packages/core/src/bpmn/index.ts` follows G1 step 5: this plan owns
  the `lint/index.ts` line.
- Focused owned test (strictly blocking):
  `bun test packages/core/src/bpmn/lint`. G2 applies to
  `bun test packages/core`.
- Evidence: `tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/`.

## Intent

A bpmnlint-equivalent static analyser in `@nodetto/core`: the 23 rule ids of
bpmnlint, recommended severities, `.bpmnlintrc`-style config, deterministic
findings. The CLI (bpmn-12) and the desktop problems panel (bpmn-11)
consume it. Behaviour is ported from bpmnlint's documented semantics as
pinned in design 7.3, never from its source text. Messages are nodetto's
own wording.

## Non-goals

- No CLI, UI or file IO here. No fixture-file tests (bpmn-13 runs the four
  fixture outcomes because the fixtures are `.bpmn` and need the io
  importer).
- No plugin support (`plugin:*` extends is a config error).
- Rule options are accepted and ignored.

## writePaths

- packages/core/src/bpmn/lint (new directory: `index.ts`, `engine.ts`,
  `config.ts`, `rules.ts`, `test-builder.ts`, `engine.test.ts`,
  `config.test.ts`, `rules.test.ts`)
- impl-plans/progress/bpmn-05-core-lint.md

## sharedPaths

- packages/core/src/bpmn/index.ts: append exactly
  `export * from "./lint/index.ts";` (fresh-read and pre/post hash rule).
  `lint/index.ts` must not re-export `test-builder.ts`.

## Contracts (pinned; bpmn-11, bpmn-12, bpmn-13, bpmn-14 rely on them)

```ts
export const BPMN_LINT_RULE_IDS: readonly BpmnLintRuleId[]; // the 23 ids below, in this order
export type BpmnLintRuleId = "label-required" | "no-implicit-end" | ... ;
export type BpmnRuleSetting = "off" | "warn" | "error";
export type BpmnLintSeverity = "error" | "warning";
export interface BpmnLintConfig { readonly rules: Readonly<Record<BpmnLintRuleId, BpmnRuleSetting>> }
export function recommendedLintConfig(): BpmnLintConfig;
export class BpmnLintConfigError extends Error {}
export function parseLintConfig(text: string): BpmnLintConfig; // throws BpmnLintConfigError
export interface BpmnLintFinding {
  readonly ruleId: BpmnLintRuleId;
  readonly severity: BpmnLintSeverity;
  readonly elementId: string;   // element id, or the page id for the implicit process
  readonly message: string;
}
export interface BpmnLintContext { readonly missingDi?: readonly string[] }
export function lintBpmnPage(document: Document, pageId: PageId, config?: BpmnLintConfig, context?: BpmnLintContext): readonly BpmnLintFinding[];
export function bpmnLintRuleDescription(ruleId: BpmnLintRuleId): string; // one-line original description, used by docs
```

Rule ids in order: label-required, no-implicit-end, no-implicit-start,
start-event-required, end-event-required, no-disconnected,
conditional-flows, no-duplicate-sequence-flows, no-gateway-join-fork,
no-implicit-split, single-blank-start-event, single-event-definition,
superfluous-gateway, fake-join, no-complex-gateway, no-inclusive-gateway,
no-overlapping-elements, superfluous-termination,
sub-process-blank-start-event, event-sub-process-typed-start-event,
link-event, ad-hoc-sub-process, no-bpmndi.

Recommended: `warn` for fake-join, no-overlapping-elements,
superfluous-gateway, superfluous-termination; `error` for all others.
`bpmnlint:all`: every rule `error`.

## File-level changes

### lint/config.ts

`parseLintConfig(text)` per design 7.2:
- invalid JSON, non-object root -> `BpmnLintConfigError`
- `extends`: string or array of `"bpmnlint:recommended"`, `"recommended"`,
  `"bpmnlint:all"`; applied in order (later wins); absent -> all rules off
  except what `rules` enables (bpmnlint behaviour). Any other value
  (including `plugin:*`) -> error naming the value.
- `rules`: rule id -> `"off" | "warn" | "error" | 0 | 1 | 2` or
  `[severity, options]`; numeric 0/1/2 map to off/warn/error. Unknown rule
  id or invalid severity -> error naming it.
- The CLI uses `recommendedLintConfig()` when no config file exists.

### lint/engine.ts

- Build `buildBpmnModel(document, pageId)` once; run each enabled rule;
  map `warn` -> `"warning"`.
- Sort findings by the element's position in `model.order` (page-id
  findings first), then rule id, then message. Remove exact duplicates.

### lint/rules.ts

One function per rule, `(model, context) => {elementId, message}[]`,
implementing the semantics table of design 7.3 exactly, including:
- "flow node" = activity, event (incl. boundary), gateway.
- Exempt nodes for no-implicit-start, no-implicit-end and no-disconnected:
  boundary events, `forCompensation` activities, event sub-processes
  (`triggeredByEvent`), and nodes whose scope is an ad-hoc sub-process;
  plus link catch events (no-implicit-start) and link throw events
  (no-implicit-end).
- Only sequence flows count as incoming/outgoing (`model.incoming`/
  `outgoing`); message flows never do.
- label-required exemptions: parallel and event-based gateways, gateways
  with at most one outgoing flow, boundary events, unconditioned sequence
  flows. Applies to flow nodes, participants and lanes, and conditional
  sequence flows; empty or whitespace-only `name` counts as missing.
- start-event-required / end-event-required: every scope from
  `model.scopes()` except ad-hoc sub-processes (event sub-processes are
  checked like other sub-processes); a finding reports the scope id (the
  participant or sub-process id); the implicit page process reports the
  page id and is checked only when it has flow nodes; collapsed pools are
  not scopes.
- no-overlapping-elements: visible flow nodes (not `visual.hidden`) in the
  same scope whose boxes intersect with positive area; exempt boundary
  event + host, and expanded sub-process + its descendants; report the
  later element in `model.order`.
- link-event: link name = `linkName ?? name`; empty name; throw without a
  matching catch in its scope; duplicate catch names in one scope.
- no-bpmndi: one finding per id in `context.missingDi` that exists on the
  page.

### lint/test-builder.ts

A small test-only helper that builds a valid `Document` with one `bpmn`
page from compact specs (pool, lanes, nodes with type/position/
definitions/bounds, flows). Used by the rule tests only.

## Pitfalls

- Message flows between pools must not satisfy no-implicit-start/end.
- An unnamed exclusive gateway with two outgoing flows is reported by
  label-required; a joining exclusive gateway (one outgoing) is not.
- Do not report label-required on text annotations, groups, data objects
  or data stores.
- Determinism: never iterate a `Set`/`Map` built from unsorted input
  without sorting by `model.order`.
- The draft fixture outcome (bpmn-13) requires exactly three findings;
  over-eager rules (overlap on labels, label-required on unnamed sequence
  flows without conditions) would break it.

## Tests (input -> expected)

`rules.test.ts`: for every one of the 23 rules, at least one positive case
(finding with the expected element id) and one negative case (no finding
of that rule), built with `test-builder.ts`. Required specific cases:
- article-equivalent mini draft: one pool, unnamed user task with an
  incoming flow and no outgoing, a message throw with no incoming ->
  exactly label-required + no-implicit-end on the task, no-implicit-start
  on the throw event
- two pools connected only by a message flow, each with start -> task ->
  end -> no findings
- boundary event with no incoming -> no no-implicit-start
- gateway 1 in / 1 out -> superfluous-gateway with severity "warning"
- task with two plain outgoing flows -> no-implicit-split
- task with one conditional and one plain outgoing -> conditional-flows on
  the plain one
- two identical flows -> no-duplicate-sequence-flows on the second
- terminate end event in a scope without concurrency -> superfluous-
  termination; with a parallel split -> none
- page with no participants and flow nodes but no start -> start-event-
  required on the page id
- `missingDi: ["Task_1"]` -> no-bpmndi on Task_1; JSONL-built page without
  context -> no no-bpmndi

`config.test.ts`:
- `{"extends": "bpmnlint:recommended", "rules": {"label-required": "off",
  "fake-join": "error"}}` -> label-required off, fake-join error, others
  recommended
- `{"extends": "plugin:foo/recommended"}` -> BpmnLintConfigError
- `{"rules": {"no-such-rule": "error"}}` -> BpmnLintConfigError
- `{"rules": {"label-required": ["warn", {"x": 1}]}}` -> warn
- `"not json"` -> BpmnLintConfigError
- numeric 0/1/2 -> off/warn/error

`engine.test.ts`:
- findings ordered by element index, then rule id; stable across two runs
- `warn` setting -> severity `"warning"`; `off` -> no findings for it

## Verification

```
cd /Users/taco/gits/tacogips/nodetto-app-bpmn
bun run typecheck > tmp/bpmn-operation-flow-s359/bpmn-05-core-lint/typecheck.log 2>&1   # gate G1 (overview): no ownRegex match, no unattributed "error TS" line; exit code recorded
bunx biome check packages/core/src/bpmn/lint       # exit 0
bun test packages/core/src/bpmn/lint               # exit 0, >= 46 rule tests (23 x positive/negative)
bun test packages/core                             # exit 0
```

## Done criteria

- `BPMN_LINT_RULE_IDS.length === 23` (asserted in a test).
- Every rule id string appears in `rules.test.ts`
  (`for r in <ids>; do grep -q "\"$r\"" packages/core/src/bpmn/lint/rules.test.ts || echo missing $r; done`
  prints nothing).
- `packages/core/src/bpmn/index.ts` has the lint line once.
- Exit codes and test counts in the progress log.
