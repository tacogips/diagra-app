# BPMN 2.0 Operation Flow Pages

Status: design baseline for branch `feat/bpmn-operation-flow`.
Issue: "BPMN 2.0 operation flow (business process) diagrams in diagra"
(workflow intake comm-006074 / comm-006075; no GitHub issue number).

Revision (continuation run, intake comm-006094): the baseline is unchanged.
Only the test-ownership contract was amended: section 3.5 evidence, section
11 test list and the new section 11.1. Wave 1 stopped because
`packages/ir/src/registry.test.ts` and `packages/io/src/jsonl/golden.test.ts`
pin the element-type list, and no slice owned them.

Revision (continuation run 2, intake comm-006132): the baseline is
unchanged. Only the verification gate was amended: rule 3 of section 11.1
(parallel-wave typecheck and test race). bpmn-07 finished with passing
tests but was blocked by repo-wide typecheck diagnostics in half-finished
files owned by sibling plans of the same wave.

Revision (rendering-defect run, intake comm-006277, follow-up to 83717b5):
end-to-end verification found flows hidden under pools and lanes, and
placeholder task-type icons. Changed sections: 6.1 (task icon geometry,
unfilled group, label offset origin), 6.2 (export passes the resolved box),
new 6.4 (BPMN connector backdrops and routing obstacles), 11 (regression
tests) and 13 (flows still pass beneath flow nodes). The rest of the
baseline is unchanged.

## 1. Context and baseline

- No `design-docs/` or `impl-plans/` existed on this branch. This is the
  first design document. `design-docs/specs/product-design.md` (referenced by
  AGENTS.md) and `design-docs/specs/export.md` (PNG/PDF export, other branch)
  are not available here. This design depends only on the code on this branch.
- Observed repository facts that shape the design:
  - `PAGE_KINDS` (`packages/ir/src/types.ts:25`) is
    `freeform|erd|uml|sequence|architecture`. No code selects a tool palette
    from `page.kind`.
  - Elements are `{id, page, type, index, semantic, visual, extensions}`.
    Types are registered in `packages/ir/src/registry.ts`. Their payloads are
    typed in `packages/ir/src/semantics.ts` (`SemanticByType`).
  - Edges reference endpoints through semantic `from`/`to`. Containment is
    explicit (`memberIds` on frames and groups). There is no `parentId`.
  - Deleting an element cascades or detaches per type
    (`onReferenceDeleted`, `packages/core/src/commands.ts:158`).
  - `SCHEMA_VERSION = 1` and no migration has ever been registered
    (`packages/ir/src/migrations.ts`). Additive fields, such as
    `Page.sqlDialect`, were added without a version bump.
  - Unknown element types load with a `type.unknown` warning. An unknown page
    kind is a `value.enum` error.
  - `packages/io` depends only on `@diagra/ir`, and `@diagra/core`
    dev-depends on `@diagra/io`. The io adapters therefore cannot import core.
  - There is no XML parser anywhere in the workspace.
  - Connectors are created through `Editor.connectSmart`
    (`packages/core/src/editor.ts:2505`). Nothing rejects a connection based
    on what it connects.
  - Manual connector waypoints are stored as `{u, v}` in an endpoint-centre
    basis (`connectorWaypointToPage` / `connectorWaypointFromPage`,
    `packages/core/src/shapes/connector.ts:110-149`).
  - SVG export (`packages/core/src/svg-export.ts`) is a second renderer with
    its own per-type switch. It shares geometry with ui-solid, not markup.
  - The desktop File menu is HTML (`apps/desktop/src/App.tsx:729-791`). There
    is no native Rust menu.
  - Opening by extension goes through `apps/desktop/src/file/session.ts`. The
    Mermaid case is imported into a detached document.
  - The open-dialog filter is in `apps/desktop/src-tauri/src/dialogs.rs:14`.
    macOS file associations are in
    `apps/desktop/src-tauri/tauri.macos.release.conf.json`.
  - `diagra-cli` uses a flat switch (`apps/cli/src/commands.ts:365`) with
    exit codes 0 OK, 1 drift, 2 error/usage and 3 strict warnings. `ddl`
    implements `--output`, `--check` (`normalizeNewlines`) and `--strict`.
- Reference material in `.reference/bpmn-article` (local-only, unlicensed) is
  read only for verification. Nothing from it is copied. Fixtures,
  labels, ids and rule descriptions in this repository are original.

## 2. Goals and non-goals

Goals: everything in the intake acceptance signals:
- the page kind and typed elements
- notation in the UI and SVG export
- connection rules
- a bpmnlint-equivalent lint in the CLI and desktop
- BPMN 2.0 XML import and export with `--check`
- desktop menus and `.bpmn` opening
- documentation and an original example

Target conformance is the Analytic subclass. The default palette is
Descriptive.

Non-goals:
- choreography, conversation and transaction semantics
- executable or Camunda attributes (they are preserved opaquely only)
- vertical pools (imported with a warning and drawn horizontally)
- PNG/PDF export and a generic `diagra-cli export`
- a native Tauri menu
- a desktop-editable lint config
- bpmn.io runtime dependencies

## 3. Data model (packages/ir)

### 3.1 Page kind

Add `"bpmn"` to the end of `PAGE_KINDS`. The kind selects the BPMN palette
(section 6.3). It never restricts which element types a page may hold, which
matches the existing contract in the comment at `types.ts:21-24`.

### 3.2 Element types

All types use the `bpmn.` namespace.

Every node payload has an optional `parent?: ElementId`. It points to the
innermost semantic container:
- a `bpmn.lane`
- a `bpmn.participant` that has no lanes
- an expanded or collapsed `bpmn.subProcess`

Membership is stored once, on the member. The member owns the field, so a
move between lanes edits one record (good for AI diffs and collab merges).
Lane `flowNodeRef` lists and process membership are derived from it.

A node with no `parent` belongs to the page's implicit process. That is only
valid when the page has no participants (section 5.4 covers export).

| type | category | semantic payload (all `name` fields optional strings; `\n` allowed) | refs / onReferenceDeleted |
|---|---|---|---|
| `bpmn.participant` | container | `name`, `collapsed: boolean` (black-box pool, no process), `processRef?: string` (XML process id) | none / cascade |
| `bpmn.lane` | container | `name`, `parent: ElementId` (participant or lane; nested lanes) | parent / cascade |
| `bpmn.task` | node | `name`, `taskType: none\|user\|service\|manual\|send\|receive\|script\|businessRule`, `loop: none\|standard\|parallelMultiInstance\|sequentialMultiInstance`, `forCompensation?: boolean`, `parent?` | parent / cascade |
| `bpmn.subProcess` | container | `name`, `expanded: boolean`, `triggeredByEvent: boolean` (event sub-process), `adHoc: boolean`, `loop`, `forCompensation?`, `parent?` | parent / cascade |
| `bpmn.callActivity` | node | `name`, `calledElement?: string`, `loop`, `forCompensation?`, `parent?` | parent / cascade |
| `bpmn.event` | node | `name`, `position: start\|intermediateCatch\|intermediateThrow\|end`, `definitions: EventDefinition[]`, `interrupting?: boolean` (start events in event sub-processes, default true), `parallelMultiple?: boolean`, `parent?` | parent / cascade |
| `bpmn.boundaryEvent` | node | `name`, `attachedTo: ElementId` (task/subProcess/callActivity), `cancelActivity: boolean`, `definitions: EventDefinition[]` | attachedTo / cascade |
| `bpmn.gateway` | node | `name`, `gatewayType: exclusive\|parallel\|inclusive\|eventBased\|complex`, `markerVisible?: boolean` (exclusive X, default true), `parent?` | parent / cascade |
| `bpmn.dataObject` | node | `name`, `role: reference\|input\|output`, `collection: boolean`, `parent?` | parent / cascade |
| `bpmn.dataStore` | node | `name`, `parent?` | parent / cascade |
| `bpmn.textAnnotation` | annotation | `text`, `parent?` | parent / cascade |
| `bpmn.group` | annotation | `name` (category value label) | none / cascade |
| `bpmn.sequenceFlow` | edge | `from`, `to`, `name?`, `condition?: string` (expression body), `isDefault?: boolean`, plus `ConnectorRoutingSemantic` | from,to / cascade |
| `bpmn.messageFlow` | edge | `from`, `to`, `name?`, `messageRef?: string`, plus routing | from,to / cascade |
| `bpmn.association` | edge | `from`, `to`, `direction: none\|one\|both`, plus routing | from,to / cascade |
| `bpmn.dataAssociation` | edge | `from`, `to` (data to activity/event = input, activity/event to data = output), plus routing | from,to / cascade |

