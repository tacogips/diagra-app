# BPMN operation flow: implementation plan overview

Source of truth: `design-docs/specs/design-bpmn.md` (accepted in Step 3,
comm-006079; section 11.1 rule 3 added in session-359 and accepted in
comm-006134). User decisions with defaults are in
`design-docs/user-qa/bpmn-operation-flow.md` (Q1-Q3). Implement the
defaults: lane delete cascades (Q1), desktop lint always uses recommended
(Q2), `SCHEMA_VERSION` stays 1 (Q3).

Issue: no GitHub issue. Workflow input "BPMN 2.0 operation flow (business
process) diagrams in nodetto" (comm-006074 .. comm-006079), workflow
execution `opus-luna-design-and-implement-review-loop-session-356`.

Branch: `feat/bpmn-operation-flow` only. No worktrees, no private branches,
no concurrent git operations by workers. The design and all plans are
committed (orchestrator, serial) before the implementation fanout starts.

## Completion (session-359)

- Status: COMPLETE. All 15 plans (bpmn-01 .. bpmn-15) are implemented and
  accepted. This overview and every plan were moved to
  `impl-plans/completed/` in Step 8; see `impl-plans/README.md`.
- Final verification: the session-359 serial integration review
  (comm-006269, wave-5 join) passed on the combined tree: whole-repo
  `bun run typecheck`, `bunx biome check .` (515 files), `bun test`
  (1838 pass, 0 fail), cargo check/fmt/dialogs tests (9 passed), the
  desktop build and gates FV1-FV7. Evidence (local, untracked):
  `tmp/bpmn-operation-flow-s359/reconcile-wave5-s359/reconcile-summary.md`.
- User-facing docs: README "BPMN operation flows" and CLI sections,
  `packages/io/README.md` "BPMN 2.0 XML", and `docs/bpmn/`.
- The continuation sections below record each session's dispatch-time
  state and are historical. The s356, s357 and s359 dispatch manifests
  stay in `impl-plans/active/` as historical dispatch records; their
  `planPath` values name the pre-archive locations.

## Continuation (session-359): read this first

Workflow execution `opus-luna-design-and-implement-review-loop-session-359`
(intake comm-006132, design comm-006133, design review comm-006134).
The design is unchanged except for design-bpmn.md section 11.1 rule 3
(parallel-wave gate). This revision changes only plan status and the
implementation-phase gate. Tasks, writePaths, contracts and tests of every
plan are unchanged.

Plan status at the start of session-359:

| planId | status | what the worker does |
|---|---|---|
| bpmn-01-ir-core-contract | COMPLETE (accepted by the s357 wave-1 integration review, `tmp/bpmn-operation-flow-s357/reconcile-wave1-r2/reconcile-summary.md`) | not dispatched; never reimplemented |
| bpmn-02-fixtures | COMPLETE (same review) | not dispatched; never reimplemented |
| bpmn-03-core-editing | PARTIAL, continue | resume from the working tree |
| bpmn-04-core-notation-svg | PARTIAL, continue | resume from the working tree |
| bpmn-05-core-lint | PARTIAL, continue | resume from the working tree |
| bpmn-06-io-bpmn-xml | PARTIAL, continue | resume from the working tree |
| bpmn-07-collab | IMPLEMENTED, awaiting gate | re-run verification under gates G1/G2 only |
| bpmn-08 .. bpmn-15 | NOT STARTED | implement the plan |

Resume rules for PARTIAL and IMPLEMENTED plans:
- The s357 workers for 03/04/05/06 were terminated after a network outage.
  Their files are in the working tree, uncommitted. Never revert,
  regenerate, `git checkout`, `git stash` or delete them. Re-read each
  owned file, inventory it against the plan's "File-level changes",
  "Tests" and "Done criteria", and finish only what is missing or wrong.
- Read the earlier worker's intent notes first:
  `tmp/bpmn-operation-flow-s357/<planId>/edit-intent*.md` and the logs
  beside them. They describe edits that may be half applied.
- 03/04/05/06 have no progress log yet. Create
  `impl-plans/progress/<planId>.md` with the usual sections and a first
  "Inventory (session-359)" section: each owned path, its sha256 at
  resume, and per plan task one of done / partial / missing.
