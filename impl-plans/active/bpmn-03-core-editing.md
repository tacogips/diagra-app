# bpmn-03-core-editing

- planId: bpmn-03-core-editing
- planPath: impl-plans/active/bpmn-03-core-editing.md
- wave: 2; dependsOn: bpmn-01-ir-core-contract
- design: design-docs/specs/design-bpmn.md sections 4.2, 4.3, 4.4, 6.3
  (inspector writes through `updateBpmnSemantic`), 11 (core editing tests),
  13; review findings DR-1 (resolved in design) and DR-3 (handled here)
- progress log: impl-plans/progress/bpmn-03-core-editing.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Intent

BPMN-correct editing in `@diagra/core`:
- connection resolution that rejects or corrects connections
- Editor intent methods `connectBpmn`, the `connectSmart` delegation,
  `reconnectBpmnFlow`, `updateBpmnSemantic`, `addBpmnLane`, and an
  `onBpmnRejection` subscription (used by the problems panel status line)
- containment: `parent` assignment from geometry on create/move
- translating pool, lane or sub-process contents when the container moves
- lane stacking on pool/lane resize; add-lane sizing
- inline-edit field mapping for BPMN types

Acceptance criterion 3 (editor rejects or corrects message flow inside one
pool, sequence flow across pools, incoming flow to start event, outgoing
flow from end event, with tests) is satisfied here.

## Non-goals

- No legality check in `applyCommands`, the command validation in
  `commands.ts`, History, clipboard paste/duplicate, imports or collab
  (`store.commit`). These keep accepting illegal flows (design 4.3).
- No rendering, lint, XML or UI work. The ui-solid `reconnect` delegation
  and the lane palette gesture are bpmn-09 (they edit `interaction.ts`).
- No change to frame, group, ERD, UML or sequence behaviour; `frame-*.ts`
  is not generalised; `reconcileDerivedState` is not changed.

## writePaths

- packages/core/src/bpmn/connection.ts (new)
- packages/core/src/bpmn/connection.test.ts (new)
- packages/core/src/bpmn/containment.ts (new)
- packages/core/src/bpmn/containment.test.ts (new)
- packages/core/src/bpmn/editor-bpmn.test.ts (new)
- packages/core/src/editor.ts
- impl-plans/progress/bpmn-03-core-editing.md

## sharedPaths

- packages/core/src/bpmn/index.ts: append exactly
  `export * from "./connection.ts";` and
  `export * from "./containment.ts";`. Fresh-read and pre/post hash rule
  from the overview.

## Contracts (pinned; bpmn-09, bpmn-10 and bpmn-11 rely on them)

```ts
export type BpmnFlowType = "bpmn.sequenceFlow" | "bpmn.messageFlow" | "bpmn.association" | "bpmn.dataAssociation";
export type BpmnRejectionCode =
  | "bpmn.connection.crossPoolSequenceFlow" | "bpmn.connection.samePoolMessageFlow"
  | "bpmn.connection.startEventIncoming" | "bpmn.connection.endEventOutgoing"
  | "bpmn.connection.boundaryIncoming" | "bpmn.connection.crossScope"
  | "bpmn.connection.invalidEndpoint";
export interface BpmnRejection { readonly code: BpmnRejectionCode; readonly message: string }
export type BpmnConnectionResult =
  | { readonly ok: true; readonly type: BpmnFlowType; readonly corrected: boolean }
  | ({ readonly ok: false } & BpmnRejection);
export function resolveBpmnConnection(document: Document, from: ElementId, to: ElementId, requested?: BpmnFlowType): BpmnConnectionResult;

export type BpmnEditResult =
  | { readonly ok: true; readonly id: ElementId; readonly type: string }
  | ({ readonly ok: false } & BpmnRejection);
// Editor methods (all take an optional trailing `applyOptions: ApplyOptions = {}` like connectSmart)
connectBpmn(from: ElementId, to: ElementId, requested?: BpmnFlowType): BpmnEditResult;
reconnectBpmnFlow(id: ElementId, end: "from" | "to", target: ElementId): BpmnEditResult;
updateBpmnSemantic(id: ElementId, semantic: unknown): BpmnEditResult;
addBpmnLane(parentId: ElementId): BpmnEditResult; // parent = participant or lane; ok.id = new lane id
onBpmnRejection(listener: (rejection: BpmnRejection) => void): () => void;
```

Messages are plain English sentences without symbols, e.g. "A sequence
flow cannot cross pool boundaries. Use a message flow." No emojis.

