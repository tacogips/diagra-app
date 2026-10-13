# bpmn-06-io-bpmn-xml progress

## Inventory (session-359)

- Branch: `feat/bpmn-operation-flow`; checkpoint: `b25a9fcf6a222721712cf346478562d3c3971aa8`.
- Runtime dependency gate: acceptedPlanIds contains `bpmn-01-ir-core-contract` and `bpmn-02-fixtures`.
- Preserved partial files found: `xml.ts`, `import.ts`, `export.ts`, `ids.ts`, `equivalence.ts`, `index.ts`, and the XML/import/export/roundtrip/reference test files under `packages/io/src/bpmn/`. The package export change was already present in `packages/io/package.json` and `packages/io/src/index.ts`.
- Working tree contains in-progress sibling changes across core, IR, collab and IO. This plan edited only its assigned IO paths and its progress log.
- Pre-edit owned gate: `bun test packages/io/src/bpmn` reported 3 pass, 6 fail, 23 expects. Complete output is `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/pre-edit-focused.log`; it showed sequenceFlow treated as unsupported, namespace-less exported raw fragments, and serializer whitespace instability.
- Per-edit intentions were recorded before edits in `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/edit-intents-session359.md`.

## Implementation (session-359)

- Completed the dependency-free XML scanner and serializer contract, including whitespace handling for element-only content, preserved mixed-content characters, adjacent text/CDATA merging, bare/unknown entity rejection, namespace resolution, and deterministic output.
- Imported sequence, message, association, and data flows as semantic BPMN elements; default sequence-flow references are collected recursively through nested subprocesses. Existing identity, lanes, DI bounds, routing points, and warnings behavior is retained.
- Preserved unsupported BPMN and foreign XML attributes/children as `bpmnXml` extensions with import warnings; extracted XML fragments carry the namespace bindings required for standalone re-export. Root-level preserved raw XML also reports warnings.
- Exported foreign attributes/children and unsupported raw fragments. Participant process references remain stable across import/export/import.
- Fixed reference-fixture paths to the four local `.reference` files. Added regressions for foreign/unsupported XML, nested default flows, mixed-content whitespace, malformed ampersands, and the canonical JSONL fixture.
- Generated `packages/io/src/__fixtures__/bpmn/purchase-request.jsonl` only with the plan's importer + `serializeDocument` command; `roundtrip.test.ts` pins it byte-for-byte.
- The `@diagra/io` package export is `./bpmn` only; no dependency or lockfile change. `rg` found no `@diagra/core` import in `packages/io/src`; `git status --short .reference` was empty.

## G1/G2 evidence (session-359 current source)

- G1 typecheck: `bun run typecheck` exited 0. Complete log: `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/typecheck-final-r4.log` (`$ tsc --noEmit`, no diagnostics, including no assigned-path diagnostics).
- Owned formatting: `bunx biome check packages/io/src/bpmn packages/io/src/index.ts` exited 0. Log: `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/biome-final-r4.log`.
- G2 focused owned test: `bun test packages/io/src/bpmn` exited 0, 12 pass, 0 fail, 55 expects. Log: `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/focused-final-r4.log`.
- Package gate: `bun test packages/io` exited 0, 150 pass, 0 fail, 1764 expects. Log: `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/io-tests-final-r4.log`.
- Whole test suite: `bun test` exited 0, 1763 pass, 0 fail, 10519 expects. Log: `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/all-tests-final-r4.log`.
- Reference test: `bun test packages/io/src/bpmn/reference.test.ts` exited 0, 1 pass, 0 fail, 8 expects. Log: `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/reference-final-r4.log`. The `.reference/bpmn-article/docs` directory exists, so the test's `skipIf` guard was false and all four files ran locally.
- Export check: `grep -q '"./bpmn": "./src/bpmn/index.ts"' packages/io/package.json` exited 0. `git diff -- packages/io/package.json` touches only the `exports` object. `git diff --stat -- bun.lock` is empty.
- Dependency boundary: `if rg -n '@diagra/core' packages/io/src; then exit 1; else ...; fi` exited 0 with no matches.
- Reference tracking: `git status --short .reference` exited 0 with no output.

## Review and downstream boundary

Implementation-phase criteria for bpmn-06 are complete. The all-repository Biome check, formal test-integrity/adversarial review, serial integration review, explicit-path staging, commit and push remain downstream workflow responsibilities. No approval or commit is claimed here.

## Test-integrity revisions (comm-006176)

