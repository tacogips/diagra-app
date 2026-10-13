# bpmn-01-ir-core-contract

- planId: bpmn-01-ir-core-contract
- planPath: impl-plans/active/bpmn-01-ir-core-contract.md
- wave: 1; dependsOn: none
- design: design-docs/specs/design-bpmn.md sections 3.1-3.5, 4.1, 4.4
  (shape utils, default sizes), 5.2 (waypoint-basis move), 11 (ir tests)
- progress log: impl-plans/progress/bpmn-01-ir-core-contract.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Intent

Pin the shared BPMN data contract every other plan builds on:
- the `bpmn` page kind and the 16 `bpmn.*` element types with typed
  semantic payloads, registry validation and key order
- `Visual.labelBounds`
- the waypoint-basis math, moved into `@diagra/ir` (io needs it, io cannot
  import core)
- the core read-only model view (`packages/core/src/bpmn/model.ts`)
- core shape utils and outlines for the BPMN types
- the `packages/core/src/bpmn/index.ts` barrel

Nothing in this plan changes behaviour of existing page kinds.

## Non-goals

- connection rules, editor intent methods, containment (bpmn-03)
- rendering and notation (bpmn-04), lint (bpmn-05), XML (bpmn-06), UI,
  CLI, desktop
- no schema version bump and no migration entry
- no `EDITABLE_FIELDS` change (bpmn-03 owns `editor.ts`)

## writePaths

- packages/ir/src/types.ts
- packages/ir/src/semantics.ts
- packages/ir/src/registry.ts
- packages/ir/src/validate.ts
- packages/ir/src/keyOrder.ts
- packages/ir/src/connector-waypoints.ts (new)
- packages/ir/src/index.ts
- packages/ir/src/bpmn.test.ts (new)
- packages/core/src/bpmn/model.ts (new)
- packages/core/src/bpmn/model.test.ts (new)
- packages/core/src/bpmn/index.ts (new)
- packages/core/src/index.ts
- packages/core/src/shapes/bpmn.ts (new)
- packages/core/src/shapes/bpmn.test.ts (new)
- packages/core/src/shapes/index.ts
- packages/core/src/shapes/outline.ts
- packages/core/src/shapes/connector.ts
- packages/io/src/jsonl/bpmn-compat.test.ts (new)
- impl-plans/progress/bpmn-01-ir-core-contract.md

sharedPaths: none. (bpmn-01 creates `packages/core/src/bpmn/index.ts`;
wave-2 plans append to it afterwards.)

## File-level changes

### packages/ir/src/types.ts

- Append `"bpmn"` as the last entry of `PAGE_KINDS` (types.ts:25). Do not
  reorder existing entries.
- Add `export interface LabelBounds { readonly x: number; readonly y:
  number; readonly width: number; readonly height: number }`.
- Add `readonly labelBounds?: LabelBounds;` to `Visual` (types.ts:217),
  documented as "BPMN label box in page units; renderers fall back to a
  default placement when absent".

### packages/ir/src/semantics.ts

Imitate `PARTICIPANT_KINDS` (semantics.ts:57) for `as const` enums and
`SequenceMessageSemantic` (semantics.ts:302) for interfaces.

Enums (`as const` arrays plus derived union types):
- `BPMN_TASK_TYPES` = none, user, service, manual, send, receive, script,
  businessRule
- `BPMN_LOOP_TYPES` = none, standard, parallelMultiInstance,
  sequentialMultiInstance
- `BPMN_EVENT_POSITIONS` = start, intermediateCatch, intermediateThrow, end
- `BPMN_EVENT_DEFINITION_KINDS` = message, timer, error, escalation, cancel,
  compensation, conditional, link, signal, terminate
- `BPMN_TIMER_TYPES` = date, duration, cycle
- `BPMN_GATEWAY_TYPES` = exclusive, parallel, inclusive, eventBased, complex
- `BPMN_DATA_OBJECT_ROLES` = reference, input, output
- `BPMN_ASSOCIATION_DIRECTIONS` = none, one, both

Interfaces exactly per design 3.2 (all `name` optional strings):
- `BpmnEventDefinition`: `{ id: string; kind; ref?: string; linkName?:
  string; timer?: { type; value: string }; condition?: string }`
