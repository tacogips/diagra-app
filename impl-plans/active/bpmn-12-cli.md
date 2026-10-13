# bpmn-12-cli

- planId: bpmn-12-cli
- planPath: impl-plans/active/bpmn-12-cli.md
- wave: 3; dependsOn: bpmn-04-core-notation-svg (route resolver),
  bpmn-05-core-lint, bpmn-06-io-bpmn-xml
- design: design-docs/specs/design-bpmn.md section 8 (CLI), 7.2 (config
  discovery), 5.3 (route resolver for export)
- progress log: impl-plans/progress/bpmn-12-cli.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Intent

CI-ready commands in `diagra-cli`:
- `lint <document.jsonl|file.bpmn> [--page <id|name>] [--config <file>] [--format text|json]`
- `bpmn import <file.bpmn> [--output <doc.jsonl>] [--strict]`
- `bpmn export <document.jsonl> [--page <id|name>] [--output <file.bpmn> | --check <file.bpmn>] [--strict]`

Deterministic output, exit codes consistent with the existing commands
(`EXIT_OK` 0, `EXIT_DRIFT` 1, `EXIT_ERROR` 2, `EXIT_WARNINGS` 3;
apps/cli/src/commands.ts:21-27).

## Non-goals

- No generic `export` command, no PNG/PDF.
- No change to the behaviour or messages of `ddl`, `arrange`, `format`,
  `validate` (commands.test.ts must pass unchanged).
- README is bpmn-14; this plan updates only the `USAGE` text.

## writePaths

- apps/cli/src/commands.ts
- apps/cli/src/main.ts
- apps/cli/src/bpmn-commands.test.ts (new)
- impl-plans/progress/bpmn-12-cli.md

sharedPaths: none. Fixtures under `packages/io/src/__fixtures__/bpmn/`
are read-only inputs.

## File-level changes

### apps/cli/src/commands.ts

- Implement `lintCommand` and `bpmnCommand` (with `bpmnImport`,
  `bpmnExport`) in this file, reusing the private helpers `parseArgs`,
  `ok`, `fail`, `loadDocument`, `writeOutput`, `normalizeNewlines`
  (commands.ts:70-190). Imitate `ddlCommand` (commands.ts:192) for
  `--output`/`--check`/`--strict` structure and messages.
- `selectPage`: add an optional third parameter for the candidate pages
  and the "none" message so BPMN uses `bpmnPages(document)` (pages with
  `kind === "bpmn"`); the ERD default arguments keep `ddl` and `arrange`
  output byte-identical.
- `CommandIo` gains an optional `exists?(path: string): boolean`. Without
  it, `.bpmnlintrc` discovery treats the file as absent.
- `runCli` switch (commands.ts:365): add `case "lint"` and `case "bpmn"`.
  `bpmn` with a missing or unknown subcommand -> usage error, exit 2.
- `USAGE`: add the three synopsis lines and a short description block for
  `lint` and `bpmn` with their exit codes, in the existing style.

`lint` behaviour (design 8):
- input ending in `.bpmn` (case-insensitive): `importBpmnXml`, lint its
  page with `{missingDi}`, import warnings to stderr as
  `warning: <element> <xmlId>: <message>`; parse error -> exit 2.
  Otherwise parse as JSONL via `loadDocument`.
- pages: `--page` selects one; else every `bpmn` page in page order; no
  `bpmn` page -> usage error exit 2.
- config: `--config <file>` read and `parseLintConfig`; else
  `.bpmnlintrc` in the cwd when `io.exists?.(".bpmnlintrc")`; else
  `recommendedLintConfig()`. `BpmnLintConfigError` or unreadable file ->
  exit 2 with the message.
- `--format` other than `text`/`json` -> exit 2.
- text format: when there is at least one finding: first line the input
  path; for multi-page JSONL a `page <name> (<id>)` line before each page's
  rows; rows `  <elementId>  <severity>  <message>  <ruleId>` with each
  column padded to the widest value in that page; a blank line; then
  `N problems (E errors, W warnings)` (use "problem" when N is 1).
  Clean -> empty stdout.
- json format: always one object `{input, pages: [{pageId, pageName,
  findings: [{elementId, severity, message, ruleId}]}], summary:
  {problems, errors, warnings}}`, `JSON.stringify(value, null, 2)` plus a
  trailing newline.
- exit 0 when no error-level finding (warnings allowed); 1 when any
  error-level finding.