## File-level changes

### packages/core/src/bpmn/connection.ts

Implement design 4.2 with `buildBpmnModel` (bpmn-01). Resolution order:
1. Either end `bpmn.textAnnotation` -> association (the other end may be
   any `bpmn.*` element except group). Either end `bpmn.group` ->
   `invalidEndpoint`.
2. Exactly one end is `bpmn.dataObject`/`bpmn.dataStore` and the other is
   an activity or event (incl. boundary) -> dataAssociation. Both ends data
   -> `invalidEndpoint`. Data to gateway/participant/lane ->
   `invalidEndpoint`.
3. Otherwise the default type is messageFlow when `participantOf` differs
   (both defined, or one is a collapsed participant itself), else
   sequenceFlow. When `requested` is given and differs from the default,
   the result is the default type (if legal) with `corrected: true`; when
   the default type is illegal, return its rejection code.
   - Lanes as an endpoint -> `invalidEndpoint`.

Sequence flow legality (first failing check wins, in this order):
- both ends flow nodes (`isBpmnFlowNode`), and `from !== to`, else
  `invalidEndpoint`
- target is a start event -> `startEventIncoming`; target is a boundary
  event -> `boundaryIncoming`; source is an end event -> `endEventOutgoing`
- `scopeOf(from) !== scopeOf(to)` -> `crossPoolSequenceFlow` when the
  participants differ, else `crossScope`

Message flow legality:
- participants equal (or both undefined) -> `samePoolMessageFlow`
- source: activity, participant, intermediateThrow or end event; target:
  activity, participant, start event, intermediateCatch event or boundary
  event; anything else (gateways, data, lanes, other positions) ->
  `invalidEndpoint`

Acceptance-case mapping (must hold exactly):
- message flow requested between two tasks in one pool -> ok
  sequenceFlow, `corrected: true`
- sequence flow requested between tasks in two pools -> ok messageFlow,
  `corrected: true`
- any flow into a start event in the same pool -> `startEventIncoming`
- any flow out of an end event in the same pool -> `endEventOutgoing`

### packages/core/src/bpmn/containment.ts

Pure planners with the `planFrameTranslations` shape
(packages/core/src/frame-translation.ts:9). Each one MUST also apply its
own commands to `after` with `applyCommands(after, [command])` exactly as
frame-translation.ts:53 does, so later planners see the result.

Planner order inside `Editor.apply` is fixed: `planBpmnLaneLayout`, then
`planBpmnTranslations`, then `planBpmnMembership` (see editor.ts below).
Layout runs first so that a lane it moves (restack after a pool move or a
sibling lane resize) is seen by translations as a moved container, and the
lane's descendants are shifted exactly once, by translations.

- `planBpmnLaneLayout(before: Store, after: Store): Command[]` (design 4.4
  "Pool and lane resize keep sibling lanes stacked edge to edge"). Two
  phases, both computed from `before` and the incoming `after`, each
  command applied to `after` immediately:
  - Phase A, lane resize propagation (sibling stacking). For every
    `bpmn.lane` L present in both stores whose height changed by
    `d = after.height - before.height` (clamp L to min height 30 first and
    recompute `d`; emit the clamp as `updateVisual` height on L) AND whose
    parent's box (x, y, width, height) is identical in `before` and the
    incoming `after`: grow (or shrink, `d < 0`) the parent and every
    ancestor lane/participant height by `d`. Sum the deltas when several
    sibling lanes were resized in the same batch. Do not move siblings
    here; Phase B stacks them.
    - The "parent box unchanged" condition is what prevents double growth:
      `addBpmnLaneCommands` and pool resizes already change the parent, so
      Phase A is skipped for them.
    - A top-edge lane resize (y and height both changed) is treated as a
      bottom-edge resize: Phase B resets L's y to its stacked position.
    - Lane x/width are derived from the parent and are not propagated: a
      direct lane width/x change is restored by Phase B (resize the pool to
      change widths).
  - Phase B, restack. For every participant or lane whose box differs
    between `before` and the current `after` (including Phase A changes),
    processed outermost first (participants, then lanes by depth): restack
    its direct child lanes. child x = parent x + 30, child width = parent
    width - 30; children keep their heights and stack from parent y in
    index order with no gaps; the last child absorbs `parent.height -
    sum(child heights)` (min 30). After Phase A that difference is 0, so
    the user's resize is never reverted. Recurse into nested lanes. Emit
    `updateVisual` only for changed values.