`EventDefinition` is
`{ id: string, kind: message|timer|error|escalation|cancel|compensation|conditional|link|signal|terminate, ref?: string, linkName?: string, timer?: {type: date|duration|cycle, value: string}, condition?: string }`.

Rules for `definitions`:
- An empty array is a "none" event.
- Two or more entries render as Multiple. With `parallelMultiple` they render
  as Parallel Multiple.
- `id` keeps BPMN XML ids stable. It also lets the collab diff reconcile
  array items by id (`packages/collab/src/diff.ts:12-17`).

Decisions behind the table:
- Default flow is stored on the flow (`isDefault`), not on the source as
  BPMN XML does. The fact lives in one record and creates no extra
  reference. Export writes the source's `default` attribute.
- Catch and throw are a field (`position`), not separate types. The same
  goes for user and service tasks (`taskType`). Inspector type switching is
  then a semantic update on the same element id, so connections survive by
  construction.
- `cascade` is used everywhere:
  - Deleting a pool deletes its lanes and contents.
  - Deleting an activity deletes its boundary events.
  - Deleting a node deletes its flows.
  - Deleting a lane deletes its members. This is an intentional divergence
    from bpmn-js; see section 11 and the user-QA file.
- Validation in `validateSemantic` is structural only: types, enums,
  required `parent`/`attachedTo`/`from`/`to`, and unique definition ids.
  BPMN well-formedness (which definitions fit which position, flow
  legality) is enforced by the Editor intent methods (section 4.3) and reported by the
  importer or the linter. It is not made a document error. Imported
  imperfect models must still load.
- `validate.ts` gains document-level warnings, following the existing
  pattern of `reference.dangling`:
  - `bpmn.parentType`: `parent` does not reference a lane, participant or
    sub-process.
  - `bpmn.attachedToType`: `attachedTo` does not reference an activity.

### 3.3 Visual: label bounds

Add `Visual.labelBounds?: {x, y, width, height}` (page units, optional).
- It holds BPMNDI label bounds for nodes and flows.
- When it is absent, renderers use the default placement in section 6.1.
- Add the key to the known visual keys in `validate.ts`, the JSONL key order
  and the collab visual mapping. Collab is generic, so only the known-key
  lists need changing.

### 3.4 Interchange metadata

XML-only identifiers and preserved foreign content live in `extensions`
under the key `bpmnXml`. They are opaque to IR, core and lint, and only the
`packages/io` BPMN adapter reads them.

On the page (`page.extensions.bpmnXml`):
- `definitionsId`, `targetNamespace`, `collaborationId`, `processId` (used
  when there are no pools), `laneSetIds`
- `namespaces` (foreign prefix to URI)
- `rootElements` (raw XML of `message`/`signal`/`error`/`escalation`/
  `dataStore` definitions and other root-level content)
- `unsupported` (raw XML of unsupported semantic elements together with
  their DI)

On an element (`element.extensions.bpmnXml`):
- `attributes` (foreign-namespace attributes)
- `children` (raw XML of `extensionElements`, `documentation` and other
  unmodelled children)
- `dataObjectId` (for `dataObjectReference`)

### 3.5 Schema version and migration

The change is additive: a new page-kind value, new element types and one
new optional visual key. `SCHEMA_VERSION` stays 1 and no migration is
registered. This is the identity migration path, following the `sqlDialect`
precedent.

Required evidence:
- The existing golden fixtures and their byte-for-byte checks are
  unchanged. Two existing tests pin the registered type list and must be
  extended in the IR slice, which owns them (section 11.1):
  - `packages/ir/src/registry.test.ts` "registers the design table plus
    assets and token resources": the expected list gains the 16 `bpmn.*`
    types. The other entries stay as they are.
  - `packages/io/src/jsonl/golden.test.ts` "covers every registered element
    type at least once": `"bpmn"` is appended to `GOLDEN`. A new canonical
    golden file `packages/io/src/__fixtures__/bpmn.jsonl` holds one `bpmn`
    page with at least one element of each of the 16 `bpmn.*` types. It
    must parse with no error-level issues and reserialize byte for byte, so
    it is written in `keyOrder.ts` key order with canonical rounding. It is
    a small coverage document, independent of the purchase-request fixtures.
- `packages/collab/src/ydoc.test.ts` passes unchanged. It loops over
  `allFixtures()` without a pinned count, so the collab slice adding a BPMN
  fixture there extends coverage without editing the test.
- A new test loads every pre-existing fixture and asserts that its
  validation result is unchanged.

Consequence: builds older than this change reject a document that contains a
`bpmn` page (`value.enum`). That is accepted, because older builds cannot
render BPMN anyway. It is recorded in user-QA Q3.

## 4. Editing rules (packages/core)

New module `packages/core/src/bpmn/`.

### 4.1 Scope derivation (`bpmn/model.ts`)

`participantOf(id)` and `scopeOf(id)` walk `parent` up the tree:
- The participant is the first `bpmn.participant` ancestor.
- The flow scope is the nearest `bpmn.subProcess` ancestor, else the
  participant, else the page.
- A boundary event uses its host's scope.

### 4.2 Connection resolution (`bpmn/connection.ts`)

`resolveBpmnConnection(document, fromId, toId, requested?)` returns either
`{type}` or `{rejected: code, message}`.

Resolution:
1. If either end is a text annotation, the result is `bpmn.association`.
   Groups take no connections.
2. If exactly one end is a data object or data store and the other is an
   activity or event, the result is `bpmn.dataAssociation`.
3. Otherwise, if the ends are in different participants, the result is
   `bpmn.messageFlow`. If they are in the same participant, or neither has
   one, the result is `bpmn.sequenceFlow`.
   - A `requested` sequence flow across pools is corrected to a message flow
     when the message flow is legal; otherwise it is rejected.
   - A `requested` message flow inside one pool is corrected to a sequence
     flow under the same condition.

Sequence flow legality:
- Both ends are flow nodes (activity, event, gateway).
- Both ends are in the same flow scope.
- The target is not a start event or a boundary event.
- The source is not an end event.
- No self-loop.

Message flow legality:
- The ends are in different participants. A collapsed participant counts as
  an endpoint itself.
- The source is an activity, a participant, an intermediate throw event or
  an end event.
- The target is an activity, a participant, a start event, an intermediate
  catch event or a boundary event.
- Gateways and data elements never take message flows.

Rejection codes:
- `bpmn.connection.crossPoolSequenceFlow`
- `bpmn.connection.samePoolMessageFlow`
- `bpmn.connection.startEventIncoming`
- `bpmn.connection.endEventOutgoing`
- `bpmn.connection.boundaryIncoming`
- `bpmn.connection.crossScope`
- `bpmn.connection.invalidEndpoint`

### 4.3 Wiring

Legality is enforced only at the Editor intent layer. `applyCommands`,
`Editor.apply` and the command validation in `commands.ts` stay unchanged and
run no BPMN legality check.

The intent entry points below are the "programmatic attempts" that the
acceptance tests exercise. Each returns
`{ok: true, id, type} | {ok: false, code, message}` and applies nothing on
rejection.

- `Editor.connectBpmn(from, to, requested?)`
  - Runs `resolveBpmnConnection`.
  - On success, creates the resolved (possibly corrected) flow type with
    `routing: "orthogonal"`.
- `Editor.connectSmart`
  - Delegates to `connectBpmn` when both ends are `bpmn.*`.
  - Returns `null` on rejection, as its other failures already do.
  - The UI connect gesture (`packages/ui-solid/src/interaction.ts:1755`)
    goes through it.