- `BpmnParticipantSemantic`: `name?`, `collapsed: boolean`, `processRef?`
- `BpmnLaneSemantic`: `name?`, `parent: ElementId`
- `BpmnTaskSemantic`: `name?`, `taskType`, `loop`, `forCompensation?`,
  `parent?`
- `BpmnSubProcessSemantic`: `name?`, `expanded`, `triggeredByEvent`,
  `adHoc`, `loop`, `forCompensation?`, `parent?`
- `BpmnCallActivitySemantic`: `name?`, `calledElement?`, `loop`,
  `forCompensation?`, `parent?`
- `BpmnEventSemantic`: `name?`, `position`, `definitions: readonly
  BpmnEventDefinition[]`, `interrupting?`, `parallelMultiple?`, `parent?`
- `BpmnBoundaryEventSemantic`: `name?`, `attachedTo: ElementId`,
  `cancelActivity: boolean`, `definitions`
- `BpmnGatewaySemantic`: `name?`, `gatewayType`, `markerVisible?`,
  `parent?`
- `BpmnDataObjectSemantic`: `name?`, `role`, `collection: boolean`,
  `parent?`
- `BpmnDataStoreSemantic`: `name?`, `parent?`
- `BpmnTextAnnotationSemantic`: `text: string`, `parent?`
- `BpmnGroupSemantic`: `name?`
- `BpmnSequenceFlowSemantic extends ConnectorRoutingSemantic`: `from`,
  `to`, `name?`, `condition?`, `isDefault?`
- `BpmnMessageFlowSemantic extends ConnectorRoutingSemantic`: `from`, `to`,
  `name?`, `messageRef?`
- `BpmnAssociationSemantic extends ConnectorRoutingSemantic`: `from`, `to`,
  `direction`
- `BpmnDataAssociationSemantic extends ConnectorRoutingSemantic`: `from`,
  `to`

Then:
- Add all 16 entries to `SemanticByType` (semantics.ts:540), keyed
  `"bpmn.participant"`, `"bpmn.lane"`, `"bpmn.task"`, `"bpmn.subProcess"`,
  `"bpmn.callActivity"`, `"bpmn.event"`, `"bpmn.boundaryEvent"`,
  `"bpmn.gateway"`, `"bpmn.dataObject"`, `"bpmn.dataStore"`,
  `"bpmn.textAnnotation"`, `"bpmn.group"`, `"bpmn.sequenceFlow"`,
  `"bpmn.messageFlow"`, `"bpmn.association"`, `"bpmn.dataAssociation"`.
- Export `BPMN_ELEMENT_TYPES` (readonly tuple of those 16 strings in that
  order) and `isBpmnElementType(type: string): boolean`.

### packages/ir/src/registry.ts

One `ElementTypeDefinition` const per type. Imitate `SEQUENCE_MESSAGE`
(registry.ts:846) and `GENERIC_EDGE` (registry.ts:266). Append them to
`DEFINITIONS` (registry.ts:1766).

- Categories: container = participant, lane, subProcess; annotation =
  textAnnotation, group; edge = the four flow types; node = the rest.
- `onReferenceDeleted: "cascade"` for all 16.
- `references`: use `refFields` (registry.ts:94): `["parent"]` for every
  node-like type that has `parent` (lane included), `["attachedTo"]` for
  boundary events, `["from", "to"]` for flows, none for participant and
  group.
- `keyOrder.keys`: `name` (or `text`) first, discriminators next, flags,
  refs last. Flows: `["from", "to", "name", "condition", "isDefault",
  "messageRef", "direction", "routing", "routingAxis", "routingBend",
  "routingAvoidObstacles", "routingWaypoints"]` with
  `children: { routingWaypoints: { keys: ["u", "v"] } }` (copy the routing
  part of `GENERIC_EDGE`). Events: `children: { definitions: { keys:
  ["id", "kind", "ref", "linkName", "timer", "condition"], children: {
  timer: { keys: ["type", "value"] } } } }` (check how existing
  definitions declare array-item key orders, e.g. ERD columns, and follow
  that exact shape).
