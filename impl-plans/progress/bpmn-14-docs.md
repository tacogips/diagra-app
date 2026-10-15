# bpmn-14-docs progress

- Workflow mode: `issue-resolution`.
- Issue reference: no GitHub issue; workflow input `Continue (2): BPMN 2.0 operation flow (business process) diagrams in nodetto`, session-359. Assigned plan: `impl-plans/active/bpmn-14-docs.md`.
- Dependency readiness: `bpmn-05-core-lint` and `bpmn-06-io-bpmn-xml` are admitted by runtime `acceptedPlanIds`; `packages/io/src/__fixtures__/bpmn/purchase-request.jsonl` exists.
- Codex-agent references: none for this plan.

## Implementation

- Added README BPMN CLI examples and exit-code documentation, plus a BPMN operation-flow section describing page creation, palette, editor legality rules, problems panel, desktop XML import/export and the docs links.
- Added `docs/bpmn/format.md` with all 16 BPMN registry types, sample JSONL element records, semantic/visual separation, parent membership, event definitions, defaults, label geometry and opaque XML interchange metadata.
- Added `docs/bpmn/lint-rules.md` with all 23 ids in registry order, recommended severities and the descriptions from `bpmnLintRuleDescription`, config example/discovery and known divergences.
- Added the original `.claude/rules` guideline `docs/bpmn/ai-review-rules.md`.
- Copied `packages/io/src/__fixtures__/bpmn/purchase-request.jsonl` byte-for-byte to `docs/bpmn/purchase-request.jsonl` with `cp`.
- Added the io BPMN XML README note and `packages/core/src/bpmn/docs-example.test.ts` with seven test cases covering parse validity, byte equality, recommended lint, exact lint ids, 16 registered types, ASCII and README command mentions.
- Converted existing non-ASCII typography in `README.md` and `packages/io/README.md` to ASCII equivalents because the exact plan ASCII gate scans both files.

## Verification (final source)