- `Editor.reconnectBpmnFlow(id, end: "from"|"to", target)`
  - Re-runs `resolveBpmnConnection` with the new end.
  - Writes `from`/`to`, or replaces the flow with the corrected type under
    the same id. The replacement is a delete and create in one batch, so it
    is one undo step. The delete cascades to elements that reference the
    flow (for example an association from a text annotation). The same
    batch re-creates those dependants unchanged after the new flow.
  - The ui-solid `reconnect` helper (`interaction.ts:1698-1719`) calls it
    for `bpmn.*` flow types instead of its raw `updateSemantic`. Other
    types keep the existing path.
- `Editor.updateBpmnSemantic(id, semantic)`
  - The inspector's `BpmnSection` writes through this.
  - For a `bpmn.event` `position` change, it rejects:
    - a switch to `start` while the event has incoming sequence flows, with
      `bpmn.connection.startEventIncoming`
    - a switch to `end` while it has outgoing sequence flows, with
      `bpmn.connection.endEventOutgoing`
  - Every other field is applied as a plain `updateSemantic`.
  - Flow type (sequence or message) is not an inspector choice. It follows
    the endpoints through `resolveBpmnConnection`.

These paths never run the legality check:
- undo/redo (`History` replays through `applyCommands` directly,
  `editor.ts:300-302`)
- clipboard paste and duplicate (`clipboard.ts` emits `createElement` of
  complete elements)
- raw `Editor.apply` and `applyCommands`
- imports
- remote collab updates (`store.commit` in `binding.ts`)

Illegal flows that arrive through these paths (from imports or peers) stay
loadable, editable, deletable and restorable by undo. Lint reports them
instead (section 7).

### 4.4 Containment and movement (`bpmn/containment.ts`)

- Membership: after a create or move commit on a `bpmn` page, the planner
  sets each moved BPMN node's `parent`. The new parent is the deepest
  container (expanded sub-process, then lane, then participant) whose bounds
  contain the node's centre, excluding the node itself and its descendants.
  A boundary event is snapped to its host instead.
- Translation: a `planBpmnTranslations(before, after)` step runs in
  `Editor.apply` next to `planFrameTranslations` (`editor.ts:993/1012/1062`).
  When a participant, lane or sub-process moves, descendants and attached
  boundary events whose x/y the batch did not already change shift by the
  same delta. Flows follow because waypoints are endpoint-relative.
  `frame-*` code is not generalised.
- Sizing:
  - A new pool is 600 x 250 with a 30-unit header band.
  - "Add lane" on a pool or lane appends a lane 120 units tall. The lane
    spans the parent's body width (its width minus the 30-unit header) and
    grows the pool by 120. The first lane added to a pool without lanes
    covers the existing body, and the pool's direct members are re-parented
    to it.
  - Pool and lane resize keep sibling lanes stacked edge to edge.
  - A new collapsed pool is 600 x 60.
- Default shape sizes:
  - task, call activity and collapsed sub-process: 100 x 80
  - expanded sub-process: 350 x 200
  - event: 36 x 36
  - gateway: 50 x 50
  - data object: 36 x 50
  - data store: 50 x 50
  - text annotation: 100 x 30
- Core shape utils (`packages/core/src/shapes/bpmn.ts`, registered in
  `createDefaultRegistry`) give bounds, hit tests and outlines: circles for
  events, a diamond for gateways and rounded rects for activities. Connector
  docking via `elementBoundary` then lands on the true outline.

## 5. BPMN 2.0 XML interchange (packages/io/src/bpmn)

### 5.1 XML parser and serializer (`bpmn/xml.ts`)

The parser is dependency-free and non-validating. No dependency is added,
because a dependency-free parser satisfies the constraint and the BPMN input
surface is small.

It supports:
- XML declaration
- elements and attributes with namespace prefix resolution (`xmlns`,
  `xmlns:p`, default namespace)
- text, CDATA and comments (comments are dropped)
- processing instructions other than the declaration (dropped)
- the five predefined entities and decimal/hex character references

For safety and robustness:
- Any `<!DOCTYPE` throws `BpmnParseError`. There is no entity expansion and
  no XXE.
- Unknown entities, mismatched tags and duplicate attributes are errors.
- The input-size limit is the caller's file read. There is no recursion
  limit beyond nesting depth 512 (error).

The serializer is deterministic:
- 2-space indent, LF line endings, trailing newline
- attributes in a fixed order per element kind, then foreign attributes
  sorted by qualified name
- attribute escaping of `& < > "` and `\n` as `&#10;`
- text escaping of `& <` and `>`

### 5.2 Import (`importBpmnXml(text): BpmnImportReport`)

The report is
`{document, pageId, warnings: {xmlId?, element, message}[], missingDi: ElementId[]}`.
`BpmnParseError` is thrown for unparseable XML, a missing `definitions` root
or the wrong BPMN namespace. The result passes `assertValidDocument`.

The output is one document with one `bpmn` page. The page name is the first
participant name, else the process name, else `"BPMN"`.

Element ids are the XML ids verbatim. They are unique within one XML file.
Keeping them makes lint output identical to bpmnlint's element ids.

Mapping:
- **Collaboration and processes**
  - `participant` maps to `bpmn.participant`. It is collapsed when it has no
    `processRef` or its DI shape has `isExpanded="false"`.
  - A process referenced by a participant contributes its contents with
    `parent` set to that participant.
  - When there is no collaboration, the single process contributes nodes
    with no `parent`.
  - Additional unreferenced processes are imported parent-less with a
    warning.
- **Lanes**: `laneSet/lane` maps to `bpmn.lane`. The parent is the
  participant or, through `childLaneSet`, the enclosing lane. A node listed
  in `flowNodeRef` gets `parent` set to the innermost lane that lists it.
- **Flow nodes**
  - `task`, `userTask`, `serviceTask`, `manualTask`, `sendTask`,
    `receiveTask`, `scriptTask` and `businessRuleTask` map to `bpmn.task`
    (`taskType`).
  - `standardLoopCharacteristics` and
    `multiInstanceLoopCharacteristics[isSequential]` map to `loop`.
  - `isForCompensation` maps to `forCompensation`.
  - `subProcess` (`triggeredByEvent`; DI `isExpanded`) and `adHocSubProcess`
    map to `bpmn.subProcess`. Their children get `parent` set to the
    sub-process.
  - `callActivity` maps to `bpmn.callActivity`.
  - `startEvent`, `intermediateCatchEvent`, `intermediateThrowEvent` and
    `endEvent` map to `bpmn.event`. `boundaryEvent` maps to
    `bpmn.boundaryEvent`.
  - `*EventDefinition` children map to `definitions`. `messageRef`,
    `signalRef`, `errorRef` and `escalationRef` map to `ref`. Link `name`
    maps to `linkName`. Timer `timeDate`/`timeDuration`/`timeCycle` map to
    `timer`. Conditional `condition` maps to `condition`.
  - `exclusiveGateway`, `parallelGateway`, `inclusiveGateway`,
    `eventBasedGateway` and `complexGateway` map to `bpmn.gateway`.
- **Flows**
  - `sequenceFlow` maps to `bpmn.sequenceFlow`. Its `conditionExpression`
    text maps to `condition`. The source's `default` maps to `isDefault`.
  - `messageFlow` maps to `bpmn.messageFlow`.
  - `association` maps to `bpmn.association`.
  - `dataInputAssociation` and `dataOutputAssociation` map to
    `bpmn.dataAssociation`, keeping their ids.
- **Data and artifacts**
  - `dataObjectReference` maps to `bpmn.dataObject` with role `reference`.
    `isCollection` comes from the referenced `dataObject`.
  - `ioSpecification` `dataInput`/`dataOutput` map to role `input`/`output`.
  - `dataStoreReference` maps to `bpmn.dataStore`.
  - `textAnnotation` maps to `bpmn.textAnnotation`.
  - `group` maps to `bpmn.group`, named through its `categoryValue`.