- `validateSemantic` is structural only:
  - enums via `checkEnum`, strings via `checkString` (`optional: true,
    allowEmpty: true` for names), booleans via `checkBoolean`
  - required: lane `parent`, boundary `attachedTo`, flow `from`/`to`,
    participant `collapsed`, task `taskType`/`loop`, subProcess
    `expanded`/`triggeredByEvent`/`adHoc`/`loop`, event `position`/
    `definitions`, gateway `gatewayType`, dataObject `role`/`collection`,
    association `direction`, textAnnotation `text` (empty allowed)
  - flows: call the existing `validateConnectorRouting` (registry.ts:~122)
  - `definitions`: an array (`checkArray`) of objects; each item has a
    non-empty string `id`, unique within the array (else error code
    `bpmn.definitionIdDuplicate`), `kind` in the enum, optional
    `timer.type` in the enum and `timer.value` string.
- Do NOT validate which definitions fit which position and do NOT validate
  flow legality. Imported imperfect models must load.

### packages/ir/src/validate.ts

- Validate `visual.labelBounds` next to the `strokeBounds`/`layoutGrow`
  checks (validate.ts:227-232): optional object with four finite numbers,
  `width >= 0`, `height >= 0` (use `checkObject`/`checkNumber` with
  `min: 0`).
- Document-level warnings in the `checkReferences` loop next to
  `reference.dangling` (validate.ts:771-795), only for elements whose
  type starts with `bpmn.` and whose target exists:
  - `bpmn.parentType`: `parent` points to an element that is not
    `bpmn.lane`, `bpmn.participant` or `bpmn.subProcess`; for a
    `bpmn.lane`, only participant or lane is allowed.
  - `bpmn.attachedToType`: `attachedTo` points to an element that is not
    `bpmn.task`, `bpmn.subProcess` or `bpmn.callActivity`.
  - Use `warning(...)`, never `error(...)`.

### packages/ir/src/keyOrder.ts

In `VISUAL_KEY_ORDER` (keyOrder.ts:83):
- insert `"labelBounds"` into `keys` right after `"strokeBounds"`; this
  also makes it a known key for `warnUnknownFields` (validate.ts:349) and
  for the JSONL reader's split.
- add `labelBounds: { keys: ["x", "y", "width", "height"], coordinates:
  ["x", "y", "width", "height"] }` to `children`, so the canonical writer
  (packages/io/src/jsonl/canonical.ts:120-129) rounds the nested numbers.

### packages/ir/src/connector-waypoints.ts (new), connector.ts, ir index.ts

- Move `connectorWaypointToPage` and `connectorWaypointFromPage`
  (packages/core/src/shapes/connector.ts:110-149) verbatim into the new ir
  file. Use a local `interface PagePoint { readonly x: number; readonly y:
  number }` and the ir `ConnectorWaypoint` type.
- In connector.ts delete the two bodies and add exactly two lines:
  `import { connectorWaypointFromPage, connectorWaypointToPage } from
  "@diagra/ir";` (connector.ts still calls both internally, at
  connector.ts:207 and connector.ts:529; a bare `export ... from` creates
  no local binding) and `export { connectorWaypointFromPage,
  connectorWaypointToPage } from "@diagra/ir";`. If connector.ts already
  imports from `@diagra/ir`, add the two names to that existing import
  instead of a new import line. Every existing import of these names from
  core must keep compiling. Change nothing else in connector.ts.
- `packages/ir/src/index.ts` uses named exports: add named exports for both
  functions, `LabelBounds`, every new enum constant and type, every
  `Bpmn*Semantic` interface, `BpmnEventDefinition`, `BPMN_ELEMENT_TYPES`
  and `isBpmnElementType`.

### packages/core/src/bpmn/model.ts (new)

Pure read model used by editing, lint and notation. Pinned contract:

