# bpmn-02-fixtures progress

Status: implementation complete for the assigned fixture plan; awaiting downstream review and serial integration.

## Files and SHA-256

- `packages/io/src/__fixtures__/bpmn/purchase-request.bpmn`: `5981913cc27ae94fd4f3e6695a86c441f5a487bb80b119758a790ec59586469a`
- `packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn`: `a5c90b537ce325f52822ee917dffb7457bcac492ac7d9fb72fc88c1e482a9206`
- `packages/io/src/__fixtures__/bpmn/purchase-request-swapped.bpmn`: `60b0086bdb3500d2b8cf5a487ff6806503d0f8c8bb35570b0fb9ed80dff9085a`
- `packages/io/src/__fixtures__/bpmn/purchase-request-inverted.bpmn`: `c28346611428c4fa82b317d3291c6624f522e8d673026a54ba7ef261c5d53bb3`

## Verification

All verification logs are under `tmp/bpmn-operation-flow-s356/bpmn-02-fixtures/`.

| Check | Exit | Result |
| --- | ---: | --- |
| `for f in packages/io/src/__fixtures__/bpmn/*.bpmn; do xmllint --noout "$f" || exit 1; done; echo ok` | 0 | All four XML fixtures well-formed; printed `ok`. |
| Complete sequence-flow count equals 12 | 0 | Passed. |
| Draft sequence-flow count equals 11 | 0 | Passed. |
| Complete flowNodeRef count equals 13 | 0 | Passed. |
| Complete messageEventDefinition count equals 6 | 0 | Passed. |
| Complete BPMNShape count equals 17 | 0 | Passed. |
| Complete BPMNEdge count equals 12 | 0 | Passed. |
| Inverted diff contains YES/NO name changes | 0 | Passed. |
| Inverted diff has no other lines beyond YES/NO names (Definitions id excluded) | 0 | Passed. |
| `LC_ALL=C grep -n '[^ -~]' ...` wrapper assertion | 0 | No non-printable bytes found; grep itself returned 1 as expected for no matches. |
| Plan's `grep -P` ASCII command | 0 (masked) | Unsupported on the host's macOS grep (`invalid option -- P`); the plan command's `!` masked grep's failure. This is not treated as a pass; the byte-class assertion above checks the content. |

No source, text, labels, ids, or geometry were taken from `.reference/`. The variants were generated from the original fixture definition in this plan. The draft removes the order flow and reciprocal references and omits the order task label. No code or tests were changed, as required by this plan.

## Completion criteria

- [x] Four original fixture files exist with the required flow, node reference, event definition, shape, and edge counts.
- [x] All four are well-formed according to `xmllint`.
- [x] Inverted fixture differs only in YES/NO names, ignoring the Definitions id.
- [x] Fixture files contain ASCII text and no text or geometry from `.reference/`.
- [x] File hashes and verification outcomes are recorded above.

## Resume (2026-10-13)

The four fixture hashes were rechecked before implementation and exactly
match the hashes above. Added the owned dependency-free contract test
`packages/io/src/__fixtures__/bpmn/fixtures.test.ts`; the four original XML
fixtures remain byte-for-byte unchanged. The test covers root and required
namespaces, tag balance, ASCII-only text, complete and draft counts, the
swapped and inverted positional differences, and the four Definitions ids.
The earlier statement that no test was changed records the prior attempt;
this resumed implementation adds the test required by the plan.

Final-source verification ran in the shared working tree. Complete logs and
exit statuses are under `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/`:

| Command | Exit | Result |
| --- | ---: | --- |
| `bun test packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | 6 tests passed, 0 failed; 62 assertions. |
| `bun run typecheck` | 0 | TypeScript check passed. |
| `bunx biome check packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | One file checked; no fixes needed. |
| `for f in packages/io/src/__fixtures__/bpmn/*.bpmn; do xmllint --noout "$f" || exit 1; done; echo ok` | 0 | All four fixtures are well-formed; printed `ok`. |
| `! LC_ALL=C grep -l '[^[:print:][:space:]]' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-swapped.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-inverted.bpmn packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | No non-printable or non-ASCII bytes found. |

The initial Biome check flagged the regex-loop form, an ASCII regex lint
rule, and formatting. The test was adjusted to use explicit regex iteration
and an ASCII code-unit scan, then formatted; the final Biome check above
passes. No fixture source was changed. The earlier Step 3 verification
history remains above as recorded at that time.

## Updated completion criteria

- [x] Four original fixture files exist with the required flow, node
  reference, event definition, shape, and edge counts.
- [x] All four are well-formed according to `xmllint`.
- [x] Inverted fixture differs only in YES/NO names, ignoring the
  Definitions id; swapped fixture differs only in the request notice event
  tags.
- [x] Fixture files and the owned test are ASCII-only and contain no text or
  geometry from `.reference/`.
- [x] The owned Bun contract test passes with a positive count and zero
  failures; TypeScript and Biome checks pass.
- [x] Fixture hashes and final-source verification outcomes are recorded.

## Current-source verification update (2026-10-13)

Strengthened the test to require exactly five `xmlns:` declarations in each
fixture and equal line counts for complete/swapped and complete/inverted
comparisons. The exact changed-line assertions remain in place. These
current-source logs supersede the earlier Resume counts above:

| Command | Exit | Result | Log |
| --- | ---: | --- | --- |
| `bun test packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | 6 passed, 0 failed; 68 assertions. | `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/fixtures-test-current.log` |
| `bun run typecheck` | 0 | Passed. | `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/typecheck-current.log` |
| `bunx biome check packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | One file checked; no fixes needed. | `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/biome-current.log` |
| `! LC_ALL=C grep -l '[^[:print:][:space:]]' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-swapped.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-inverted.bpmn packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | No non-printable or non-ASCII bytes found. | `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/ascii-current.log` |