- **DI**
  - Only the BPMNPlane of the first `BPMNDiagram` positions the main page.
  - Shape `Bounds` map to `visual.x/y/width/height`. `BPMNLabel/Bounds` map
    to `visual.labelBounds`. `isMarkerVisible` maps to `markerVisible`.
  - Edge waypoints become `routing: "manual"`. The interior points (all
    except the first and last) are converted with
    `connectorWaypointFromPage` against the endpoint box centres. The first
    and last points are docking points, recomputed by geometry.
  - Children of a collapsed sub-process that have DI on a secondary
    `BPMNDiagram` plane are imported with that plane's coordinates and
    `visual.hidden = true`.
- **Missing DI**
  - A semantic element with no DI is auto-placed: shapes are put in a row
    below the diagram's bounding box; flows get default routing.
  - The importer adds the element to `missingDi` and records a warning.
- **Unsupported constructs**
  - `transaction`, choreography and conversation elements, and anything else
    not in the mapping are never dropped.
  - Their raw XML (and their DI) is stored in
    `page.extensions.bpmnXml.unsupported` with a warning naming the element
    and id.
- **Foreign content**
  - Foreign attributes and children are preserved per section 3.4.
  - Namespace declarations are collected into
    `page.extensions.bpmnXml.namespaces`.

To share the waypoint basis without a cycle, move
`connectorWaypointToPage`/`connectorWaypointFromPage` (pure math, part of
the stored format) into `@diagra/ir`. `@diagra/core` re-exports them under
the same names. Existing callers are unchanged.

### 5.3 Export (`exportBpmnXml(document, pageId, options?): BpmnExportReport`)

The report is `{xml, warnings}`. The options are
`{routeOf?: (edge: Element) => readonly {x, y}[] | undefined}`. Core provides
`bpmnRouteResolver(editor)` in `bpmn/routes.ts`, which returns the
`resolveConnector` polyline. The CLI and desktop always pass it, so exported
waypoints match what the user sees. The io fallback uses manual waypoints
plus simple outline docking.

Namespaces:
- The fixed `bpmn`, `bpmndi`, `dc`, `di` and `xsi` namespaces use the OMG
  URIs listed in the article's files (standard spec URIs).
- Preserved foreign namespaces follow, sorted by prefix.
- `targetNamespace` comes from the extension, defaulting to
  `http://bpmn.io/schema/bpmn` for bpmn.io compatibility.

Ids:
- An element id that is a valid NCName is used as is.
- Otherwise it gets a deterministic prefix. For example a ULID becomes
  `Activity_<id>`, `Event_<id>`, `Gateway_<id>`, `Flow_<id>`,
  `Participant_<id>`, `Lane_<id>`, `DataObjectReference_<id>`, and so on.
- The mapping is idempotent: an exported id re-exports to itself.
- Missing XML-only ids are derived as `Definitions_<pageId>`,
  `Collaboration_<pageId>`, `Process_<participantId>`,
  `LaneSet_<parentId>` and `<id>_di` (with the same NCName rule).

Order:
1. `collaboration` (participants, then message flows), only when the page
   has participants.
2. One `process` per expanded participant, in element index order. Within a
   process:
   1. `laneSet`
   2. flow nodes in element index order, each with `incoming`/`outgoing`
      children (the bpmn.io convention)
   3. data objects
   4. sequence flows
   5. artifacts
3. Preserved `rootElements` and `unsupported` XML, verbatim.
4. `BPMNDiagram/BPMNPlane` (referencing the collaboration or process):
   shapes for pools, lanes and nodes in index order, then edges. Each label
   has bounds when `labelBounds` is set. A secondary diagram is emitted for
   each collapsed sub-process that has hidden children.

Pool-less nodes on a page that also has participants are exported in an
extra process not referenced by any participant, with a warning. Import maps
that process back to parent-less nodes, so the round trip is stable.

The output is byte-deterministic for a given page. `bpmn export --check`
depends on this.

### 5.4 Semantic equivalence (`bpmn/equivalence.ts`)

`bpmnSemanticProjection(document, pageId)` produces a canonical JSON value
used by tests and by the desktop import sanity check.

Included:
- element ids, mapped through the export id function
- types and semantic fields, excluding routing
- parents, event definitions (excluding XML-only `id`s)
- flows with endpoints and conditions
- names and labels

Excluded: coordinates and `extensions`.

Position fidelity is asserted separately:
- shape bounds and label bounds are equal
- interior waypoints are within 0.5 page units (the u/v rounding is 1e-6 and
  0.01)

The lossless contract:
- `projection(import(x)) == projection(import(export(import(x))))`
- `export(import(export(p))) == export(p)` byte for byte

## 6. Notation and rendering

### 6.1 Shared notation module (`packages/core/src/bpmn/notation.ts`)

`bpmnNotation(element, document)` returns `NotationPrimitive[]`:
`rect`/`circle`/`path`/`polygon`/`text`, each with `stroke`, `fill`,
`strokeWidth`, `dash` and a `role` string.
- The SVG export maps each primitive to one SVG node with
  `class="bpmn-<role>"`.
- The ui-solid views map the same primitives to JSX.
- The UI and the export therefore cannot diverge, and structural tests can
  assert roles.
- BPMN elements honour `visual.style` stroke, fill and color overrides.
  Otherwise they draw black strokes on a white fill.

Rules:
- **Participant**
  - A rect with a 30-unit header band and the name rotated -90 degrees,
    centred in the band.
  - A collapsed pool has no band and a centred name.
- **Lane**: a rect with a header band and the rotated name.
- **Task**
  - A rounded rect (r = 10, stroke 2) with the wrapped name centred.
  - The `taskType` icon sits top-left: user (person), service (gear), manual
    (hand), send (filled envelope), receive (hollow envelope), script
    (scroll), businessRule (table).
    - Every primitive of the icon lies inside the local square x 6..22,
      y 6..22 (16 units, 6-unit inset). Exactly one primitive per icon, its
      main outline, has role `task-icon-<taskType>`. Any further detail
      primitive has role `task-icon-<taskType>-detail`. The existing
      role-count tests (`fixtures.test.ts` "bpmn-task-icon-user": 3,
      `svg-export-bpmn.test.ts` one `bpmn-task-icon-user`) therefore stay
      unchanged. `none` draws no icon. Only `bpmn.task` carries `taskType`.
    - Shapes: user is a head circle plus a shoulders arc path; service is a
      toothed gear outline with a hollow hub circle; manual is an open hand
      outline (palm with four fingers and a thumb); send is an envelope body
      filled with the stroke colour, its flap drawn in the task fill colour;
      receive is the same envelope with `fill: "none"` and a stroke flap;
      script is a scroll (wavy left and right edges) with three text lines;
      businessRule is a rect with a header row filled with the stroke colour
      and one row and one column divider.
    - The art is original. Nothing is copied from bpmn-js or bpmn-font.
    - Icon paths use only absolute `M`, `L`, `C`, `Q` and `Z` commands with
      x y pairs, so tests can compute their bounds. Circles and rects are
      `circle`/`rect` primitives.
    - The activity label layout is unchanged. On the default 100 x 80 task
      the label band starts at y 25, below the icon.
  - Bottom-centre markers: loop (circular arrow), parallel multi-instance
    (three vertical bars), sequential multi-instance (three horizontal bars),
    compensation (double rewind triangles).
- **Sub-process**
  - Same body as a task.
  - Collapsed: a "+" box marker at the bottom centre.
  - Event sub-process: dotted border.
  - Ad hoc: a tilde marker.
  - Expanded: the name sits top-left.
- **Call activity**: thick border (stroke 5).
- **Events**
  - The shape is a circle (r = 18).
  - Borders by position:
    - start: thin, stroke 2
    - intermediate and boundary: double circle (outer r = 18 and inner
      r = 15, stroke 1.5)
    - end: thick, stroke 4
  - Non-interrupting boundary events (`cancelActivity: false`) and
    non-interrupting event sub-process starts are dashed.
  - Icons by definition kind: message (envelope), timer (clock), error
    (lightning), escalation (arrowhead), cancel (X), compensation (double
    triangle), conditional (lined sheet), link (arrow), signal (triangle),
    terminate (solid inner disc), multiple (pentagon), parallelMultiple
    (plus).
  - Icons are hollow on start, intermediate catch and boundary events, and
    filled on intermediate throw and end events.