| Command | Result | Evidence |
| --- | --- | --- |
| `bun test packages/core/src/bpmn/docs-example.test.ts` | exit 0; 7 pass, 0 fail, 30 expects | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/focused-test-final.log` |
| `bunx biome check packages/core/src/bpmn/docs-example.test.ts` | exit 0; 1 file clean | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/biome-final.log` |
| `cmp docs/bpmn/purchase-request.jsonl packages/io/src/__fixtures__/bpmn/purchase-request.jsonl` | exit 0; byte-identical | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/cmp-final.log` |
| `! LC_ALL=C grep -l '[^[:print:][:space:]]' docs/bpmn/format.md docs/bpmn/lint-rules.md docs/bpmn/ai-review-rules.md README.md packages/io/README.md` | exit 0; no matching paths | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/ascii-final.log` |
| `bun run typecheck` | exit 2 due to 5 sibling-owned diagnostics only; 0 in bpmn-14 owned paths | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/typecheck-final.log` |
| `! grep -E '^packages/core/src/bpmn/docs-example[.]test[.]ts[(]' tmp/bpmn-operation-flow-s359/bpmn-14-docs/typecheck-final.log && ! grep -E '^error TS' tmp/bpmn-operation-flow-s359/bpmn-14-docs/typecheck-final.log` | exit 0; no owned diagnostics and no unattributed TypeScript error lines (G1 passes) | stdout-only gate; exact typecheck log above |

The typecheck diagnostics are in `packages/ui-solid/src/inspector/BpmnSection.tsx` (TS6133 `Editor`, TS6133 `SelectInput`, TS2345 Set type) and `packages/ui-solid/src/Toolbar.tsx` (TS6133 `BPMN_TOOLS`). They belong to sibling UI plans, not this write set, and are non-blocking under design section 11.1 rule 3. The live shared tree is moving, so whole-repository `bunx biome check .` and `bun test` remain integration/final gates. The orchestrator's CLI lint of the example also remains reconciliation evidence; this plan did not shell out to the CLI.

## Earlier attempts

- `focused-test.log`: the test itself reported 7 pass / 0 fail, but the shell wrapper exited 1 after zsh rejected the reserved assignment name `status`; corrected with a new log and wrapper at `focused-test-r2.log` (7/0) and final-source `focused-test-final.log` (7/0).
- `biome.log`: exit 1 for a control-character regex and two formatting lines; corrected in the owned test, then `biome-final.log` passed.
- `ascii.log`: exit 1 because README.md and packages/io/README.md had existing non-ASCII punctuation; converted those typography characters to ASCII, then `ascii-final.log` passed.
- `cmp.log`: initial comparison exit 0; final-source comparison also passes in `cmp-final.log`.

## Authored source hashes

```text
4d9c0d0b3d8a55a8a6c3d165f8d1ce01be7e7d833f528c42e6950b0db9588eb0  README.md
81d5f59987a623594535b35ac09013c3d614a4bc75680e067f30b0d781284069  docs/bpmn/format.md
d1d06e26ee0e95c29b0330868a3989b9dfa245c2475abcc62d392f5080b4b9f6  docs/bpmn/lint-rules.md
c6c22ecae48535751b09728b510d60d9695a02d04248b3fa28f1071c9e5146ad  docs/bpmn/ai-review-rules.md
cb0a4fa11d40030669cc9934eb3b3d5801033744a80d8251c7884cfb3338cd80  docs/bpmn/purchase-request.jsonl
e3523193533cde9cc575ccadb241620893bf38dd02d83decd57dccf9ee3a09a3  packages/io/README.md
fd206a4926a179aee4951d32fbd0d825373626aaf0dcc0bda0094ba18323d23d  packages/core/src/bpmn/docs-example.test.ts
```

## Handoff

No product-code changes or package dependencies were added. Formal test-integrity/adversarial review, whole-repo gates, exact-file staging, commit and push belong to later workflow steps. No unresolved implementation finding or required behavior remains in this assigned plan.


## Adversarial repair: BPMN14-ADV-01

The README exit-code paragraph now follows design section 8: `lint` has exits 0/1/2 and no `--strict`; `bpmn import` and `bpmn export` use exit 3 with `--strict` for warnings; `bpmn export --check` uses exit 1 on drift. The three command examples are unchanged. The computed-column marker is described in ASCII as a function (f-hook) glyph. Independent re-review is pending; this records implementation evidence only.

| Command | Result | Evidence |
| --- | --- | --- |
| `bun test packages/core/src/bpmn/docs-example.test.ts` | exit 0; 7 pass, 0 fail, 30 expects | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/docs-test-adv1.log` |
| `! LC_ALL=C grep -l '[^[:print:][:space:]]' docs/bpmn/format.md docs/bpmn/lint-rules.md docs/bpmn/ai-review-rules.md README.md packages/io/README.md` | exit 0; no matches | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/ascii-adv1.log` |
| `! grep -nE 'lint[^.]*--strict|--strict[^.]*lint' README.md` | exit 0; no lint/strict association | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/no-lint-strict-adv1.log` |
| `grep -n 'nodetto-cli lint' README.md && grep -n 'nodetto-cli bpmn export' README.md` | exit 0; both examples present | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/command-examples-adv1.log` |
| `cmp docs/bpmn/purchase-request.jsonl packages/io/src/__fixtures__/bpmn/purchase-request.jsonl` | exit 0; byte-identical | `tmp/bpmn-operation-flow-s359/bpmn-14-docs/cmp-adv1.log` |

Current README SHA-256: `4d9c0d0b3d8a55a8a6c3d165f8d1ce01be7e7d833f528c42e6950b0db9588eb0`. Current `packages/io/README.md` SHA-256: `e3523193533cde9cc575ccadb241620893bf38dd02d83decd57dccf9ee3a09a3`.
