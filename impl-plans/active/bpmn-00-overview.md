# BPMN operation flow: implementation plan overview

Source of truth: `design-docs/specs/design-bpmn.md` (accepted in Step 3,
comm-006079). User decisions with defaults are in
`design-docs/user-qa/bpmn-operation-flow.md` (Q1-Q3). Implement the
defaults: lane delete cascades (Q1), desktop lint always uses recommended
(Q2), `SCHEMA_VERSION` stays 1 (Q3).

Issue: no GitHub issue. Workflow input "BPMN 2.0 operation flow (business
process) diagrams in diagra" (comm-006074 .. comm-006079), workflow
execution `opus-luna-design-and-implement-review-loop-session-356`.

Branch: `feat/bpmn-operation-flow` only. No worktrees, no private branches,
no concurrent git operations by workers. The design and all plans are
committed (orchestrator, serial) before the implementation fanout starts.

## User intent (one paragraph)

diagra users author BPMN 2.0 operation flows the way the Future Tech Blog
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

Plan files: `impl-plans/active/<planId>.md`.

Mapping to design section 12 slices: slice 1 = bpmn-01 (plus core model,
shape utils), slice 2 = bpmn-03 (the ui-solid `reconnect` delegation is in
bpmn-09 because it edits `interaction.ts`), slice 3 = bpmn-04, slice 4 =
bpmn-05, slice 5 = bpmn-02 + bpmn-06, slice 6 = bpmn-07, slice 7 =
bpmn-08..11, slice 8 = bpmn-12, slice 9 = bpmn-15, slice 10 = bpmn-14.
Cross-package fixture tests (lint outcomes, SVG structure, reference lint
multisets) are bpmn-13, because `@diagra/io` cannot import `@diagra/core`
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
2. Check `packages/core/src/bpmn/index.ts` has every expected export line
   exactly once.
3. Repair drift serially, then commit the wave on `feat/bpmn-operation-flow`
   with explicit paths (never `git add -A`, never `.reference/`).
4. Move finished plans to `impl-plans/completed/` only at final
   finalization.

## Global invariants (every plan)

- Existing page kinds (freeform, erd, uml, sequence, architecture),
  fixtures and tests stay unchanged and passing. `SCHEMA_VERSION` stays 1
  and no migration is registered.
- Editor legality checks live only in Editor intent methods; never in
  `applyCommands`, `Editor.apply` command validation, History, clipboard,
  imports or collab paths (design 4.3).
- No new npm or cargo dependencies. No bpmn.io packages. No XML library.
  `bun.lock` must not change except for the `@diagra/io` package.json
  `exports` edit, which does not touch the lockfile.
- Nothing from `.reference/` is copied into the repository: no labels,
  ids, text, geometry or files. All fixtures are original (bpmn-02).
- No emojis anywhere. Strict TypeScript (no `any`, no `@ts-ignore`).
  Biome style: 2-space indent, double quotes.
- No PNG/PDF export and no generic `diagra-cli export` command.
- No version bumps, tags, main-branch pushes, releases or Homebrew changes.
- Public repo: no server code, auth, secrets, endpoints or deploy config.

## Final verification (orchestrator, after wave 4)

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
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
grep -rlP '[^\x00-\x7F]' packages/*/src/bpmn apps/cli/src docs/bpmn design-docs impl-plans   # no output
git status --short | grep -c '.reference'   # 0
```