- **Gateways**
  - The shape is a diamond (50 x 50).
  - Markers by type:
    - exclusive: X, only when `markerVisible`
    - parallel: +
    - inclusive: thick circle
    - eventBased: double circle with pentagon
    - complex: asterisk
- **Flows**
  - Sequence flow: solid line with a filled arrowhead.
    - A default flow has a slash near the source.
    - A conditional flow from a non-gateway source has a hollow diamond at
      the source.
  - Message flow: dashed line, an open circle at the source and a hollow
    arrowhead at the target.
  - Association: dotted line. An open arrowhead is added per `direction`.
  - Data association: dotted line with an open arrowhead.
- **Data and artifacts**
  - Data object: a page with a folded corner. Collection adds three bars.
    Input and output add a hollow or filled arrow top-left.
  - Data store: a cylinder.
  - Text annotation: an open left bracket with the text beside it.
  - Group: a dash-dot rounded rect with the name at the top. The body has
    `fill: "none"` unless `visual.style.fill` is set, so a group never hides
    lanes or nodes it overlaps.
- **Labels**
  - Use `visual.labelBounds` when set. `labelBounds` is absolute. The local
    label position is `labelBounds` minus the origin of the `box` passed to
    `bpmnNotation`, which is always the element's resolved absolute bounds.
    `visual.x`/`visual.y` are not read, so a shape without stored x/y
    renders its label at the same place on the canvas and in export.
  - Otherwise, events, gateways, data objects and data stores put the label
    centred below the shape (top = shape bottom + 7, width 90, wrapped).
  - Flows put the label at the connector `labelPoint`.
  - Labels are editable through the existing inline text edit, which writes
    `name`.
  - Page and selection export bounds include label boxes.

### 6.2 Renderer wiring

- `svg-export.ts` `renderShape` gains a `bpmn.*` branch calling
  `bpmnNotation`. `renderConnector` gets BPMN flow decorations from a
  `bpmnFlowDecoration(element)` helper in the notation module.
  - `renderBpmnShape` passes the resolved absolute `box` to `bpmnNotation`
    (not a box zeroed at 0,0) and keeps the `translate(box.x box.y)` group.
    Primitive geometry is local and uses only `box.width`/`box.height`; the
    origin is used only for the label offset (section 6.1 Labels). The
    canvas `BpmnShapeView` already passes the resolved box.
- `packages/ui-solid/src/shapes/ShapeView.tsx` gains a `BpmnShapeView`
  match. `ConnectorView.tsx` uses the same flow decoration helper.

### 6.3 Palette and inspector (packages/ui-solid)

- **Palette**
  - When the active page kind is `bpmn`, `Toolbar` shows a "BPMN" tool
    menu.
  - `tools.ts` gets a `BPMN_TOOLS` list with `creationFor` entries, holding
    the Descriptive set: pool, lane, task, user task, service task, start
    event, intermediate catch message, intermediate throw message, timer
    catch, end event, exclusive gateway, parallel gateway, sub-process
    (collapsed and expanded), call activity, data object, data store, text
    annotation and group.
  - The connect tool uses `connectBpmn`. A rejected gesture creates
    nothing, and its message is shown in the status line of the BPMN
    problems panel (section 7.4). No new notification system is added.
  - The other tool menus stay available.
- **Inspector**
  - A `BpmnSection` in `Inspector.tsx` edits the semantic fields: name, and
    the type pickers `taskType`, event `position`, `definitions` kind (one
    or several), `cancelActivity`/`interrupting`, `gatewayType`, `loop`,
    sub-process flags, data object role/collection, flow `condition`/
    `isDefault` and association direction.
  - Changes go through `Editor.updateBpmnSemantic` (section 4.3) on the
    same element, so connections are kept.
  - Options that would violate section 4 are disabled, and
    `updateBpmnSemantic` still rejects them when called programmatically.
  - The Analytic constructs are reachable here.

### 6.4 Paint layers and routing obstacles (`packages/core/src/backdrops.ts`)

Shapes paint above the connector layer, so lines never cover a node. Before
this revision, `isConnectorBackdrop` lowered only ungrouped `frame`
elements beneath the connectors. Opaque pool and lane bodies therefore
painted over every sequence and message flow on the canvas and in export.

Rule: `isConnectorBackdrop(element, isGrouped)` is true when the element is
not grouped (`!isGrouped(element.id)`, as for frames today) and is one of:
- `frame` (unchanged)
- `bpmn.participant`, collapsed or not. A black-box pool then never hides a
  message flow that docks on it. This keeps the predicate a type test.
- `bpmn.lane`
- `bpmn.subProcess` with `semantic.expanded === true`. A collapsed
  sub-process is a node and stays a shape.
- `bpmn.group`

The predicate is the single source for three consumers, so editor, export
and routing cannot diverge:
- SVG export (`svg-export.ts`, `connectorBackdropIds`): these elements go
  into `<g data-layer="backdrops">` before `<g data-layer="connectors">`.
- The ui-solid canvas (`Canvas.tsx`, `connectorBackdropIds`): these elements
  go into `diagra-backdrop-layer` before the connector svg.
- Connector routing (`shapes/connector.ts` `obstacleBoxes`): these elements
  are not obstacles. Flows route inside pools and lanes and across expanded
  sub-processes. The nodes inside them stay obstacles.

Paint order inside the backdrop layer is page z-order, as for frames. Both
consumers filter the z-ordered element list. The importer emits pools,
then lanes, then process contents in document order (`import.ts` add
order), so a pool is below its lanes and lanes are below an expanded
sub-process, and lane headers still draw over the pool body. In the editor
the existing z-order is kept as authored. No new layer, z-index or
reordering is added.

Unchanged:
- Tasks, events, gateways, call activities, collapsed sub-processes, data
  objects, data stores, text annotations and boundary events stay in the
  shapes layer above the connectors.
- A backdrop exists only on a page with at least one connector
  (`connectorBackdropIds`).
- An element inside a diagra `group` keeps its group's paint order and
  stays a routing obstacle. The BPMN importer never creates diagra groups.
  `bpmn.group` is a BPMN artifact, not a diagra group.
- Frame and ERD backdrop behaviour and their tests.

## 7. Lint (packages/core/src/bpmn/lint)

### 7.1 Engine

`lintBpmnPage(document, pageId, config, context?)` returns
`BpmnLintFinding[]`, where a finding is
`{ruleId, severity: "error"|"warning", elementId, message}`.

The engine works on the `bpmn/model.ts` view:
- scopes: one process per expanded participant, else the page's implicit
  process; also sub-processes and event sub-processes
- each node's incoming and outgoing sequence flows, and its parent scope
- `context.missingDi`, used only by `no-bpmndi`

Findings are sorted by element document order (page element index order),
then rule id. Severity `warn` in the config prints as `warning`.

Messages are diagra's own wording. Rule ids equal bpmnlint's.

### 7.2 Config (`bpmn/lint/config.ts`)

`parseLintConfig(text)` accepts `.bpmnlintrc` JSON:
- `extends` is `"bpmnlint:recommended"`, `"recommended"` or `"bpmnlint:all"`,
  or an array of these.
- `rules` maps a rule id to `"off"|"warn"|"error"|0|1|2`, or to
  `[severity, options]`. Options are ignored, because no rule needs them.

These are config errors: an unknown rule id, an unknown `extends` (including
`plugin:*`) and invalid JSON.

The default is recommended.

### 7.3 Rules

Recommended severities:
- warn: `fake-join`, `no-overlapping-elements`, `superfluous-gateway`,
  `superfluous-termination`
- error: all the others

"Flow node" means an activity, event or gateway.

