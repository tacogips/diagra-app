# bpmn-09-ui-solid-palette

- planId: bpmn-09-ui-solid-palette
- planPath: impl-plans/active/bpmn-09-ui-solid-palette.md
- wave: 3; dependsOn: bpmn-03-core-editing
- design: design-docs/specs/design-bpmn.md sections 4.3 (ui-solid
  `reconnect` delegation), 4.4 (pool/lane sizing), 6.3 (palette), 9 (Add
  BPMN page in PageTabs)
- progress log: impl-plans/progress/bpmn-09-ui-solid-palette.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Session-359 status and gate: read this first

- Status: NOT STARTED. Runs in wave 3, after the wave-2 join, which
  includes bpmn-03. If an owned path already exists, re-read and
  inventory it instead of overwriting it.
- Gates: overview "Parallel-wave gate (design 11.1 rule 3)".
- G1 ownRegex:
  `^packages/ui-solid/src/(tools\.ts|Toolbar\.tsx|interaction\.ts|PageTabs\.tsx|bpmn-palette\.test\.ts)\(`.
- Focused owned test (strictly blocking):
  `bun test packages/ui-solid/src/bpmn-palette.test.ts`. G2 applies to
  `bun test packages/ui-solid`. A failure in `Toolbar.test.ts`,
  `interaction.test.ts` or `viewer-actions.test.ts` is caused by this
  plan (it changes `TOOLS` and `interaction.ts`) and blocks. Those test
  files must stay unedited.
- Evidence: `tmp/bpmn-operation-flow-s359/bpmn-09-ui-solid-palette/`.

## Intent

Let users author BPMN on a `bpmn` page:
- a "BPMN" tool menu (Descriptive palette) shown when the active page kind
  is `bpmn`
- the lane tool adds a lane to the pool/lane under the pointer through
  `editor.addBpmnLane`
- dragging a BPMN flow end goes through `editor.reconnectBpmnFlow`
- "Add BPMN page" next to "Add page"

The connect gesture needs no change: it calls `editor.connectSmart`
(interaction.ts:1755), which delegates to `connectBpmn` (bpmn-03); the
rejection message is shown by the problems panel (bpmn-11) through
`editor.onBpmnRejection`.

## Non-goals

- Do not change `TOOL_MENUS` or `ACTION_MENUS` (Toolbar.test.ts pins them
  with `toEqual`). The BPMN menu is a separate export.
- No inspector (bpmn-10), no views (bpmn-08), no problems panel (bpmn-11).
- No new notification system.

## writePaths

- packages/ui-solid/src/tools.ts
- packages/ui-solid/src/Toolbar.tsx
- packages/ui-solid/src/interaction.ts
- packages/ui-solid/src/PageTabs.tsx
- packages/ui-solid/src/bpmn-palette.test.ts (new)
- impl-plans/progress/bpmn-09-ui-solid-palette.md

sharedPaths: none.

## File-level changes

### tools.ts

- Add `export const BPMN_TOOLS = [...] as const` with these ids and spread
  it into `TOOLS` (after `...GEO_TOOLS`):
  `bpmn:pool`, `bpmn:pool-collapsed`, `bpmn:lane`, `bpmn:task`,
  `bpmn:user-task`, `bpmn:service-task`, `bpmn:start-event`,
  `bpmn:message-catch`, `bpmn:message-throw`, `bpmn:timer-catch`,
  `bpmn:end-event`, `bpmn:exclusive-gateway`, `bpmn:parallel-gateway`,
  `bpmn:sub-process`, `bpmn:sub-process-expanded`, `bpmn:call-activity`,
  `bpmn:data-object`, `bpmn:data-store`, `bpmn:text-annotation`,
  `bpmn:group`.