```ts
export type BpmnScopeId = string; // participant id, subProcess id, or page id (implicit process)
export interface BpmnModel {
  readonly pageId: PageId;
  readonly elements: ReadonlyMap<ElementId, Element>; // bpmn.* elements of the page
  readonly order: readonly ElementId[];               // page element index order (fractional index, then id)
  get(id: ElementId): Element | undefined;
  parentOf(id: ElementId): ElementId | undefined;     // semantic.parent; boundary event -> host's parent
  participantOf(id: ElementId): ElementId | undefined; // a collapsed participant is its own participant
  scopeOf(id: ElementId): BpmnScopeId;                // nearest subProcess ancestor, else participant, else pageId
  incoming(id: ElementId): readonly Element[];        // bpmn.sequenceFlow only, index order
  outgoing(id: ElementId): readonly Element[];        // bpmn.sequenceFlow only, index order
  boundaryEventsOf(activityId: ElementId): readonly Element[];
  descendantsOf(containerId: ElementId): readonly ElementId[]; // transitive via parent, plus attached boundary events
  scopes(): readonly BpmnScopeId[]; // expanded participants, subProcesses, and pageId when parent-less flow nodes exist
}
export function buildBpmnModel(document: Document, pageId: PageId): BpmnModel;
export function isBpmnFlowNode(type: string): boolean; // task, subProcess, callActivity, event, boundaryEvent, gateway
export function isBpmnActivity(type: string): boolean; // task, subProcess, callActivity
export function isBpmnFlowType(type: string): boolean; // the four edge types
```

Rules:
- A collapsed participant (`collapsed: true`) is not a scope.
- A boundary event's scope and participant are its host's.
- Walking `parent` stops at missing references and at cycles (visited
  set); a cycle means "no participant" and scope = page id.
- Element order: sort by `index` with the same comparator the store uses
  for page elements (find it in core `store.ts`; do not invent one).

### packages/core/src/bpmn/index.ts (new) and packages/core/src/index.ts

- Barrel content: exactly `export * from "./model.ts";`.
- Add `export * from "./bpmn/index.ts";` at the end of
  `packages/core/src/index.ts`. `bun run typecheck` fails on duplicate
  names; rename yours if it clashes.

### packages/core/src/shapes/bpmn.ts (new) and shapes/index.ts

ShapeUtils for the 12 node, container and annotation types. Imitate
`packages/core/src/shapes/node.ts` (bounds from visual x/y/width/height).

- `canResize`: true for task, subProcess, callActivity, participant, lane,
  dataStore, textAnnotation, group; false for event, boundaryEvent,
  gateway, dataObject.
- `defaultVisual` sizes (design 4.4): participant 600x250, lane 570x120,
  task and callActivity 100x80, subProcess 100x80, event and boundaryEvent
  36x36, gateway 50x50, dataObject 36x50, dataStore 50x50, textAnnotation
  100x30, group 200x150.
- `defaultSemantic`: participant `{name: "Pool", collapsed: false}`; lane
  `{name: "Lane", parent: ""}`; task `{name: "Task", taskType: "none",
  loop: "none"}`; subProcess `{name: "Sub-process", expanded: false,
  triggeredByEvent: false, adHoc: false, loop: "none"}`; callActivity
  `{name: "Call activity", loop: "none"}`; event `{name: "", position:
  "start", definitions: []}`; boundaryEvent `{name: "", attachedTo: "",
  cancelActivity: true, definitions: []}`; gateway `{name: "",
  gatewayType: "exclusive"}`; dataObject `{name: "Data object", role:
  "reference", collection: false}`; dataStore `{name: "Data store"}`;
  textAnnotation `{text: ""}`; group `{name: ""}`. Lane and boundary
  defaults are not valid alone; callers (bpmn-03, bpmn-09) set the refs.
- `hitTest`: events inside the circle, gateways inside the diamond,
  everything else inside the box.
- Flow types: `createConnectorUtil({ type, readEndpoints:
  readDirectEndpoints, defaultSemantic })` exactly like `edgeShapeUtil`
  (packages/core/src/shapes/edge.ts); default semantic `{from: "", to:
  ""}` plus `direction: "none"` for associations.
- Register all 16 in `createDefaultRegistry` (shapes/index.ts:26) after
  `groupShapeUtil`.

### packages/core/src/shapes/outline.ts

In `elementOutlinePolygon` (outline.ts:87) add branches so connector
docking lands on the true outline:
- `bpmn.event`, `bpmn.boundaryEvent`: `geoOutlinePolygon("ellipse", box)`
- `bpmn.gateway`: `geoOutlinePolygon("diamond", box)`
- `bpmn.task`, `bpmn.subProcess`, `bpmn.callActivity`:
  `roundedRectPolygon(box, ...)` (packages/core/src/corner-radii.ts:76)
  with radius 10 on every corner.

## Pitfalls