- `planBpmnTranslations(before: Store, after: Store): Command[]`
  - Runs after `planBpmnLaneLayout`. For each `bpmn.participant`,
    `bpmn.lane` or `bpmn.subProcess` whose `visual.x`/`visual.y` differ
    between `before` and `after` (whether moved by the user or restacked by
    layout), shift every element of
    `buildBpmnModel(...).descendantsOf(container)` (computed on `before`)
    whose x/y is unchanged in `after` by the container delta, via
    `updateVisual` with only `x`/`y`.
  - Shift each element once, by its outermost moved ancestor only. Lanes
    restacked by layout already have changed x/y and are therefore skipped
    as elements; their non-lane descendants are shifted.
  - Flows need no command: waypoints are endpoint-relative.
- `planBpmnMembership(before: Store, after: Store): Command[]`
  - Candidates: BPMN node, data and annotation elements (not lanes,
    participants or flows) on pages with `kind === "bpmn"` that are new in
    `after` or whose x/y changed.
  - New parent = the deepest container whose box contains the element
    centre, excluding itself and its descendants; depth order: expanded
    subProcess, then lane, then participant (a participant that has lanes
    is never chosen when a lane contains the centre).
  - `updateSemantic` carries the WHOLE payload (the command replaces the
    semantic, commands.ts:563-573): copy the payload, set `parent`, or
    delete the key when no container contains the centre. Emit only when
    the value changes.
  - `bpmn.boundaryEvent`: never re-parented; snap its centre onto the
    nearest point of the host box border (`updateVisual` x/y).
- `addBpmnLaneCommands(document: Document, parentId: ElementId, newId:
  ElementId, index: FractionalIndex): Command[]` (design 4.4)
  - Parent without lanes: new lane covers the parent body (x + 30, y,
    width - 30, full height); the parent's direct non-lane members
    (`semantic.parent === parentId`) are re-parented to the new lane.
  - Otherwise: append a lane 120 tall below the last child lane, same x and
    width, and grow the parent and every ancestor lane/participant height
    by 120.
  - `name: "Lane"`.

### packages/core/src/editor.ts

- `Editor.apply` (editor.ts:925-1026): inside the existing derived-planning
  block, right after the `derived = [ ... ]` assignment that ends with
  `planConstraints(this.store, draft, this.registry)` (editor.ts:~1000) and
  before `const beforeLayout = ...`, push in this order:
  `planBpmnLaneLayout(this.store, draft)`,
  `planBpmnTranslations(this.store, draft)`,
  `planBpmnMembership(this.store, draft)`. Call them once only (not at the
  second `planFrameTranslations` site). Skip all three when no page has
  `kind === "bpmn"` and no element type starts with `bpmn.`. They become
  part of the same history entry automatically.
- Do NOT touch `reconcileDerivedState` (editor.ts:1029), History, or
  `applyCommands`.
- `EDITABLE_FIELDS` (editor.ts:151): add every `bpmn.*` node, container and
  flow type -> `"name"`; `bpmn.textAnnotation` -> `"text"`. Associations
  and data associations have no name: leave them out.
- `connectSmart` (editor.ts:2505): after the existing same-page check and
  before the sequence branch, if both endpoint types start with `bpmn.`,
  return `connectBpmn(from, to, undefined, applyOptions)` mapped to `id` on
  ok and `null` on rejection.
- `connectBpmn`: same-page and lock checks as the sequence branch
  (editor.ts:2516-2518; locked -> rejection `invalidEndpoint`), then
  `resolveBpmnConnection(this.store.getSnapshot(), ...)`. On ok, one
  `createElement` via `this.createElement(type, { page, semantic: {from,
  to, routing: "orthogonal"} (+ direction: "none" for associations) },
  applyOptions)`. On rejection, notify `onBpmnRejection` listeners and
  apply nothing.
- `reconnectBpmnFlow(id, end, target)`: compute would-be `from`/`to`, call
  `resolveBpmnConnection(doc, from, to, currentType)`.
  - ok, same type: one `updateSemantic` with the whole payload and the end
    rewritten.
  - ok, corrected type: ONE `apply` batch: (1) collect dependants = every
    element whose registry `references` include `id`, transitively, with
    their exact current content; (2) `deleteElements([id])`; (3)
    `createElement` of the new type with the same id, page, index and
    visual, semantic `{from, to, name?, routing fields}` (drop
    `condition`/`isDefault`/`messageRef` that do not exist on the target
    type); (4) `createElement` of each dependant unchanged, in index order.
    This is review DR-3.
  - rejection: notify listeners, return it, apply nothing.