- `creationFor` returns a non-null `CreationTool` for every one (the
  `TOOLS` loop test in interaction.test.ts:851 requires it). Each
  `semantic` is a COMPLETE payload: the bpmn-01 `defaultSemantic` of the
  type with the tool's overrides applied (see Pitfalls, `buildElement`
  replaces rather than merges). Exact payloads:
  - `bpmn:pool` -> `bpmn.participant`, `{name: "Pool", collapsed: false}`,
    visual 600x250
  - `bpmn:pool-collapsed` -> `bpmn.participant`, `{name: "Pool",
    collapsed: true}`, visual 600x60
  - `bpmn:lane` -> `{type: "bpmn.lane"}` with no semantic (never placed
    through the generic path; `addBpmnLane` builds it)
  - `bpmn:task` -> `bpmn.task`, `{name: "Task", taskType: "none", loop:
    "none"}`
  - `bpmn:user-task` / `bpmn:service-task` -> same with `taskType: "user"`
    / `"service"`
  - `bpmn:start-event` / `bpmn:end-event` -> `bpmn.event`, `{name: "",
    position: "start" | "end", definitions: []}`
  - `bpmn:message-catch` / `bpmn:message-throw` -> `bpmn.event`, `{name:
    "", position: "intermediateCatch" | "intermediateThrow", definitions:
    [{id: "def-1", kind: "message"}]}` (the definition id is replaced with
    a fresh id at placement, see interaction)
  - `bpmn:timer-catch` -> `bpmn.event`, `{name: "", position:
    "intermediateCatch", definitions: [{id: "def-1", kind: "timer", timer:
    {type: "duration", value: ""}}]}`
  - `bpmn:exclusive-gateway` / `bpmn:parallel-gateway` -> `bpmn.gateway`,
    `{name: "", gatewayType: "exclusive" | "parallel"}`
  - `bpmn:sub-process` -> `bpmn.subProcess`, `{name: "Sub-process",
    expanded: false, triggeredByEvent: false, adHoc: false, loop: "none"}`
  - `bpmn:sub-process-expanded` -> same with `expanded: true`, visual
    350x200
  - `bpmn:call-activity` -> `bpmn.callActivity`, `{name: "Call activity",
    loop: "none"}`
  - `bpmn:data-object` -> `bpmn.dataObject`, `{name: "Data object", role:
    "reference", collection: false}`
  - `bpmn:data-store` -> `bpmn.dataStore`, `{name: "Data store"}`
  - `bpmn:text-annotation` -> `bpmn.textAnnotation`, `{text: ""}`
  - `bpmn:group` -> `bpmn.group`, `{name: ""}`
  - Do not add `parent`; the editor sets it (bpmn-03).
- Export `BPMN_TOOLS` and a `BpmnToolKind` type from `index.ts` is NOT
  needed (Toolbar imports from tools.ts directly); do not edit
  `packages/ui-solid/src/index.ts` (owned by bpmn-11).

### Toolbar.tsx

- Export `BPMN_TOOL_MENU: Readonly<{ id: "bpmn"; label: "BPMN"; tools:
  readonly ToolbarTool[] }>` built with the existing `tools(...)` helper
  (Toolbar.tsx:52), labels in plain English ("Pool", "Collapsed pool",
  "Lane", "Task", "User task", ...).
- Render a "BPMN" menu button only when the current page kind is `bpmn`
  (`signals.rev(); props.editor.store.getPage(props.editor.currentPageId)?.kind`),
  using the same open/close/keyboard menu machinery as the Frames/Shapes
  menus (`open() === "bpmn"`). Other menus stay available.

### interaction.ts

- `placeShape` (interaction.ts:1201):
  - `bpmn.lane`: find the innermost `bpmn.lane` or `bpmn.participant` on
    the current page whose bounds contain the point (use
    `editor.getBounds`), call `editor.addBpmnLane(id)`; on ok select the
    new lane; when no container is under the point, place nothing. Return
    to `select`.
  - `bpmn.event` / `bpmn.boundaryEvent` with `definitions`: replace each
    definition `id` with a fresh unique id (`def-` + element id + index) so
    two placed events never share definition ids.
  - Every other BPMN type uses the existing generic path (centre at the
    point). Membership (`parent`) is set by the editor (bpmn-03).
- `reconnect` (interaction.ts:1698-1719): when the connector type starts
  with `bpmn.`, call `editor.reconnectBpmnFlow(id, end, target)` instead of
  the raw `updateSemantic`; other types keep the existing path.
- Do not add BPMN logic to the connect gesture.

### PageTabs.tsx

Next to the "Add page" button (PageTabs.tsx:397-401) add an "Add BPMN
page" button (`title`/`aria-label` "Add BPMN page") calling
`props.editor.createPage({ kind: "bpmn", name: "Process" })` and switching
to it like "Add page" does. Hidden/disabled when read-only, like "Add
page".

