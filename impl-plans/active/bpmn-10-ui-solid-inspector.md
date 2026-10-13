# bpmn-10-ui-solid-inspector

- planId: bpmn-10-ui-solid-inspector
- planPath: impl-plans/active/bpmn-10-ui-solid-inspector.md
- wave: 3; dependsOn: bpmn-03-core-editing
- design: design-docs/specs/design-bpmn.md sections 3.2 (type switching is
  a semantic update on the same id), 4.3 (`updateBpmnSemantic`), 6.3
  (inspector)
- progress log: impl-plans/progress/bpmn-10-ui-solid-inspector.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Intent

A `BpmnSection` in the inspector edits BPMN semantic fields, including
type switching (task -> user task, catch <-> throw message event) without
losing connections, because every change is an `updateBpmnSemantic` on the
same element id. Options that would violate the editing rules are
disabled; `updateBpmnSemantic` still rejects them programmatically.

## Non-goals

- No flow-type picker: sequence vs message flow follows the endpoints
  (design 4.3).
- No lint config UI (user-QA Q2 default).
- No change to other inspector sections.

## writePaths

- packages/ui-solid/src/inspector/BpmnSection.tsx (new)
- packages/ui-solid/src/inspector/bpmn-edits.ts (new)
- packages/ui-solid/src/inspector/bpmn-edits.test.ts (new)
- packages/ui-solid/src/Inspector.tsx
- impl-plans/progress/bpmn-10-ui-solid-inspector.md

sharedPaths: none.

## File-level changes

### inspector/bpmn-edits.ts (new, pure)

Imitate packages/ui-solid/src/inspector/edits.ts (pure helpers with
tests). Pinned helpers:
- `withField(semantic: unknown, key: string, value: unknown): Record<string, unknown>`
  (copy, set, or delete the key when `value` is `undefined`)
- `withDefinitionKinds(semantic, kinds: readonly BpmnEventDefinitionKind[], elementId): Record<string, unknown>`
  keeps existing definitions whose kind is still selected (same ids),
  appends new ones with ids `def-<elementId>-<n>` unique within the array,
  drops the rest; timer definitions get `timer: {type: "duration", value: ""}`
- `disabledEventPositions(model: BpmnModel, eventId): ReadonlySet<BpmnEventPosition>`
  -> `start` disabled when the event has incoming sequence flows, `end`
  disabled when it has outgoing ones

### inspector/BpmnSection.tsx (new)

- Props `ElementSectionProps` (same as other sections).
- Fields by type (design 6.3): `name` (all except association, data
  association and text annotation; annotation edits `text`), task
  `taskType`, `loop`, `forCompensation`; subProcess `expanded`,
  `triggeredByEvent`, `adHoc`, `loop`; callActivity `calledElement`, `loop`;
  event `position` (disabled options from `disabledEventPositions`),
  definition kinds (multi-select of checkboxes), `interrupting`,
  `parallelMultiple`; boundaryEvent `cancelActivity`, definition kinds;
  gateway `gatewayType`, `markerVisible`; dataObject `role`, `collection`;
  sequenceFlow `condition`, `isDefault`; association `direction`;
  participant `collapsed`.
- Every write: `editor.updateBpmnSemantic(id, nextSemantic)`; on
  `{ok: false}` the control resets to the document value; catch
  `CommandError` exactly like `writeSemantic` (inspector/write.ts) and
  reset.
- Use the existing controls (`Section`, `Field`, `TextInput`, select and
  checkbox controls in inspector/controls.tsx) and imitate
  `SequenceMessageSection` (inspector/SimpleSections.tsx:269).

### Inspector.tsx

Add one `<Match when={element().type.startsWith("bpmn.")}>` with
`<BpmnSection editor={props.editor} element={element()} />` in the
per-type `Switch` (Inspector.tsx:~225-280). No other change.

## Pitfalls

- Never call `editor.apply` with `updateSemantic` directly for BPMN
  elements in this section; always `updateBpmnSemantic`.
- Never change the element type or id; type switching is a field change.
- Keep definition ids stable when kinds are unchanged (collab merges
  arrays by id).

## Tests (input -> expected) in `bpmn-edits.test.ts`

- `withField({name: "a", parent: "l1"}, "parent", undefined)` -> no
  `parent` key
- `withDefinitionKinds` from `[message d1]` to `[message, timer]` -> keeps
  `d1`, adds a timer with a new unique id; to `[]` -> empty array
- `disabledEventPositions` for an event with one incoming sequence flow ->
  contains `start`, not `end`
- with an Editor (bpmn-03 API): switching a catch message event to throw
  via `updateBpmnSemantic(withField(...,"position","intermediateThrow"))`
  -> ok, flows unchanged; switching an event with incoming flows to
  `start` -> `{ok: false}` and unchanged
- task `taskType` user -> service via `updateBpmnSemantic` -> same id and
  connections

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck                                       # exit 0
bunx biome check packages/ui-solid/src/inspector/BpmnSection.tsx packages/ui-solid/src/inspector/bpmn-edits.ts packages/ui-solid/src/inspector/bpmn-edits.test.ts packages/ui-solid/src/Inspector.tsx   # exit 0
bun test packages/ui-solid                              # exit 0
```

## Done criteria

- `grep -n "updateSemantic\"" packages/ui-solid/src/inspector/BpmnSection.tsx`
  returns nothing; `grep -c "updateBpmnSemantic" ...BpmnSection.tsx` >= 1.
- Tests pass; exit codes in the progress log.