- bpmn-07 already has a progress log. Append a "Resume (session-359)"
  section. Do not delete earlier sections.
- Evidence for this session goes under `tmp/bpmn-operation-flow-s359/<planId>/`.
  The s356 and s357 evidence directories stay as they are.

### Parallel-wave gate (design 11.1 rule 3), applies to every plan

In every plan's "Verification" block, the `bun run typecheck` line and
every `bun test` line other than the focused owned-test line are
evaluated with the gates below, not with a bare "exit 0". The focused
owned-test line (design 11.1 rule 1) stays strictly blocking.

Gate G1, owner-scoped typecheck:
1. Run `bun run typecheck > tmp/bpmn-operation-flow-s359/<planId>/typecheck.log 2>&1`
   and record the exit code.
2. tsc prints one diagnostic per line as `<path>(<line>,<col>): error TS<n>: ...`.
   Run `grep -E '<ownRegex>' tmp/bpmn-operation-flow-s359/<planId>/typecheck.log`
   with the plan's `ownRegex` (in the plan's session-359 block). It must
   print nothing. Any match blocks the plan.
3. A line that starts with `error TS` has no file and cannot be attributed.
   It blocks the plan.
4. Every other diagnostic is listed in the progress log under "Sibling
   diagnostics (non-blocking)" with its path and TS code, and classified:
   - in a file owned by another plan of the same or a later wave:
     non-blocking, routed to that owner at reconciliation;
   - in a file owned by no plan or by a COMPLETE plan: check whether that
     file imports a module in your writePaths and the diagnostic names a
     symbol you added, removed or changed. If yes, it is yours and it
     blocks. If no, it is non-blocking and routed at reconciliation.
5. For a shared path (`packages/core/src/bpmn/index.ts`,
   `packages/core/src/shapes/connector.ts`) a diagnostic belongs to the
   plan that owns the line it points at: an `export * from` line belongs
   to the plan that appended it, and a `connectorDecoration` or
   `connectorDefaultDash` `bpmn.*` branch belongs to bpmn-04. A
   diagnostic on another plan's line is non-blocking for you.

Gate G2, owner-scoped package and whole-repo tests:
1. The focused owned `bun test <owned files>` line must exit 0 with a
   positive pass count and 0 failures. No exception.
2. Every broader `bun test ...` line is run as
   `bun test ... > tmp/bpmn-operation-flow-s359/<planId>/<name>.log 2>&1`,
   and its exit code and pass/fail counts are recorded.
3. If it fails, list the failing test files. bun prints a `<file>:` header
   line before each file's results. One idiom (check the result against
   the log):
   `awk '/ fail$|tests? failed:$/{exit} /\.test\.tsx?:$/{f=$0} /^\(fail\)/{print f}' <log> | sort -u`.
4. A failing test file in your writePaths blocks. A failing file owned by
   no plan or by a COMPLETE plan blocks when the failure is caused by your
   change (same import test as G1 step 4). Any other failing file is
   recorded under "Sibling test failures (non-blocking)" with its path and
   failing test names.

Whole-repo `bun run typecheck`, `bunx biome check .` and `bun test` are
mandatory and strictly blocking at the orchestrator's serial
reconciliation after every wave and at final verification. Every failure
found there is routed to the plan that owns the file, or by G1 step 4 to
the plan whose change caused it.

### Waves for session-359

The wave numbers are unchanged. Wave 1 is accepted, so the run starts at
wave 2. Every wave-2 dependency (bpmn-01, bpmn-02) is satisfied by COMPLETE
status.
- Wave 2: bpmn-03, bpmn-04, bpmn-05, bpmn-06 (continue), bpmn-07 (re-gate)
- Wave 3: bpmn-08 .. bpmn-14
- Wave 4: bpmn-15

Dispatch manifest: `impl-plans/active/bpmn-operation-flow-s359-dispatch.json`
(task id `bpmn-operation-flow-s359`, evidence root
`tmp/bpmn-operation-flow-s359`). The s356 and s357 manifests are
historical and must not be dispatched. In it, bpmn-01 and bpmn-02 are
listed in `acceptedPlanIds` and are not dispatched.