`bpmn import`: read file, `importBpmnXml(text, {title: <basename without
extension>})`, canonical JSONL via `serializeDocument`; stdout or
`--output`; warnings to stderr; `--strict` with warnings -> exit 3; parse
error -> exit 2.

`bpmn export`: `loadDocument`; page from `--page` or the single `bpmn`
page (several -> usage error listing them, as `selectPage` does for ERD);
`--output` with `--check` -> exit 2; `exportBpmnXml(document, page.id,
{routeOf: bpmnRouteResolver(new Editor({document}))})`; `--check` compares
`normalizeNewlines(file)` with the XML (drift -> exit 1 with an
"out of date" message naming the regenerate command); `--strict` with
export warnings -> exit 3.

### apps/cli/src/main.ts

Pass `exists: (path) => existsSync(path)` in the `CommandIo` object
(import `existsSync` from `node:fs`). Nothing else.

## Pitfalls

- Output must be deterministic: no timestamps, no absolute paths beyond
  the input path the user gave.
- Exit 1 for lint means error findings; do not reuse it for usage errors.
- `.reference` paths are used only in the manual local verification, never
  in committed tests.
- No symbols or emojis in output.

## Tests (input -> expected) in `bpmn-commands.test.ts`

Read the bpmn-02 fixtures with `readFileSync` (path from
`import.meta.dir`) into the in-memory `CommandIo` (imitate `memoryIo` in
commands.test.ts).
- `lint draft.bpmn` -> exit 1; stdout has exactly three rows with rule ids
  label-required, no-implicit-end (Task_PlaceOrder) and no-implicit-start
  (Event_OrderNoticeProcurement); summary `3 problems (3 errors, 0
  warnings)`
- `lint purchase-request.bpmn`, `swapped`, `inverted` -> exit 0, empty
  stdout
- `lint draft.bpmn --format json` -> parseable JSON, `summary.problems`
  3; `lint purchase-request.bpmn --format json` -> `summary.problems` 0,
  still printed
- `--config` file `{"extends":"bpmnlint:recommended","rules":{"label-required":"off","no-implicit-end":"warn","no-implicit-start":"warn"}}`
  on the draft -> exit 0, two warning rows
- `.bpmnlintrc` present via `exists` -> used; invalid config -> exit 2
- `--format xml` -> exit 2; document without bpmn page -> exit 2
- JSONL input (output of `bpmn import` of the draft) -> same three
  findings
- `bpmn import purchase-request.bpmn` -> exit 0, stdout parses with
  `parseDocumentResult` ok; `--output out.jsonl` writes it
- `bpmn export` of that JSONL -> exit 0, XML that `importBpmnXml` accepts;
  `--check` against the same output -> exit 0; against a modified file ->
  exit 1; `--output` with `--check` -> exit 2
- `bpmn` and `bpmn frobnicate` -> exit 2 with usage
- existing `ddl` page-selection messages unchanged (covered by the
  unchanged commands.test.ts)

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck                                       # exit 0
bunx biome check apps/cli/src                           # exit 0
bun test apps/cli/src/bpmn-commands.test.ts             # exit 0, pass count > 0, 0 fail (owned tests, design 11.1 rule 1)
bun test apps/cli                                       # exit 0 (commands.test.ts unchanged; it asserts output fragments and exit codes, not the USAGE text)
bun apps/cli/src/main.ts lint packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn; echo "exit=$?"   # 3 rows, exit=1
bun apps/cli/src/main.ts lint packages/io/src/__fixtures__/bpmn/purchase-request.bpmn; echo "exit=$?"         # no output, exit=0
bun apps/cli/src/main.ts bpmn import .reference/bpmn-article/docs/purchase_request/purchase_request.bpmn > /tmp/diagra-bpmn-ref.jsonl; echo "exit=$?"   # exit=0 (local only)
bun apps/cli/src/main.ts lint .reference/bpmn-article/docs/purchase_request_draft/purchase_request_draft.bpmn; echo "exit=$?"   # 3 rows (label-required, no-implicit-end, no-implicit-start), exit=1 (local only)
```

## Done criteria

- `git diff apps/cli/src/commands.test.ts` is empty.
- `bun apps/cli/src/main.ts --help` lists `lint` and `bpmn`.
- All commands above produce the stated exit codes; recorded in the
  progress log (local `.reference` runs marked local-only).