Exempt nodes for the start, end and disconnected rules:
- boundary events
- compensation activities (`forCompensation`)
- event sub-processes
- nodes whose scope is an ad-hoc sub-process

| rule id | reports on | semantics |
|---|---|---|
| `label-required` | element | Flow nodes, participants and lanes with an empty or whitespace `name`, and conditional sequence flows with an empty name. Exempt: parallel and event-based gateways, gateways with at most one outgoing flow (joins), boundary events, and unconditioned sequence flows. |
| `no-implicit-start` | node | A flow node other than a start event with no incoming sequence flow. Exempt nodes as above, plus link catch events. |
| `no-implicit-end` | node | A flow node other than an end event with no outgoing sequence flow. Exempt nodes as above, plus link throw events. |
| `start-event-required` | scope | A process or non-ad-hoc sub-process with no start event. The implicit process reports the page id and is checked only when it has flow nodes. Collapsed pools have no process. |
| `end-event-required` | scope | The same check for end events. |
| `no-disconnected` | node | A flow node with neither incoming nor outgoing sequence flows. Exempt nodes as above. |
| `conditional-flows` | flow | The source is "conditional forking" when it is not a parallel or event-based gateway and it has a default flow or at least one outgoing flow with a condition. Each of its outgoing flows that has no condition and is not default is reported. |
| `no-duplicate-sequence-flows` | flow | Flows with the same source, target and condition. Every flow after the first, in element order, is reported. |
| `no-gateway-join-fork` | gateway | A gateway with more than one incoming and more than one outgoing sequence flow. |
| `no-implicit-split` | node | A non-gateway flow node with more than one outgoing flow that is neither conditional nor default. |
| `single-blank-start-event` | scope | More than one start event with no definitions in one scope. |
| `single-event-definition` | event | An event with more than one definition. |
| `superfluous-gateway` | gateway | Exactly one incoming and one outgoing sequence flow. |
| `fake-join` | node | A non-gateway flow node with more than one incoming sequence flow. |
| `no-complex-gateway` | gateway | `gatewayType` is complex. |
| `no-inclusive-gateway` | gateway | `gatewayType` is inclusive. |
| `no-overlapping-elements` | node | Two visible flow nodes in the same scope whose bounds intersect with positive area. Exempt pairs: a boundary event and its host, and an expanded sub-process and its descendants. The later element of each pair, in element order, is reported. |
| `superfluous-termination` | event | A terminate end event in a scope with no concurrency source. A concurrency source is a parallel, inclusive or complex gateway with more than one outgoing flow, a node with an implicit split, or more than one start event. |
| `sub-process-blank-start-event` | event | A start event with definitions inside a sub-process that is not an event sub-process. |
| `event-sub-process-typed-start-event` | event | A start event with no definitions inside an event sub-process. |
| `link-event` | event | A link event whose link name (`linkName`, else `name`) is empty; a link throw with no matching link catch in its scope; or a duplicate link catch name in one scope. |
| `ad-hoc-sub-process` | event | Any start or end event whose scope is an ad-hoc sub-process. |
| `no-bpmndi` | element | An element in `context.missingDi`. Only `.bpmn` input supplies it. JSONL pages always have geometry, so the rule cannot fire on them. |

The required fixture outcome under recommended:
- The draft-equivalent fixture yields exactly three findings:
  - `label-required` on the unnamed procurement task
  - `no-implicit-end` on the same task
  - `no-implicit-start` on the "order sent" throw event
- The complete, swapped and inverted fixtures yield no findings.

The local reference test asserts the same rule-id multiset on the four
`.reference` files.

### 7.4 Desktop problems panel

`packages/ui-solid/src/BpmnProblemsPanel.tsx` is mounted by the desktop
`App.tsx` when the active page kind is `bpmn`.

- It re-lints the active page with the recommended config on document
  change, debounced at 300 ms.
- Each row shows the severity, element name (or id), message and rule id.
- Clicking a row selects the element and frames it in the camera.
- Findings on a page id select nothing.
- The desktop has no config file. See user-QA Q2.

## 8. CLI (apps/cli)

`runCli` gains `lint` and `bpmn`.

`bpmn` dispatches on its first argument (`import|export`). A missing or
unknown subcommand prints usage and exits 2.

The usage text, `parseArgs`, `selectPage`, `writeOutput` and
`normalizeNewlines` are reused. The page-kind filter is parameterised to
`bpmn`.

**`lint <input> [--page <id|name>] [--config <file>] [--format text|json]`**
- Input:
  - `*.bpmn` is imported first, with `missingDi` passed on. Import warnings
    go to stderr.
  - Anything else is parsed as JSONL.
- Pages: without `--page` it lints every `bpmn` page in page order. A
  document with no `bpmn` page is a usage error.
- Config: `--config` is read and parsed. Without it, `.bpmnlintrc` in the
  current working directory is used if it exists, else recommended (the
  bpmnlint discovery convention).
- Text output:
  - The input path line.
  - For multi-page JSONL, a `page <name> (<id>)` line per page with
    findings.
  - Rows: `  <elementId>  <severity>  <message>  <ruleId>`, with columns
    padded to the widest value.
  - A blank line, then `N problems (E errors, W warnings)`.
  - Nothing at all when clean. No symbols or emojis.
- JSON output: one object,
  `{input, pages: [{pageId, pageName, findings: [...]}], summary: {problems, errors, warnings}}`,
  2-space indented with a trailing newline. It is always printed, even when
  clean.
- Exit codes:
  - 0: no error-level findings (warnings may be printed)
  - 1: at least one error-level finding
  - 2: usage, parse or config errors

**`bpmn import <file.bpmn> [--output <doc.jsonl>] [--strict]`**
- Canonical JSONL goes to stdout, or to `--output` through `writeOutput`.
- Warnings go to stderr.
- `--strict` with warnings exits 3.
- A parse error exits 2.

**`bpmn export <document.jsonl> [--page <id|name>] [--output <file.bpmn> | --check <file.bpmn>] [--strict]`**
- The single `bpmn` page is chosen automatically, otherwise `--page` is
  required.
- `--output` and `--check` are mutually exclusive (exit 2).
- `--check` compares `normalizeNewlines(file)` with the export. A
  difference exits 1, exactly as `ddl --check` does.
- `--strict` with export warnings exits 3.

README CLI tables and the usage text list both commands and their exit
codes.

## 9. Desktop (apps/desktop)

- **Page creation**: `PageTabs.tsx` gets "Add BPMN page" next to "Add page".
  It calls `editor.createPage({kind: "bpmn"})`. The inspector's existing
  kind `<select>` also offers `bpmn`, because it is built from `PAGE_KINDS`.
- **File menu** (`App.tsx`):
  - "Import BPMN..." opens a picked `.bpmn` as a detached imported document,
    using the Mermaid path (`session.ts` `isBpmnPath`, dynamic import of
    `@diagra/io` BPMN import). Autosave therefore never overwrites the
    `.bpmn`.
  - "Export BPMN..." is enabled when the active page is `bpmn`. It writes
    `exportBpmnXml` with the core route resolver through
    `ExportBackend.pickExportPath` and `writeText`, as `exportSvg` does.
  - `session.ts` surfaces no Mermaid import warnings today. BPMN import
    warnings are kept on the session and listed under an "Import warnings"
    heading in the BPMN problems panel. They are informational, and the
    content itself is preserved per section 5.2.
- **Opening `.bpmn`**: `session.ts` routes `.bpmn` to the BPMN importer, for
  both the open dialog and launch/`RunEvent::Opened` paths.
- **Rust (minimal)**:
  - `src-tauri/src/dialogs.rs` adds `"bpmn"` to `OPEN_FILTER_EXTENSIONS`.
  - `pick_export_path` already accepts any plain extension
    (`normalize_extension`), so the export side needs no Rust change.
  - `tauri.macos.release.conf.json` gains a `bpmn` file association
    (Viewer, rank Alternate), mirroring `mmd`.
  - Run `CARGO_TERM_QUIET=true cargo check` and `cargo fmt` on
    `apps/desktop/src-tauri`.
  - No native menu is introduced.