Pre-fanout commit (orchestrator, serial, before wave 2 starts): commit on
`feat/bpmn-operation-flow` with explicit paths only (never `git add -A`,
never `.reference/`):
- `design-docs/specs/design-bpmn.md`
- `impl-plans/active/*.md`
- the s359 manifest
- the accepted wave-1 paths: bpmn-01 and bpmn-02 writePaths, including
  their progress logs

`packages/core/src/bpmn/index.ts` and `packages/core/src/shapes/connector.ts`
are bpmn-01 writePaths that already contain wave-2 lines. They are
committed as they are in the working tree, with no partial staging. Wave-2
partial files stay uncommitted until the wave-2 join.

## Continuation (session-357)

Wave 1 of session-356 ended blocked on ownership, not on code defects.
The working tree holds the uncommitted wave-1 implementation of bpmn-01 and
bpmn-02 and their progress logs. This revision (design-bpmn.md sections
3.5, 11 and 11.1) changes only test ownership and verification:
- bpmn-01 also owns `packages/ir/src/registry.test.ts`,
  `packages/io/src/jsonl/golden.test.ts` and the new
  `packages/io/src/__fixtures__/bpmn.jsonl`.
- bpmn-02 also owns `packages/io/src/__fixtures__/bpmn/fixtures.test.ts`.
- bpmn-14 also owns `packages/core/src/bpmn/docs-example.test.ts` and no
  longer runs the CLI as a gate.
- Every plan's verification starts with a focused `bun test` over its
  owned tests.
- `grep -P` is replaced with a portable ASCII check.

Redispatch rules:
- Wave 1 is re-run as a continuation. Workers keep the existing files and
  progress logs and append a "Resume" section. Never revert, regenerate,
  `git checkout` or `git stash` wave-1 work.
- The orchestrator commits wave 1 (code and progress logs) only after both
  wave-1 plans pass, and before wave 2 starts.
- Evidence for this session goes under `tmp/bpmn-operation-flow-s357/`.
  The session-356 evidence under `tmp/bpmn-operation-flow-s356/` stays as
  is.

## Test ownership contract (design 11.1)

1. Every plan owns at least one bun test file and lists a focused
   `bun test <owned files>` command that reports a positive pass count and
   0 failures. Shell, grep, xmllint and cargo checks do not count toward
   this.
2. Existing tests or fixtures that pin a list a plan changes are owned by
   exactly one plan:

| existing test / fixture | owner | action |
|---|---|---|
| packages/ir/src/registry.test.ts | bpmn-01 | extend the expected type list |
| packages/io/src/jsonl/golden.test.ts plus new packages/io/src/__fixtures__/bpmn.jsonl | bpmn-01 | append `"bpmn"` to `GOLDEN`; add the canonical golden file |
| packages/ui-solid/src/Toolbar.test.ts | none (bpmn-09 must keep it unedited) | BPMN tools go in a separate `BPMN_TOOL_MENU` |
| packages/ui-solid/src/interaction.test.ts, viewer-actions.test.ts | none (bpmn-09 must keep them unedited) | generic `TOOLS` loops; BPMN tools pass them |
| packages/collab/src/ydoc.test.ts | none (bpmn-07 must keep it unedited) | loops `allFixtures()` with no count |
| apps/cli/src/commands.test.ts | none (bpmn-12 must keep it unedited) | no USAGE-text assertions |
| apps/desktop/src/seed.test.ts | none | no plan changes the seed |
| apps/desktop/src-tauri/src/dialogs.rs tests | bpmn-15 (same file) | they do not pin `OPEN_FILTER_EXTENSIONS` |

There are no snapshot files and no Tauri config or File-menu tests.
A worker that finds another failing pinned-list test stops, records it
under Open issues and does not edit it. The orchestrator re-assigns it
serially.

Portable ASCII check (macOS BSD grep has no `-P`):
`! LC_ALL=C grep -rl '[^[:print:][:space:]]' <paths>`. It exits 0 when
every byte is printable ASCII or whitespace.

## User intent (one paragraph)