- `BPMN06-TI-01`: `collectDi` now keeps `isMarkerVisible` outside `visual`; gateway import writes the flag to semantic data only when XML provided it. Export writes explicit `true` or `false`. `purchase-request.jsonl` was regenerated with the exact plan `bun -e` command, and tests assert semantic true, visual absence, false import/export, and exported true for `Gateway_Approve_di`.
- `BPMN06-TI-02`: both lane mapping and lane element creation traverse `laneSet` and `childLaneSet`; descendant flow-node references override enclosing membership. Nested lane export already followed `lane.parent`; tests now verify child lanes, innermost membership, `childLaneSet`, projection equality and deterministic export bytes.
- `BPMN06-TI-03`: importer indexes process-scope `dataObject` definitions and references before walking content, stores the referenced id in XML extension metadata, reads `isCollection`, and does not warn for a referenced/consumed `dataObject`. Export re-emits the paired definition and reference. Tests verify true collection, no warnings and round-trip retention.
- `BPMN06-TI-04` plan test checklist:
  - XML parser cases: existing `xml.test.ts` covers namespace scope, entities/CDATA/comments, DOCTYPE/unknown entity/malformed/duplicate/depth/truncated errors, deterministic serialization and attribute escaping.
  - Import task mappings: all eight task tags, standard/parallel/sequential multi-instance loops, and compensation flag asserted.
  - Import events: all four event positions, message/timer-duration/link/conditional payloads, timer date and cycle values, error/escalation/cancel/compensation/signal/terminate definitions, and non-interrupting boundary cancellation asserted.
  - Import gateways/flows: all five gateway types, default flow, and true/false marker semantics asserted.
  - Import containment/DI: collapsed participant, nested lanes and innermost membership, subprocess child parent, secondary-plane hidden child, missing-DI report/warning/placement asserted.
  - Import data/artifacts: referenced collection data object, IO specification input/output, data store, annotation, category group, association and input/output associations asserted.
  - Import preservation and original fixture: unsupported/foreign extensions and malformed root remain covered; complete fixture checks 13 flow nodes, 3 lanes, participant, 12 sequence flows, zero warnings, and route.
  - Export: all five namespaces, incoming/outgoing tags, marker true/false, label bounds, deterministic output, pool-less process without collaboration, routeOf rounded coordinates, and NCName mapping asserted.
  - Round trip: all four original BPMN fixtures compare semantic projections and deterministic bytes, visual shape/label bounds and interior waypoint values within 0.5; nested-lane and collection inline samples also assert round-trip behavior. Canonical JSONL remains pinned.
  - Reference: original four `.reference` files are locally imported with zero warnings; per-mapped-tag ID counts, lane flowNodeRef membership, DI bounds and round-trip projection are checked without label/text assertions. Existing skipIf guard is unchanged.
- First post-revision `bun run typecheck` exposed four test-assertion typing errors; they were fixed with narrow `Record<string, unknown>` views. The failed complete log is retained at `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/typecheck-ti-r2.log`; the current-source rerun passed at `typecheck-ti-r4.log`.

## Current-source verification (post-revision)

- `bun run typecheck`: exit 0; log `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/typecheck-ti-r4.log`.
- `bunx biome check packages/io/src/bpmn packages/io/src/index.ts`: exit 0; log `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/biome-ti-r3.log`.
- `bun test packages/io/src/bpmn`: exit 0, 25 pass, 0 fail, 1284 expects; log `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/focused-ti-r3.log`.
- `bun test packages/io/src/bpmn/reference.test.ts`: exit 0, 1 pass, 0 fail, 448 expects; `.reference` was present, so no skip; log `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/reference-ti-r3.log`.
- `bun test packages/io`: exit 0, 163 pass, 0 fail, 2993 expects; log `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/io-tests-ti-r3.log`.
- `bun test`: exit 0, 1783 pass, 0 fail, 11790 expects; log `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/all-tests-ti-r3.log`.
- Contract shell gate confirmed the `./bpmn` package export, no `bun.lock` diff, no tracked `.reference` content, and no `@diagra/core` imports under `packages/io/src` (exit 0).
- No whole-repository Biome run, formal review, integration review, staging, commit or push is claimed; those remain later workflow steps.

## Adversarial revisions (comm-006189, session-359)