## 10. Documentation and example

- `README.md` gets a "BPMN operation flows" section: page kind, palette,
  rules, lint, the `bpmn import|export` commands and exit codes.
- `docs/bpmn/format.md` documents the JSONL element types (section 3.2,
  with a sample record per type), `parent` membership and the `bpmnXml`
  extension.
- `docs/bpmn/lint-rules.md` lists each rule id, its recommended severity and
  diagra's original description. It also shows a `.bpmnlintrc` example.
- `docs/bpmn/ai-review-rules.md` is an original example guideline that can
  be dropped into `.claude/rules/`. It covers:
  - the conformance target (Descriptive palette, Analytic constructs
    allowed)
  - task granularity (one actor, one verb-object action)
  - labelling: verb-object tasks, question gateways, YES/NO outgoing
    labels, message throw labels in "send" form and catch labels in
    "receive" form, matching throw/catch pairs
  - lane per role
  - a review checklist pairing semantic checks with `diagra-cli lint`
- `docs/bpmn/purchase-request.jsonl` is the original example document,
  identical to the complete fixture.
- `packages/io/README.md` gets a BPMN adapter note.

## 11. Fixtures and tests

Fixtures in `packages/io/src/__fixtures__/bpmn/` are original. They use
English labels, ids of their own and a geometry of their own:
- `purchase-request.bpmn`, `purchase-request-draft.bpmn`,
  `purchase-request-swapped.bpmn` and `purchase-request-inverted.bpmn`
- `purchase-request.jsonl`

The type-coverage golden file `packages/io/src/__fixtures__/bpmn.jsonl`
(section 3.5) sits next to the other golden files, not in `bpmn/`.

They model one pool, "Office supply purchase", with the lanes Requester,
Approver and Procurement. The flow:
- start "Need identified"
- user task "Submit purchase request"
- throw "Send request notice" and catch "Receive request notice"
- user task "Review request"
- exclusive gateway "Approve?"
  - NO: throw and catch rejection notice, then end "Request rejected"
  - YES: user task "Place order", throw and catch order notice, then end
    "Purchase complete"

The variants:
- draft: the order task is unnamed and the task-to-order-notice flow is
  removed
- swapped: the request notice throw and catch are swapped
- inverted: the YES/NO targets are swapped

Tests (one line each, colocated `*.test.ts`):
- ir:
  - per-type `validateSemantic`
  - `bpmn.parentType` and `bpmn.attachedToType` warnings
  - `labelBounds` known key
  - unchanged validation of all pre-existing fixtures
  - the extended registry type list and the `bpmn` golden file
    (section 3.5)
- fixtures contract (`packages/io/src/__fixtures__/bpmn/fixtures.test.ts`):
  - It uses only `node:fs` and string scanning. It must not use the io BPMN
    parser, which does not exist yet when the fixtures are written.
  - Each of the four `.bpmn` files has a `bpmn:definitions` root with the
    `bpmn`, `bpmndi`, `dc` and `di` OMG namespaces, and its tags balance on
    a stack scan.
  - The complete fixture has 12 `sequenceFlow`, 13 `flowNodeRef`, 6
    `messageEventDefinition`, 17 `BPMNShape` and 12 `BPMNEdge` elements.
  Each variant is compared with the complete fixture, ignoring the line
  that holds its own `Definitions_` id:
  - The draft has 11 `sequenceFlow` elements, has no `name` on the order
    task, and lacks the task-to-order-notice flow, its `incoming`/`outgoing`
    references and its edge.
  - The swapped variant only exchanges the request-notice
    `intermediateThrowEvent` and `intermediateCatchEvent` tags.
  - The inverted variant only differs in the YES/NO flow names.
  - Every fixture byte is ASCII.
- docs (`packages/core/src/bpmn/docs-example.test.ts`; it lives in core
  because only core can import both `@diagra/io` and the linter):
  - `docs/bpmn/purchase-request.jsonl` parses with no error-level issues and
    equals `packages/io/src/__fixtures__/bpmn/purchase-request.jsonl` byte
    for byte.
  - Under the recommended config, `lintBpmnPage` reports no findings on
    every `bpmn` page of the example.
  - The rule table in `docs/bpmn/lint-rules.md` has one row per rule,
    starting ``| `<rule-id>` |``. The ids taken from those rows equal
    `BPMN_LINT_RULE_IDS` as a set, with no extra or missing rows.
  - `docs/bpmn/format.md` names every registered `bpmn.*` type.
  - The `docs/bpmn/*.md` files are ASCII only.
- collab:
  - BPMN fixture Y.Doc round trip
  - a concurrent lane move and rename converge
  - a definitions array edit merges by id
- core:
  - `resolveBpmnConnection`, including the four acceptance cases (message
    flow inside one pool, sequence flow across pools, incoming flow to a
    start event, outgoing flow from an end event) and corrections
  - the four acceptance rejections and corrections through the intent APIs
    (`connectBpmn`, `connectSmart`, `reconnectBpmnFlow`), plus the position
    rejections of `updateBpmnSemantic`
  - delete-then-undo of an end event that carries an imported illegal
    outgoing sequence flow restores both the event and the flow exactly,
    with no `CommandError`
  - redo of a legal flow created through `connectBpmn` succeeds
  - pasting or duplicating a selection that contains an imported illegal
    flow succeeds
  - containment re-parenting
  - pool move translating lanes and contents
  - add-lane sizing
  - notation roles per element kind
  - SVG export structural test of the complete fixture:
    - 1 participant header and 3 lane headers
    - 3 user-task icons
    - 3 filled and 3 hollow envelopes
    - 6 double-circle borders
    - 1 thin start border and 2 thick end borders
    - 1 exclusive X
    - 12 sequence-flow arrowheads
    - YES/NO labels
  - rendering-defect regressions (section 6.4 and 6.1 revision):
    - `packages/core/src/backdrops.test.ts` (new): `isConnectorBackdrop`
      is true for ungrouped participant (collapsed and expanded), lane,
      expanded sub-process and `bpmn.group`; false for task, event,
      gateway, data object, text annotation, collapsed sub-process and any
      grouped element.
    - `packages/core/src/bpmn/svg-export-layers.test.ts` (new, so the two
      parallel implementation slices do not share a test file) holds (a)
      and (b); `packages/core/src/bpmn/svg-export-bpmn.test.ts` holds (c).
      (a) an expanded
      pool with two lanes, tasks, a sequence flow, a collapsed pool and a
      message flow exports participant and lane bodies inside
      `data-layer="backdrops"`, before `data-layer="connectors"`, which
      holds every flow line and `bpmn-sequence-arrow`/`bpmn-message-arrow`;
      tasks stay after the connectors. (b) `purchase-request.bpmn`, read
      from `packages/io/src/__fixtures__/bpmn/` and imported with
      `importBpmnXml` (`packages/core/package.json` already depends on
      `@diagra/io`),
      exports 12 sequence-flow lines and 12 `bpmn-sequence-arrow` polygons,
      all after the last participant/lane body. (c) a shape without stored
      `visual.x`/`visual.y` but with `labelBounds` places its label at the
      same absolute point in export as `bpmnNotation` with the resolved box.
    - `packages/core/src/shapes/connector.test.ts`: following the existing
      "orthogonal routes cross frames" test, an orthogonal route between
      two nodes with a pool and lane (and, separately, an expanded
      sub-process and a `bpmn.group`) standing between them stays straight.
      A collapsed sub-process in the same place still makes it detour.
      This fails before the change, because those containers were
      obstacles.
    - `packages/core/src/bpmn/notation.test.ts`: each of the seven task
      types yields a distinct icon (role `task-icon-<type>` and geometry);
      every icon primitive lies within x 6..22, y 6..22 of the task box;
      send's envelope body is filled with the stroke colour and receive's
      is `none`; `none` yields no icon; group body fill is `none`.
    - `packages/ui-solid/src/bpmn-backdrop.test.ts` (new): the canvas
      partition, `connectorBackdropIds(elements, (id) => groupOf(store, id)
      !== null)` exactly as `Canvas.tsx` calls it, puts pool and lanes in
      the backdrop set and leaves tasks and flows out, preserving z-order.
      ui-solid has no rendered-canvas frame backdrop test to follow, so this
      tests the canvas's call into the shared predicate.
    - Existing frame and ERD backdrop tests in `svg-export.test.ts` and
      `connector.test.ts` pass unchanged.
  - one test per lint rule (positive and negative)
  - config parsing
  - the four fixture lint outcomes