nodetto users author BPMN 2.0 operation flows the way the Future Tech Blog
article does with bpmn.io: typed BPMN elements stored semantically in JSONL,
BPMN-correct editing, a bpmnlint-equivalent linter in the editor and the
CLI, BPMN 2.0 XML import/export interoperable with bpmn.io, BPMN rendering
in the shared SVG export, and AI-ready documentation with an original
purchase-request example.

## Plans and waves

| wave | planId | dependsOn |
|---|---|---|
| 1 | bpmn-01-ir-core-contract | none |
| 1 | bpmn-02-fixtures | none |
| 2 | bpmn-03-core-editing | bpmn-01 |
| 2 | bpmn-04-core-notation-svg | bpmn-01 |
| 2 | bpmn-05-core-lint | bpmn-01 |
| 2 | bpmn-06-io-bpmn-xml | bpmn-01, bpmn-02 |
| 2 | bpmn-07-collab | bpmn-01 |
| 3 | bpmn-08-ui-solid-views | bpmn-04 |
| 3 | bpmn-09-ui-solid-palette | bpmn-03 |
| 3 | bpmn-10-ui-solid-inspector | bpmn-03 |
| 3 | bpmn-11-ui-solid-problems-panel | bpmn-03, bpmn-05, bpmn-06 |
| 3 | bpmn-12-cli | bpmn-04, bpmn-05, bpmn-06 |
| 3 | bpmn-13-core-integration-tests | bpmn-03, bpmn-04, bpmn-05, bpmn-06 |
| 3 | bpmn-14-docs | bpmn-05, bpmn-06 |
| 4 | bpmn-15-desktop | bpmn-04, bpmn-06, bpmn-11 |

Plan files: `impl-plans/completed/<planId>.md` (archived after final
verification; `impl-plans/active/<planId>.md` during implementation).

Mapping to design section 12 slices: slice 1 = bpmn-01 (plus core model,
shape utils), slice 2 = bpmn-03 (the ui-solid `reconnect` delegation is in
bpmn-09 because it edits `interaction.ts`), slice 3 = bpmn-04, slice 4 =
bpmn-05, slice 5 = bpmn-02 + bpmn-06, slice 6 = bpmn-07, slice 7 =
bpmn-08..11, slice 8 = bpmn-12, slice 9 = bpmn-15, slice 10 = bpmn-14.
Cross-package fixture tests (lint outcomes, SVG structure, reference lint
multisets) are bpmn-13, because `@nodetto/io` cannot import `@nodetto/core`
and only core dev-depends on io.

## Shared files and ownership rules

- `packages/core/src/bpmn/index.ts`
  - Created by bpmn-01 with exactly one line
    `export * from "./model.ts";`.
  - In wave 2, bpmn-03, bpmn-04 and bpmn-05 each append only their own
    `export * from "./<module>.ts";` lines (listed in their plans).
  - Protocol for every edit: re-read the file immediately before editing,
    record its sha256 (`shasum -a 256 <file>`) as the pre-hash, append your
    lines at the end, record the post-hash. Never reorder or delete another
    plan's line. If the content differs from what you expected, re-read and
    append again; never overwrite the file from a stale copy.
- `packages/core/src/shapes/connector.ts`
  - bpmn-01 (wave 1) moves the waypoint math out of it.
  - bpmn-04 (wave 2) adds `bpmn.*` branches to `connectorDecoration` and
    `connectorDefaultDash` only. `MarkerKind` is NOT changed by anyone (it
    keys `Record<MarkerKind, ...>` tables in svg-export.ts and
    ConnectorView.tsx).
- Every other path has exactly one owning plan (see each plan's
  writePaths). Do not edit files outside your writePaths and sharedPaths.
  If you believe another file must change, stop and record it as an open
  issue in your progress log; do not edit it.

## Per-worker protocol (all plans)

1. Before each file edit: fresh read, pre-hash; after: post-hash. Record
   both in the progress log. Before finishing, re-hash every file you own;
   if a hash differs from your last post-hash, someone else changed it:
   re-read, re-apply your intent, and log the drift.
2. Each worker edits only its own progress log at
   `impl-plans/progress/<planId>.md` with sections: Start (UTC time),
   Files (path, pre-hash, post-hash), Commands (exact command, exit code,
   test pass/fail counts, log location), Drift, Open issues, Done
   checklist.