- `updateBpmnSemantic(id, semantic)`: for `bpmn.event` when `position`
  changes to `start` while `model.incoming(id).length > 0` ->
  `startEventIncoming`; to `end` while `outgoing.length > 0` ->
  `endEventOutgoing`. Otherwise one `updateSemantic`. The element id never
  changes, so flows stay connected. Validation errors from the payload
  propagate as `CommandError` exactly as `apply` does today.
- `addBpmnLane(parentId)`: parent must be `bpmn.participant` or
  `bpmn.lane`, else `invalidEndpoint`; apply `addBpmnLaneCommands` with
  `this.idSource()` and a z-order index computed as follows (NOT
  `this.nextIndex(page)`, which puts the lane on top of the tasks it
  contains):
  - `ordered = this.store.getPageElements(page)` (bottom to top,
    store.ts:120).
  - `lower` = the parent's index when the parent has no child lanes,
    otherwise the highest index among the lanes in
    `buildBpmnModel(...).descendantsOf(parentId)`.
  - `upper` = the index of the element directly after the `lower` element
    in `ordered`, or `null` when it is the last one.
  - `index = keyBetween(lower, upper, this.rng)` (`keyBetween`,
    packages/core/src/fractional.ts:104; import it from `./fractional.ts`).
    If `keyBetween` throws `RangeError` (a foreign non-fractional or
    duplicate key), fall back to `this.nextIndex(page)`.
  - Result: the lane sits directly above its pool/sibling lanes and below
    the member nodes, and sibling lane index order equals the top-to-bottom
    stacking order that `planBpmnLaneLayout` uses (each new lane is both
    lower on the canvas and higher in index than earlier siblings).
- `onBpmnRejection`: a listener `Set` with an unsubscribe closure; imitate
  `subscribe` (editor.ts:346).

## Pitfalls

- Never throw for rule violations; return `{ok: false}`.
- Z-order of containers: pools, lanes and expanded sub-processes are big
  filled boxes (white fill, bpmn-04). `hitTestPoint`
  (packages/core/src/hit-test.ts:142) walks page elements from the highest
  index down and a lane hit-tests on its whole box, so a container created
  above its members hides them on the canvas and in `exportPageSvg` and
  steals every click and connect gesture aimed at them. New lanes must get
  the `keyBetween` index described under `addBpmnLane`. Do not solve this
  in `applyCommands`, History or clipboard.
- Lane resize: Phase A must only fire when the lane's parent box is
  unchanged in the incoming batch, otherwise add-lane and pool resize grow
  the pool twice.
- Undo must restore exactly: History replays through `applyCommands`
  (editor.ts:300-302) with no BPMN checks. Do not add checks there.
- Planners must apply their commands to `draft`; otherwise membership is
  computed on stale positions and the second pass of autolayout misses
  them.
- `planBpmnMembership` must not fight translations: children moved with
  their container stay inside it, so recomputation yields the same parent
  and no command.
- A deleted-and-recreated id in one batch (reconnect correction): verify
  with a test that `applyCommands` accepts it and that one `undo()`
  restores the original flow and dependants.
- Pool-less pages: `scopeOf` is the page id, sequence flows are allowed and
  message flows are rejected as `samePoolMessageFlow`.
- Do not change the non-BPMN branches of `connectSmart` or `connect`.
- Import cycles: `editor.ts` imports `./bpmn/connection.ts`,
  `./bpmn/containment.ts` and `./bpmn/model.ts` directly, never the
  `./bpmn/index.ts` barrel (the barrel later re-exports `routes.ts`, which
  references `Editor`).

## Tests (input -> expected)

`connection.test.ts`:
- tasks in two lanes of one pool, requested messageFlow -> ok
  sequenceFlow, corrected true
- task in pool A to task in pool B, requested sequenceFlow -> ok
  messageFlow, corrected true
- task to start event, same pool -> `startEventIncoming`
- end event to task, same pool -> `endEventOutgoing`
- task to boundary event -> `boundaryIncoming`
- task in a subProcess to a task outside it, same pool -> `crossScope`
- gateway to task in another pool -> `invalidEndpoint`
- task to dataObject -> dataAssociation; annotation to task -> association
- collapsed pool to task in another pool -> messageFlow
- task to itself -> `invalidEndpoint`
- no pools, two tasks, requested messageFlow -> ok sequenceFlow corrected

