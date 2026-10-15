# bpmn-04-core-notation-svg progress

## Inventory (session-359)

- Continued the preserved session-357 implementation in place. Existing notation, route, SVG export and tests were read before correction; no sibling files were rewritten.
- `packages/core/src/bpmn/index.ts` retains model, connection, containment and lint exports and contains exactly one notation export and one routes export.
- `MarkerKind` remains the original five values (`arrow`, `triangle`, `diamondOpen`, `diamondFilled`, `dot`). The connector changes beyond bpmn-01's waypoint move are confined to the BPMN branches in `connectorDecoration` and `connectorDefaultDash`.
- Added no dependencies and made no changes to ui-solid or non-BPMN SVG rendering branches.

## Implementation (session-359)

- `notation.ts` provides deterministic renderer-neutral shape and flow primitives with the pinned `bpmn-<role>` classes, text labels, event/task/gateway/data/annotation/group icons and flow decorations.
- `routes.ts` exposes the editor-backed connector waypoint resolver used by BPMN XML export.
- `svg-export.ts` maps shape primitives in local coordinates and flow primitives in page coordinates, and includes external shape and flow labels in export bounds.
- Corrected flow-label fallback placement to the midpoint measured along the connector polyline. Added a bent-route regression test.
- Expanded role tests for task types, collapsed pools, gateways, subprocess markers, event multiple markers, data/annotation/group shapes, default and association flow decorations.
- Initial checks found Biome multi-declaration style violations; these were corrected. An initial core suite run observed one in-progress sibling containment failure; a final rerun passed after sibling updates.

## G1 evidence

- `bun run typecheck` final-source command: exit 2. Its sole diagnostic is `packages/io/src/bpmn/import.ts(10,94): TS6133 'XmlNode' is declared but its value is never read`, owned by bpmn-06. The final log is `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/typecheck-final.log`.
- Owned-path diagnostic gate `! grep -E '^(packages/core/src/bpmn/(notation|notation\.test|routes|routes\.test|svg-export-bpmn\.test)\.ts|packages/core/src/svg-export\.ts)\(' tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/typecheck-final.log`: exit 0, no owned diagnostics.
- Selected-file `bunx biome check packages/core/src/bpmn/notation.ts packages/core/src/bpmn/notation.test.ts packages/core/src/bpmn/routes.ts packages/core/src/bpmn/routes.test.ts packages/core/src/bpmn/svg-export-bpmn.test.ts packages/core/src/svg-export.ts packages/core/src/shapes/connector.ts`: exit 0. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/biome-final.log`.

## G2 evidence

- `bun test packages/core/src/bpmn/notation.test.ts packages/core/src/bpmn/routes.test.ts packages/core/src/bpmn/svg-export-bpmn.test.ts`: exit 0, 6 pass, 0 fail, 52 expect calls. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/focused-tests-final.log`.
- `bun test packages/core`: exit 0, 962 pass, 0 fail, 5,063 expect calls. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/core-tests-final.log`.
- `bun test packages/ui-solid`: exit 0, 276 pass, 0 fail, 1,401 expect calls. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/ui-solid-tests-final.log`.
- Export barrel count checks: notation line once and routes line once. Connector marker-kind table spot check unchanged.

## Handoff

Implementation and owner-scoped verification are complete. The bpmn-06 typecheck diagnostic is non-blocking under design 11.1 rule 3 and is routed to that plan. Formal test-integrity/adversarial/integration review, whole-repository final gates, staging, commit and push remain downstream workflow work.

## Test-integrity repair: TI-04-01

