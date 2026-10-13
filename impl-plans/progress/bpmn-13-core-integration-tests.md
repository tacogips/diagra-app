# bpmn-13 core integration tests progress

Status: implementation complete; current-source implementation gates pass. Formal test-integrity and adversarial review remain downstream. No production source was edited.

## Inventory and ownership

The runtime dispatch admitted this plan: `acceptedPlanIds` includes `bpmn-03-core-editing`, `bpmn-04-core-notation-svg`, `bpmn-05-core-lint` and `bpmn-06-io-bpmn-xml`, all `dependsOn` entries. The latest pre-node snapshot `tmp/riela-fanout/6C23974F-AC5B-4F9E-9F91-156F3D5D90FE/15371BB4-00FA-4A96-8BAE-753CABB98E61.json` records the three assigned source paths missing. Only the two test writePaths and this progress path were created.

Source identities at final verification:

| Path | SHA-256 |
|---|---|
| `packages/core/src/bpmn/fixtures.test.ts` | `f7ec8e4e2a4f59d3124535968da10ab0b93e37e2cded1d537b8f7b601dadb52d` |
| `packages/core/src/bpmn/reference-lint.test.ts` | `931a69d0a5e5db7523e5fa82720ef05b5f7fe70c75846b5ddaa24e49ddeee5cf` |
| `impl-plans/progress/bpmn-13-core-integration-tests.md` | `cdb88f20f93eacaaba06a8b6f69f851d51ed0dd61ce443501faafe9f275e46de` before this final identity refresh |

## Acceptance criteria

- Complete, swapped and inverted local fixtures have no recommended lint findings: covered in `fixtures.test.ts`.
- Draft local fixture has exactly the three pinned `[ruleId, elementId]` pairs at error severity: covered in `fixtures.test.ts`.
- Complete local fixture SVG pins required role class counts, YES/NO labels, and all four edges of every imported `visual.labelBounds` box within the SVG viewBox: covered in `fixtures.test.ts`.
- `connectBpmn` from `End_PurchaseComplete` to `Task_SubmitRequest` returns `bpmn.connection.endEventOutgoing`: covered in `fixtures.test.ts`.
- Reference rule-id multisets are tested when `.reference/bpmn-article/docs` is present, skipped when absent, and no reference message, text or element id is asserted. The local suite ran all four reference files.
- No production code changed. `! grep -n 'Office supply\|Submit purchase' packages/core/src/bpmn/reference-lint.test.ts` exits 0.

## Verification evidence

All log paths below are complete and plan-local under `tmp/bpmn-operation-flow-s359/bpmn-13-core-integration-tests/`.

| Command | Result |
|---|---|
| `bun test packages/core/src/bpmn/fixtures.test.ts packages/core/src/bpmn/reference-lint.test.ts` | `focused-final-current.log`: current-source exit 0; 9 pass, 0 fail, 65 expects. Four local reference tests ran; none skipped. |
| `bunx biome check packages/core/src/bpmn/fixtures.test.ts packages/core/src/bpmn/reference-lint.test.ts` | `biome-final-current.log`: current-source exit 0; checked 2 files, no fixes. |
| `bun run typecheck` | `typecheck-final-current.log`: current-source exit 0; no diagnostics. Earlier intermediate typecheck failures are retained in their original logs. |
| `bun test` | `fulltest-final-current.log`: current-source exit 0; 1,838 pass, 0 fail, 12,202 expects across 211 files. This resolves the prior moving-tree bpmn-15 sibling failure below. |
| `! grep -n 'Office supply\|Submit purchase' packages/core/src/bpmn/reference-lint.test.ts` | `reference-text-check-current.log`: exit 0; no reference labels in the test. |

## Attempt notes

- `focused-initial.log` contains a successful 9/0 Bun test run; its first zsh wrapper did not capture the exit because it attempted to assign the readonly zsh variable `status`. The same command was rerun with a safe variable and captured in `focused-r1.log`, `focused-final.log` and `focused-final-r2.log`, all exit 0.
- `biome-r1.log` records a formatting-only exit 1 before formatting. `biome-format-r1.log` records Biome formatting only the two assigned test files (exit 0); the final owned-file Biome check is green.
- `typecheck-r1.log` predates formatting and records CLI and desktop TS6133 diagnostics. `typecheck-final.log` records only the two CLI diagnostics. The final-source `typecheck-final-r2.log` is green.
- The earlier `bun-test-r1.log` passed on an earlier moving-tree state (1,823/0 across 209 files). `bun-test-final-r2.log` then exposed a bpmn-15-owned assertion mismatch (expected 13 flow nodes, observed 17; 1,832 pass, 1 fail). The current-source `fulltest-final-current.log` exits 0 after the shared tree was updated; this historical failure is superseded and is not an open issue.
- A bounded author self-check and independent read-only review found that the first viewBox test checked only the lowest label's bottom edge. It was corrected to assert all four edges for every imported `visual.labelBounds` box. `focused-final-r2.log` passes 9/0 with 65 expects on the corrected source.

## Open issues and downstream work

- No bpmn-13 production issue found; no weakening or expectation changes were needed.
- No open bpmn-13 or sibling issue is known from current-source verification. The historical bpmn-15 mismatch above is resolved on the current shared tree.
- Serial integration remains responsible for the final combined committed-tree checks and routing any remaining sibling diagnostics. Test-integrity/adversarial review, review-dependent plan completion status, explicit-path commit and push belong to later workflow steps.