## Pitfalls

- `Editor.buildElement` (packages/core/src/editor.ts:1168-1171) replaces
  the ShapeUtil default semantic with `options.semantic`; it does not
  merge them. A partial payload such as `{expanded: true}` fails
  `validateSemanticPayload` and `placeShape` throws `CommandError`. Every
  BPMN `creationFor` semantic must therefore be the complete payload listed
  above (required fields per bpmn-01: task `taskType`/`loop`; subProcess
  `expanded`/`triggeredByEvent`/`adHoc`/`loop`; callActivity `loop`; event
  `position`/`definitions`; gateway `gatewayType`; dataObject
  `role`/`collection`; participant `collapsed`; textAnnotation `text`).
- `ToolKind` is derived from `TOOLS`; any `Record<ToolKind, ...>` must
  stay exhaustive (grep before finishing).
- Do not reorder existing `TOOLS` entries.
- `reconnectBpmnFlow` can reject; the gesture then simply ends (no throw).
- Read-only editors: BPMN tools must obey `canUseTool` like all creation
  tools (viewer-actions.test.ts loops over `TOOLS`).

## Tests (input -> expected) in `bpmn-palette.test.ts`

Copy the minimal `createInteraction` harness pattern from
interaction.test.ts (`interactionFor`) into the new file; do not edit
interaction.test.ts.
- every `BPMN_TOOLS` id -> `creationFor` non-null with a `bpmn.*` type
- all-tools placement: for every `BPMN_TOOLS` id except `bpmn:lane`, on a
  fresh editor whose current page has `kind: "bpmn"`, place the tool at
  an empty point through the harness -> no throw, exactly one new element
  whose type starts with `bpmn.`, and
  `validateDocument(editor.getSnapshot())` (`@diagra/ir`,
  packages/ir/src/validate.ts:675) reports no issue with severity
  `"error"` (warnings allowed)
- `BPMN_TOOL_MENU.tools` lists exactly the `BPMN_TOOLS` ids in order;
  `TOOL_MENUS` unchanged (length and ids)
- on a `bpmn` page, place `bpmn:pool` then `bpmn:lane` inside it -> one
  lane whose `parent` is the pool; `bpmn:lane` on empty canvas -> nothing
  created
- place two `bpmn:message-catch` events -> their definition ids differ
- place `bpmn:user-task` inside the lane -> task `parent` is the lane
- reconnect gesture dragging a sequence flow end onto a task in another
  pool -> the flow becomes `bpmn.messageFlow` with the same id
- connect gesture from an end event to a task -> no element created
- an `edge.generic` reconnect still uses the old path (target updated)

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck > tmp/bpmn-operation-flow-s359/bpmn-09-ui-solid-palette/typecheck.log 2>&1   # gate G1 (overview): no ownRegex match, no unattributed "error TS" line; exit code recorded
bunx biome check packages/ui-solid/src/tools.ts packages/ui-solid/src/Toolbar.tsx packages/ui-solid/src/interaction.ts packages/ui-solid/src/PageTabs.tsx packages/ui-solid/src/bpmn-palette.test.ts   # exit 0
bun test packages/ui-solid/src/bpmn-palette.test.ts     # exit 0, pass count > 0, 0 fail (owned tests, design 11.1 rule 1)
bun test packages/ui-solid                              # exit 0 (Toolbar.test.ts, interaction.test.ts, viewer-actions.test.ts unchanged and passing; viewer-actions.test.ts:70 loops TOOLS with canUseTool and must pass for every BPMN tool)
```

## Done criteria

- `git diff packages/ui-solid/src/Toolbar.test.ts packages/ui-solid/src/interaction.test.ts`
  is empty.
- `grep -n "reconnectBpmnFlow\|addBpmnLane" packages/ui-solid/src/interaction.ts`
  shows both calls.
- `grep -n "replaces" impl-plans/active/bpmn-09-ui-solid-palette.md`
  shows the buildElement pitfall (author check, already true).
- `grep -n "validateDocument" packages/ui-solid/src/bpmn-palette.test.ts`
  shows the all-tools placement test.
- Tests pass; exit codes in the progress log.
