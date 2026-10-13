# bpmn-12-cli progress

Status: implementation complete; serial integration review remains downstream.

## G1: owned-path typecheck

- `bun run typecheck` exited 0; complete output is `tmp/bpmn-operation-flow-s359/bpmn-12-cli/typecheck.log`.
- The only output was `$ tsc --noEmit`; there were no diagnostics, including in `apps/cli/src/commands.ts`, `apps/cli/src/main.ts`, or `apps/cli/src/bpmn-commands.test.ts`.

## G2: CLI tests and style

- `bun test apps/cli/src/bpmn-commands.test.ts`: 7 pass, 0 fail, 49 expectations. Evidence: `tmp/bpmn-operation-flow-s359/bpmn-12-cli/focused-tests-final.log`.
- `bun test apps/cli`: 22 pass, 0 fail, 105 expectations. Evidence: `tmp/bpmn-operation-flow-s359/bpmn-12-cli/cli-tests-final.log`.
- `bunx biome check apps/cli/src/commands.ts apps/cli/src/main.ts apps/cli/src/bpmn-commands.test.ts`: exit 0, checked 3 files, no fixes. Evidence: `tmp/bpmn-operation-flow-s359/bpmn-12-cli/biome-final.log`.

## CLI behavior

- Draft fixture lint exits 1 and reports exactly `label-required`, `no-implicit-end` for `Task_PlaceOrder`, and `no-implicit-start` for `Event_OrderNoticeProcurement`, followed by `3 problems (3 errors, 0 warnings)`. Evidence: `tmp/bpmn-operation-flow-s359/bpmn-12-cli/cli-draft.log`.
- Complete fixture lint exits 0 with empty stdout (0 bytes). Evidence: `tmp/bpmn-operation-flow-s359/bpmn-12-cli/cli-complete.log`.
- `--help` exits 0 and lists `lint` and `bpmn`. Evidence: `tmp/bpmn-operation-flow-s359/bpmn-12-cli/help.log`.
- Local-only `.reference` purchase-request import exits 0; draft lint reports the same three rule IDs and exits 1. Evidence: `tmp/bpmn-operation-flow-s359/bpmn-12-cli/reference-import.stderr`, `reference-draft.stdout`, and `reference-draft.stderr`.
- `git diff apps/cli/src/commands.test.ts` is empty.

## Implementation summary

Added `lint` for BPMN XML and JSONL, recommended/config-file lint settings, text and JSON output, BPMN import/export, strict warning exits, export check drift handling, and executable `.bpmnlintrc` discovery. Added seven focused CLI tests. No dependencies were added. Existing `ddl`, `arrange`, `format`, `validate`, and `commands.test.ts` remain unchanged in behavior/content.