- Updated `packages/core/src/bpmn/svg-export-bpmn.test.ts` without changing the existing role-count assertions. The external-label assertion now renders only one end event and derives its expected bounds from `bpmnLabelBox`.
- Counterfactual check: the event shape bottom is `125 + 36 = 161`; without label inclusion, the SVG bottom with 16 units of padding is 177. The label bottom is `168 + 24 = 192`, so the new `viewBoxBottom > shapeBottom + 16` assertion fails if the `bpmnLabelBox` bounds push is removed. With label inclusion, the viewBox bottom must also be at least 192.
- `bun test packages/core/src/bpmn/svg-export-bpmn.test.ts`: exit 0, 2 pass, 0 fail, 10 expects. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/svg-export-bpmn-ti-04-01.log`.
- Focused three-file BPMN suite: exit 0, 7 pass, 0 fail, 54 expects. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/focused-tests-ti-04-01.log`.
- `bun test packages/core`: exit 0, 965 pass, 0 fail, 5,077 expects. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/core-tests-ti-04-01.log`.
- `bunx biome check packages/core/src/bpmn/svg-export-bpmn.test.ts`: exit 0. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/biome-ti-04-01.log`.
- `bun run typecheck`: exit 0; the owned-path grep also exits 0. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/typecheck-ti-04-01.log`.
- TI-04-01 is addressed in the implementation. Independent test-integrity re-review remains pending.

## Step 6 verification rerun (current source)

The earlier typecheck exit 2 above is historical evidence from the moving
wave tree. This rerun was performed after the TI-04-01 test correction and
the latest sibling edits. The focused suite has a positive test count, which
closes the prior implementation-materially-unverified handoff.

- `bun run typecheck`: exit 0; log `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/typecheck-step6-rerun-1.log`.
- Selected-file Biome command from the plan: exit 0, 7 files checked; log `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/biome-step6-rerun-1.log`.
- `bun test packages/core/src/bpmn/notation.test.ts packages/core/src/bpmn/routes.test.ts packages/core/src/bpmn/svg-export-bpmn.test.ts`: exit 0, 7 pass, 0 fail, 54 expects; log `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/focused-step6-rerun-1.log`.
- `bun test packages/core`: exit 0, 972 pass, 0 fail, 5,119 expects; log `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/core-step6-rerun-1.log`.
- `bun test packages/ui-solid`: exit 0, 276 pass, 0 fail, 1,401 expects; log `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/ui-solid-step6-rerun-1.log`.
- Barrel/marker/connector invariants: exit 0. Notation and routes exports each occur once; `MarkerKind` remains the same five kinds, with BPMN edits limited to `connectorDecoration` and `connectorDefaultDash` beyond the bpmn-01 waypoint move.

## Adversarial repair: BPMN04-ADV-01

- In `packages/core/src/bpmn/notation.ts`, `textPrimitive` now accepts an optional `start`/`middle` anchor, defaulting to `middle`. External event/gateway/data labels use the label-box center (or the shape center for default placement); activity labels are centered except expanded subprocess labels, which are start-anchored at x=8. Group and annotation labels are start-anchored at x=8 and x=18.
- Label-bounds arithmetic follows the shared SVG coordinate contract: the primitive is local to the shape and the SVG group translates it by the shape's page origin. For a shape origin x=110 and label bounds x=100,width=60, the correct local anchor is `100 - 110 + 60/2 = 20`; the rendered page anchor is 130, the bounds center. The review brief's literal local x=40 is inconsistent with its own formula and stated page center; the regression assertion pins the formula and page-space result.
- Added `notation.test.ts` regression assertions for task x=50, default event x=18, label-bounds page center, start anchors for expanded subprocess/group/annotation, and unchanged participant/lane rotation, collapsed participant, and adhoc marker anchors. Existing assertions remain intact.
- Before/after probe: `probe-adv-01-before.log` recorded task 8, default event 0, label-bounds event -10. `probe-adv-01-after-final.log` records task 50, default event 18, and label-bounds local 20/page 130, matching the bounds center.
- Final focused tests: `bun test packages/core/src/bpmn/notation.test.ts packages/core/src/bpmn/routes.test.ts packages/core/src/bpmn/svg-export-bpmn.test.ts`, exit 0, 8 pass/0 fail. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/focused-adv-01-final2.log`.
- Final core suite: `bun test packages/core`, exit 0, 980 pass/0 fail. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/core-adv-01-final2.log`.
- Final ui-solid suite: `bun test packages/ui-solid`, exit 0, 294 pass/0 fail. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/ui-solid-adv-01-final2.log`.
- Final typecheck: `bun run typecheck`, exit 0. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/typecheck-adv-01-final2.log`.
- Selected-file Biome: `bunx biome check packages/core/src/bpmn/notation.ts packages/core/src/bpmn/notation.test.ts packages/core/src/bpmn/routes.ts packages/core/src/bpmn/routes.test.ts packages/core/src/bpmn/svg-export-bpmn.test.ts packages/core/src/svg-export.ts packages/core/src/shapes/connector.ts`, exit 0, 7 files. Log: `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/biome-adv-01-final2.log`.
- The first focused attempt exposed an adhoc assertion selecting the preceding activity label; corrected the assertion to select the marker role. The first typecheck exposed optional `visual.x/y`; corrected with nullish coordinate fallbacks. Final reruns above pass. The intermediate typecheck output, including exit 2, is preserved at `tmp/bpmn-operation-flow-s359/bpmn-04-core-notation-svg/typecheck-adv-01.log`.