- io:
  - XML parser (namespaces, entities, CDATA, DOCTYPE rejection, malformed
    input)
  - serializer determinism
  - import mapping per construct
  - unsupported and foreign preservation with warnings
  - the lossless contract (section 5.4) on all fixtures
  - export id mapping
  - `reference.test.ts`, which `skipIf`s when `.reference/bpmn-article/docs`
    is absent. It imports the four files with no warnings and checks element
    counts per BPMN tag against an independent tag count, lane membership,
    names and positions, round-trip equivalence and lint rule-id multisets.
    It asserts no reference labels or text.
- cli:
  - `lint` text and JSON output, exit codes 0/1/2, `--config` overrides,
    `.bpmn` input
  - `bpmn import`/`export`, `--output`, `--check` drift and match, nested
    usage errors
- desktop:
  - `.bpmn` path routing in `session.ts`
  - problems panel selection (unit level)

### 11.1 Test ownership contract

Every implementation slice must satisfy three rules:
1. It owns at least one bun test file it creates or extends. Its
   verification includes a `bun test <owned paths>` command that reports a
   positive pass count and 0 failures. Shell, grep, xmllint and cargo checks
   are extra evidence and do not count toward this.
2. Some existing tests or fixtures pin a list that the slice changes. Each
   of them is in exactly one slice's write set, and no two slices in the
   same wave share a write path.
3. Parallel-wave gate. During a slice's implementation phase, whole-repo
   `bun run typecheck` and `bun test` failures block the slice only when
   at least one diagnostic or failing test is located in the slice's own
   write set. Diagnostics and failures located only in files owned by
   other slices of the same or a later wave are recorded in the slice's
   progress log as non-blocking evidence, with their file list. The slice
   still needs rule 1 (its own focused `bun test` with a positive pass
   count and 0 failures). Whole-repo `bun run typecheck`,
   `bunx biome check .` and `bun test` must pass at each wave's
   integration review and at final acceptance; any remaining failure there
   is routed to the slice that owns the failing file.

Audit of existing tests that pin lists or exhaustively enumerate them
(repository grep over `*.test.ts(x)` and `src-tauri`):

| existing test / fixture | what it pins | changed by | owner / action |
|---|---|---|---|
| `packages/ir/src/registry.test.ts` | the sorted `ELEMENT_TYPES` list | ir slice (16 new types) | ir slice: extend the expected list |
| `packages/io/src/jsonl/golden.test.ts` and `packages/io/src/__fixtures__/bpmn.jsonl` (new) | every registered type appears in a `GOLDEN` file | ir slice | ir slice: append `"bpmn"` to `GOLDEN` and add the golden file |
| `packages/ui-solid/src/Toolbar.test.ts` | `TOOL_MENUS` and `ACTION_MENUS` ids | not changed: the BPMN menu is a separate `BPMN_TOOL_MENU` | palette slice keeps it unedited |
| `packages/ui-solid/src/interaction.test.ts` (TOOLS loop, keyboard map) | non-gesture tools have a `creationFor`; letter shortcuts | extended by `BPMN_TOOLS` (all creation tools), no new letters | palette slice keeps it unedited |
| `packages/collab/src/ydoc.test.ts` | loops `allFixtures()`, no count | collab slice appends a BPMN fixture | collab slice keeps it unedited |
| `apps/desktop/src/seed.test.ts` | seeded element types | not changed: no slice touches the seed | none |
| `apps/cli/src/commands.test.ts` | exit codes and output fragments, not the usage text | not changed: `lint`/`bpmn` tests go in a new file | cli slice keeps it unedited |
| `apps/desktop/src-tauri/src/dialogs.rs` tests | extension helpers, not `OPEN_FILTER_EXTENSIONS` | desktop slice (adds `bpmn`) | desktop slice, same file |

There are no snapshot files (`toMatchSnapshot`/`__snapshots__`) and no
tests over Tauri config or the HTML File menu items, so nothing else needs
an owner. A slice that finds another pinned list during implementation
stops and reports it. It does not edit outside its write set.

Owned bun tests per slice:
- ir: `packages/ir/src/bpmn.test.ts`, `packages/core/src/bpmn/model.test.ts`,
  `packages/core/src/shapes/bpmn.test.ts`,
  `packages/io/src/jsonl/bpmn-compat.test.ts` and the two extended tests
  above
- fixtures: `packages/io/src/__fixtures__/bpmn/fixtures.test.ts`. It is
  discovered by `bun test` and is inside biome's and tsconfig's
  `packages/*/src` scope.
- docs: `packages/core/src/bpmn/docs-example.test.ts`. It needs only the
  core lint and the io fixtures, which are in earlier waves. It does not
  need the CLI, which may be built in the same wave as the docs. Running
  `diagra-cli lint` on the example is therefore orchestrator reconciliation
  evidence, not a docs-slice gate.
- All other slices already own new `*.test.ts` files (section 11).

ASCII-only checks are bun-test assertions in the fixtures and docs tests
(`/[^\x00-\x7F]/` over the file text), because the host's BSD `grep` has no
`-P`.

## 12. Implementation slicing

Ordered for parallel implementation plans. Each slice owns its files.

1. **ir**: types, semantics, registry, validate, the waypoint-basis move and
   tests. This is the base for all others.
2. **core model, rules and containment**: `bpmn/model.ts`, `connection.ts`,
   `containment.ts`, `shapes/bpmn.ts`, the Editor intent methods (section
   4.3) and the ui-solid `reconnect` delegation.
3. **core notation and SVG export**: `bpmn/notation.ts` and the
   `svg-export.ts` branch.
4. **core lint**: `bpmn/lint/*`.
5. **io bpmn**: `xml.ts`, `import.ts`, `export.ts`, `equivalence.ts`,
   fixtures and the reference test.
6. **collab**: fixture and tests.
7. **ui-solid**: views, palette, inspector and problems panel.
8. **cli**: `lint` and `bpmn` commands.
9. **desktop and Rust**: menus, page creation, `.bpmn` opening, the dialog
   filter and the association.
10. **docs and example**.

Dependencies:
- Slice 1 comes before everything else.
- Slices 2, 3, 4 and 5 can proceed after slice 1. Slice 4 needs only
  `bpmn/model.ts` from slice 2.
- Slices 7, 8 and 9 come after 2 to 5.
- Slice 10 comes last.

## 13. Intentional divergences

- Deleting a lane deletes its member nodes (cascade). bpmn-js keeps them in
  the pool. Undo restores them. See user-QA Q1.
- Lint messages are diagra's own wording. Rule ids and severities match
  bpmnlint recommended. The text summary line has no leading symbol.
- Desktop lint always uses recommended. Config files apply to the CLI only.
- BPMNDI ids and edge docking points are regenerated on export. They are
  `<id>_di`, and the docking points come from geometry. Semantic ids, shape
  and label bounds and interior waypoints are preserved.
- Vertical pools import with a warning and render horizontally.
- Flows paint above pools, lanes, expanded sub-processes and groups, but
  below flow nodes (section 6.4). bpmn-js paints connections above every
  shape. diagra keeps its rule that lines never cover a node's content.

## 14. Risks

- **Rule semantics** are ported from bpmnlint's documented behaviour. They
  are pinned by per-rule tests and the reference-fixture rule-id multisets,
  not by bpmnlint source.
- **The hand-written XML parser** is scoped to well-formed BPMN, rejects
  DOCTYPE and is fuzzed with malformed-input tests.
- **Older builds** cannot open `bpmn` pages (Q3).
- **Exported routes** depend on core connector routing. `--check`
  determinism relies on that routing being deterministic, which holds today.