The four fixture SHA-256 values were rechecked and still match the values
recorded at the top of this file. XML well-formedness remains verified by
the `xmllint` run in the Resume section; the fixture XML files have not
changed.

## Final verification (2026-10-13)

The root assertion now checks that line 2 is `<bpmn:definitions` and that
the root itself carries the five required namespace declarations and target
namespace. This final source supersedes prior test/tool results above:

| Command | Exit | Result | Log |
| --- | ---: | --- | --- |
| `bun test packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | 6 passed, 0 failed; 72 assertions. | `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/fixtures-test-final.log` |
| `bun run typecheck` | 0 | Passed. | `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/typecheck-final.log` |
| `bunx biome check packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | One file checked; no fixes needed. | `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/biome-final.log` |
| `! LC_ALL=C grep -l '[^[:print:][:space:]]' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-swapped.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-inverted.bpmn packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | No non-printable or non-ASCII bytes found. | `tmp/bpmn-operation-flow-s357/bpmn-02-fixtures/ascii-final.log` |

The `xmllint` result and log in the Resume section remain source-matched:
all four XML fixtures are unchanged in this implementation.

## Completion (session-359)

- Status: COMPLETE. Accepted by the s357 wave-1 integration review
  (`tmp/bpmn-operation-flow-s357/reconcile-wave1-r2/reconcile-summary.md`:
  bpmn-02 snapshot 6/6 unchanged, combined-tree checks exit 0).
- Recorded by the session-359 plan author (workflow execution
  `opus-luna-design-and-implement-review-loop-session-359`, intake
  comm-006132). Session-359 does not dispatch this plan
  (`acceptedPlanIds` in
  `impl-plans/active/bpmn-operation-flow-s359-dispatch.json`). No source
  file was changed for this entry.

## Re-verify (session-359 redispatch, 2026-10-13)

This verification-only redispatch made no changes to the four fixture XML
files or `fixtures.test.ts`. All current-run logs are under
`tmp/bpmn-operation-flow-s359/bpmn-02-fixtures/`:

| Command | Exit | Result | Log |
| --- | ---: | --- | --- |
| `bun test packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | 6 passed, 0 failed; 72 assertions. | `tmp/bpmn-operation-flow-s359/bpmn-02-fixtures/fixtures-test-redispatch-r2.log` |
| `bun run typecheck` | 0 | Passed; no diagnostics. | `tmp/bpmn-operation-flow-s359/bpmn-02-fixtures/typecheck-redispatch.log` |
| Owner-scoped scan of the typecheck log for `^packages/io/src/__fixtures__/bpmn/` and `^error TS` | 0 | No owned-path diagnostics or unattributed TypeScript errors. | `tmp/bpmn-operation-flow-s359/bpmn-02-fixtures/diagnostic-scope-redispatch.log` |
| `bunx biome check packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | One file checked; no fixes applied. | `tmp/bpmn-operation-flow-s359/bpmn-02-fixtures/biome-redispatch.log` |
| `for f in packages/io/src/__fixtures__/bpmn/*.bpmn; do xmllint --noout "$f" || exit 1; done; echo ok` | 0 | All four XML fixtures are well-formed; printed `ok`. | `tmp/bpmn-operation-flow-s359/bpmn-02-fixtures/xmllint-redispatch.log` |
| `! LC_ALL=C grep -l '[^[:print:][:space:]]' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-swapped.bpmn packages/io/src/__fixtures__/bpmn/purchase-request-inverted.bpmn packages/io/src/__fixtures__/bpmn/fixtures.test.ts` | 0 | No non-printable or non-ASCII bytes found. | `tmp/bpmn-operation-flow-s359/bpmn-02-fixtures/ascii-redispatch.log` |

The assigned plan remains complete. No `.reference/` content was inspected or
copied during this verification-only redispatch.