3. Run only foreground commands. No `&`, `nohup`, watchers or dev
   servers. Keep the final exit status of every verification command.
4. Do not run `git add`, `git commit`, `git stash`, `git checkout` or any
   other git write operation. Never `git add -A`: `.reference/` is
   excluded locally and must never be committed.
5. Do not run repo-wide formatters (`biome format --write .`,
   `biome check --write .`). Format only your own files:
   `bunx biome check --write <your files>`.

## Serial reconciliation (orchestrator only, after each wave join)

1. `bun run typecheck`, `bunx biome check .`, `bun test` on the whole repo.
   These are strictly blocking here (design 11.1 rule 3). Route each
   diagnostic or failing test file to the plan that owns the file, or to
   the plan whose change caused it (gate G1 step 4). Use the plans'
   "Sibling diagnostics" and "Sibling test failures" lists as input.
   Repair serially, or redispatch the owning plan with the evidence.
2. Check `packages/core/src/bpmn/index.ts` has every expected export line
   exactly once.
3. After wave 3 only:
   `bun apps/cli/src/main.ts lint docs/bpmn/purchase-request.jsonl` exits
   0 with empty stdout. This was moved out of bpmn-14 because bpmn-12
   builds the CLI in the same wave.
4. Repair drift serially, then commit the wave on `feat/bpmn-operation-flow`
   with explicit paths (never `git add -A`, never `.reference/`).
5. Move finished plans to `impl-plans/completed/` only at final
   finalization.

## Global invariants (every plan)

- Existing page kinds (freeform, erd, uml, sequence, architecture),
  fixtures and tests stay unchanged and passing. `SCHEMA_VERSION` stays 1
  and no migration is registered.
- Editor legality checks live only in Editor intent methods; never in
  `applyCommands`, `Editor.apply` command validation, History, clipboard,
  imports or collab paths (design 4.3).
- No new npm or cargo dependencies. No bpmn.io packages. No XML library.
  `bun.lock` must not change except for the `@nodetto/io` package.json
  `exports` edit, which does not touch the lockfile.
- Nothing from `.reference/` is copied into the repository: no labels,
  ids, text, geometry or files. All fixtures are original (bpmn-02).
- No emojis anywhere. Strict TypeScript (no `any`, no `@ts-ignore`).
  Biome style: 2-space indent, double quotes.
- No PNG/PDF export and no generic `nodetto-cli export` command.
- No version bumps, tags, main-branch pushes, releases or Homebrew changes.
- Public repo: no server code, auth, secrets, endpoints or deploy config.

## Final verification (orchestrator, after wave 4)

```
cd /Users/taco/gits/tacogips/nodetto-app-bpmn
bun run typecheck                      # exit 0
bunx biome check .                     # exit 0
bun test                               # exit 0, 0 fail
bun apps/cli/src/main.ts lint packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn
                                       # exit 1; exactly 3 rows: label-required, no-implicit-end, no-implicit-start
bun apps/cli/src/main.ts lint packages/io/src/__fixtures__/bpmn/purchase-request.bpmn
                                       # exit 0; empty stdout
bun apps/cli/src/main.ts bpmn import .reference/bpmn-article/docs/purchase_request/purchase_request.bpmn > /dev/null
                                       # exit 0 (local only; skipped in CI when .reference is absent)
cmp docs/bpmn/purchase-request.jsonl packages/io/src/__fixtures__/bpmn/purchase-request.jsonl
                                       # exit 0
CARGO_TERM_QUIET=true cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml    # exit 0
CARGO_TERM_QUIET=true cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check   # exit 0
bun apps/cli/src/main.ts lint docs/bpmn/purchase-request.jsonl
                                       # exit 0; empty stdout
! LC_ALL=C grep -rl '[^[:print:][:space:]]' packages/core/src/bpmn packages/io/src/bpmn packages/io/src/__fixtures__/bpmn packages/io/src/__fixtures__/bpmn.jsonl apps/cli/src docs/bpmn design-docs impl-plans   # exit 0, no output
git status --short | grep -c '.reference'   # 0
```