`containment.test.ts`:
- task created with centre inside lane 2 -> `parent` = lane 2
- moved into lane 1 -> lane 1; moved outside the pool -> `parent` key
  absent
- pool moved by (+100, +50) -> lanes, tasks, boundary events and
  subProcess children shift by exactly (+100, +50); flows unchanged
- `addBpmnLane` on a pool without lanes -> one lane covering the body,
  pool members re-parented to it; again -> second lane 120 tall below,
  pool height +120
- pool height resized -> child lanes stay stacked without gaps
- sibling lane resize: pool at (0, 0) 600x360 with lanes A/B/C (120 tall
  each, A.y = 0, B.y = 120, C.y = 240) and a task in B; one `apply` of
  `updateVisual` A height 200 -> A.height 200, B.y = A.y + 200 = 200,
  C.y = B.y + 120 = 320, B and C heights 120, pool height 440 (+80), no
  gaps or overlaps (each lane y = previous y + previous height, last lane
  bottom = pool bottom); the task's y is +80 and its `parent` is still B;
  one `undo()` restores every lane, the pool and the task deep-equal
- sibling lane shrink: same setup, A height set to 10 -> A clamped to 30,
  B.y = 30, pool height 270
- nested: lane A has child lanes A1/A2; A1 height +40 -> A2.y +40, A
  height +40, B and C y +40, pool height +40
- z-order: pool with a task inside it; `addBpmnLane(pool)` -> pool.index <
  lane.index < task.index (compare with `compareFractional`) and
  `editor.hitTest(task centre) === taskId`; a second `addBpmnLane(pool)`
  -> its index is greater than the first lane's and less than the task's,
  and `hitTest(task centre)` still returns the task id

`editor-bpmn.test.ts`:
- the four acceptance cases through `connectBpmn` (corrections create the
  corrected type; rejections create nothing), through `connectSmart`
  (returns null on rejection) and through `reconnectBpmnFlow` (moving a
  sequence flow end into another pool converts it to a message flow with
  the same id)
- `onBpmnRejection` listener called once per rejection; unsubscribe works
- `updateBpmnSemantic`: catch -> throw keeps flows; event with an incoming
  flow switched to start -> rejected and unchanged; task user -> service
  keeps id and flows
- DR-1 regression: an Editor built from a document with an illegal
  sequence flow out of an end event; `deleteElements([endEvent])` then
  `undo()` -> event and flow restored deep-equal, no throw; `redo()`
  removes them again
- legal `connectBpmn` then `undo()` then `redo()` -> flow exists with the
  same id
- copy/paste and `duplicateSelection` of a selection containing an illegal
  flow and both endpoints -> succeeds (editor.ts:1362, 1376)
- DR-3: annotation associated to a sequence flow; `reconnectBpmnFlow`
  that corrects the flow to a message flow -> the association still
  exists pointing at the same id; one `undo()` restores the original
  sequence flow
- moving a task into another lane through `apply` -> one history entry;
  one `undo()` restores both position and parent
- `editor.editableField(taskId) === "name"`; annotation -> `"text"`
- an ERD page connectSmart between two tables behaves as before (one
  regression assertion)

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck                                    # exit 0
bunx biome check packages/core/src/bpmn packages/core/src/editor.ts   # exit 0
bun test packages/core/src/bpmn/connection.test.ts packages/core/src/bpmn/containment.test.ts packages/core/src/bpmn/editor-bpmn.test.ts   # exit 0, pass count > 0, 0 fail (owned tests, design 11.1 rule 1)
bun test packages/core                               # exit 0 (existing core tests unchanged and passing)
bun test packages/ui-solid packages/collab           # exit 0 (connectSmart and apply callers unaffected)
```

## Done criteria

- `grep -n "resolveBpmnConnection\|bpmn" packages/core/src/commands.ts`
  returns nothing.
- `grep -n "planBpmn" packages/core/src/editor.ts` shows exactly one call
  site for each of the three planners (plus import lines), all inside
  `apply`, none inside `reconcileDerivedState`, in the order
  `planBpmnLaneLayout`, `planBpmnTranslations`, `planBpmnMembership`.
- `grep -n "keyBetween" packages/core/src/editor.ts` shows the
  `addBpmnLane` use; `addBpmnLane` does not call `this.nextIndex` except in
  the `RangeError` fallback.
- `packages/core/src/bpmn/index.ts` contains the two new lines exactly
  once and still contains the bpmn-01 line.
- All tests above exist and pass; exit codes recorded in the progress log.