- `BPMN06-ADV-01`: exporter writes process-level associations with stable semantic ids, endpoint references and optional `associationDirection`; data input/output associations are nested under their owning task/event with source/target refs. Import now discovers nested association children and uses the enclosing activity for an omitted endpoint. Regression round trips assert endpoint semantics, zero import warnings, equal projections and stable bytes, including a pool-less association.
- `BPMN06-ADV-02`: data objects, stores and artifacts are filtered by their owning participant/process and appear once; pool-less pages retain them in their single process, and unowned content on pooled pages is routed to a warned orphan process. Collapsed participant content produces a warning instead of a silent drop. Two-pool regression checks unique ids for tasks, annotation and paired data-object reference, equal projection and stable export.
- `BPMN06-ADV-03`: `addFlows` walks activity/event children as well as process/subprocess children, preserves process-level fallback, parses nested source/target refs, and defaults the missing endpoint to the containing node. Existing process-level assertions remain. Inline nested input/output associations verify the exact endpoints and warning-free round trip.
- `BPMN06-ADV-04`: process-level flow nodes exclude subprocess descendants; subprocess XML recursively contains child nodes, scoped sequence flows, data and artifacts. Task-parented data inputs/outputs are wrapped in `ioSpecification` with input/output sets and references. Pool and pool-less subprocess round trips preserve projections and bytes; task IO records remain parented.
- `BPMN06-ADV-05`: `collectDi` reads `BPMNShape@isExpanded`, import prefers DI then the legacy semantic attribute, and export writes the boolean on the subprocess BPMNShape. Inline collapsed subprocess test checks `expanded=false` and deterministic second export.
- `BPMN06-ADV-06`: boundary event and group semantic payloads now include the computed parent. Inline pool/lane regression verifies the boundary event belongs to its lane, group belongs to participant Pb, output has no orphan process, and the round trip remains stable. No IR schema changes.
- Added tests only in `packages/io/src/bpmn/roundtrip.test.ts`; existing assertions and the generated JSONL pin remain unchanged. Deterministic DI shape and edge ordering is sorted by semantic id so the normalized BPMN content has identical repeated-export bytes.

### Interim failed attempts retained

- `focused-adv-r2.log`, `io-tests-adv-r2.log`, and `all-tests-adv-r2.log` failed because inline samples injected a message flow with missing endpoints; tests were corrected to omit that unrelated flow for those samples and provide DI for task IO records.
- `typecheck-adv-r2.log` failed on one unused destructured binding; removed from the test.
- `biome-adv-r1.log` failed on formatting only; formatted the three changed BPMN files and then rechecked.
- Earlier failing logs are retained as evidence and are superseded by the source-matched r3/r4 checks below; no unresolved test or type errors remain.

### Current-source adversarial revision verification

- `bun test packages/io/src/bpmn`: exit 0, 30 pass, 0 fail, 1323 expects; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/focused-adv-r3.log`.
- `bun test packages/io`: exit 0, 168 pass, 0 fail, 3032 expects; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/io-tests-adv-r3.log`.
- `bun test`: exit 0, 1788 pass, 0 fail, 11829 expects; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/all-tests-adv-r3.log`.
- `bun run typecheck`: exit 0; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/typecheck-adv-r4.log`.
- `bunx biome check packages/io/src/bpmn packages/io/src/index.ts`: exit 0; 12 files checked; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/biome-adv-r3.log`.
- IO boundary and plan contract checks: no `@diagra/core` import in `packages/io/src`; canonical JSONL exists; package export is present; `bun.lock` is unchanged; `.reference` is untracked. Commands and output: `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/core-boundary-adv-r3.log` (for grep) and shell contract returned exit 0.
- Current implementation and required behavioral verification are complete for this plan. Formal independent test-integrity/adversarial review, serial integration review, exact-file staging, commit and push remain downstream workflow steps and are not claimed here.

### Final self-check follow-up

- Corrected the participant fallback for nodes not listed in a lane: an item in a participant's process now receives `parent: participant` after lane and enclosing-subprocess lookup, even when that process has lanes. This routes unlaned data objects and artifacts to their source process rather than to an orphan. The multi-pool test now has a laned process and asserts unlaned annotation/data-reference parents are `Pa`; the pinned purchase-request fixture contains no data/artifact records, and its pin remains passing.
- Final-current-source verification after this correction:
  - `bun test packages/io/src/bpmn`: exit 0, 30 pass, 0 fail, 1325 expects; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/focused-adv-r4.log`.
  - `bun test packages/io`: exit 0, 168 pass, 0 fail, 3034 expects; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/io-tests-adv-r4.log`.
  - `bun test`: exit 0, 1788 pass, 0 fail, 11831 expects; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/all-tests-adv-r4.log`.
  - `bun run typecheck`: exit 0; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/typecheck-adv-r6.log`.
  - `bunx biome check packages/io/src/bpmn packages/io/src/index.ts`: exit 0, 12 files; `tmp/bpmn-operation-flow-s359/bpmn-06-io-bpmn-xml/biome-adv-r4.log`.
  - IO boundary and contract checks rerun at final source: no `@diagra/core` imports, fixture pin present, package export present, `bun.lock` unchanged, `.reference` untracked; logs `core-boundary-adv-r4.log` and contract shell returned exit 0.