- Adding `"bpmn"` changes `PageKind`. Grep `PageKind` and `PAGE_KINDS` in
  packages and apps; add a `bpmn` entry only where the compiler demands it.
  The inspector kind `<select>` (ui-solid inspector/SimpleSections.tsx:113)
  iterates `PAGE_KINDS` and needs no change.
- Do not turn `type.unknown` or any existing warning into an error.
- Do not bump `SCHEMA_VERSION` (packages/ir/src/migrations.ts).
- `labelBounds` must survive the JSONL parse as a visual key, not land in
  `extensions`; the key-order edit above is what achieves this.
- The moved waypoint functions must keep their exact rounding (u to 1e-6,
  v to 0.01); existing connector tests pin it.

## Tests (input -> expected)

`packages/ir/src/bpmn.test.ts`:
- each of the 16 types with a minimal valid payload in a valid document ->
  no error issues
- task `taskType: "robot"` -> `value.enum` error
- event `definitions` with two items `id: "d1"` ->
  `bpmn.definitionIdDuplicate` error
- sequence flow missing `to` -> a missing-field error (use the code
  `checkString` emits)
- task whose `parent` is a task -> `bpmn.parentType` warning, document
  still valid (no errors)
- boundary event attached to a gateway -> `bpmn.attachedToType` warning
- `labelBounds` with negative width -> error; valid `labelBounds` -> no
  `field.unknown`
- page `kind: "bpmn"` -> valid
- `connectorWaypointFromPage` then `connectorWaypointToPage` -> the point
  back within 0.01

`packages/core/src/bpmn/model.test.ts`:
- pool, two lanes, task in lane 2 -> `participantOf(task)` = pool,
  `scopeOf(task)` = pool
- task in a subProcess in a lane -> `scopeOf` = subProcess
- boundary event on that task -> same scope as the host
- no pools -> `scopeOf` = page id and `scopes()` contains the page id
- `incoming`/`outgoing` count only sequence flows (a message flow and an
  association on the same node are ignored)
- lane whose parent is itself -> no throw, `participantOf` undefined
- `descendantsOf(pool)` includes lanes, nodes in lanes, boundary events

`packages/core/src/shapes/bpmn.test.ts`:
- event hit test at box corner -> false; at centre -> true
- gateway hit test at box corner -> false
- `createDefaultRegistry().get("bpmn.sequenceFlow")` -> defined
- `resolveConnector` from an event to a task -> start point distance from
  the event centre is 18 +- 1

`packages/io/src/jsonl/bpmn-compat.test.ts`:
- every top-level `packages/io/src/__fixtures__/*.jsonl` -> parses with
  `ok === true`, no error-severity issues, no issue code starting with
  `bpmn.`, and `serializeDocument(parse(text))` equals the canonical text
  exactly as `golden.test.ts` asserts today
- a hand-written bpmn page (pool, lane, task with `labelBounds`
  `{x: 10.123456, ...}`, sequence flow) -> serialize/parse/serialize is
  byte-identical, `labelBounds` stays in `visual` (not `extensions`), and
  its numbers are rounded like other coordinates

## Verification (record exit codes and counts in the progress log)

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck                                   # exit 0
bunx biome check packages/ir/src packages/core/src/bpmn packages/core/src/shapes packages/core/src/index.ts packages/io/src/jsonl   # exit 0
bun test packages/ir packages/core/src/bpmn packages/core/src/shapes packages/io   # exit 0, new tests listed in output
bun test                                            # exit 0 (whole repo, no regressions)
```

## Done criteria

- `grep -n '"bpmn"' packages/ir/src/types.ts` shows the `PAGE_KINDS` entry.
- `grep -c 'type: "bpmn\.' packages/ir/src/registry.ts` returns 16.
- `grep -c 'labelBounds' packages/ir/src/keyOrder.ts` returns at least 2.
- `grep -n 'export function connectorWaypoint' packages/core/src/shapes/connector.ts`
  returns nothing (moved), and `grep -n connectorWaypointFromPage packages/ir/src/index.ts`
  returns a line.
- `packages/core/src/bpmn/index.ts` contains exactly one export line.
- `git diff --stat packages/ir/src/migrations.ts` is empty.
- All four verification commands exit 0; the progress log lists file
  hashes and test counts.
