# bpmn-04-core-notation-svg

- planId: bpmn-04-core-notation-svg
- planPath: impl-plans/active/bpmn-04-core-notation-svg.md
- wave: 2; dependsOn: bpmn-01-ir-core-contract
- design: design-docs/specs/design-bpmn.md sections 6.1, 6.2, 5.3
  (`bpmnRouteResolver`), 11 (notation roles test)
- progress log: impl-plans/progress/bpmn-04-core-notation-svg.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Intent

One shared notation module produces renderer-neutral primitives for every
BPMN element and flow decoration. The SVG export (this plan) and the
ui-solid views (bpmn-08) both map the same primitives, so the UI and the
export cannot diverge and tests can count roles. Also provides the route
resolver the BPMN XML export uses to write the waypoints the user sees.

## Non-goals

- No PNG/PDF export and no generic export command.
- No ui-solid changes (bpmn-08).
- Do NOT change `MarkerKind` or the `MARKER_IDS` table: BPMN flow markers
  are drawn as primitives, not as SVG `<marker>`s, because `MarkerKind`
  keys `Record` tables in svg-export.ts:136 and ui-solid
  ConnectorView.tsx:38.
- No change to the rendering of any non-BPMN type.

## writePaths

- packages/core/src/bpmn/notation.ts (new)
- packages/core/src/bpmn/notation.test.ts (new)
- packages/core/src/bpmn/routes.ts (new)
- packages/core/src/bpmn/routes.test.ts (new)
- packages/core/src/bpmn/svg-export-bpmn.test.ts (new)
- packages/core/src/svg-export.ts
- packages/core/src/shapes/connector.ts
- impl-plans/progress/bpmn-04-core-notation-svg.md

## sharedPaths

- packages/core/src/bpmn/index.ts: append exactly
  `export * from "./notation.ts";` and `export * from "./routes.ts";`
  (fresh-read and pre/post hash rule).

## Contracts (pinned; bpmn-08, bpmn-12, bpmn-13, bpmn-15 rely on them)

```ts
interface NotationPaint {
  readonly role: string;            // e.g. "event-border-start"; rendered as class "bpmn-<role>"
  readonly stroke?: string;         // "none" allowed
  readonly fill?: string;           // "none" allowed
  readonly strokeWidth?: number;
  readonly dash?: string;           // SVG dash array, e.g. "6 4"
}
export type NotationPrimitive =
  | (NotationPaint & { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx?: number })
  | (NotationPaint & { readonly kind: "circle"; readonly cx: number; readonly cy: number; readonly r: number })
  | (NotationPaint & { readonly kind: "path"; readonly d: string })
  | (NotationPaint & { readonly kind: "polygon"; readonly points: readonly Vec[] })
  | (NotationPaint & { readonly kind: "text"; readonly x: number; readonly y: number; readonly lines: readonly string[];
      readonly anchor: "start" | "middle"; readonly fontSize: number; readonly lineHeight: number; readonly rotate?: -90 });

// Shapes: coordinates are local to the element box (origin = box top-left).
// Labels below a shape have local y > box height (outside the box).
export function bpmnNotation(element: Element, box: Box, lookup?: (id: ElementId) => Element | undefined): readonly NotationPrimitive[];
// Label box in page coordinates (labelBounds, else default placement), or null when the element has no external label.
export function bpmnLabelBox(element: Element, box: Box): Box | null;
// Flows: page coordinates. `points` is the resolved connector polyline (start..end).
export function bpmnFlowDecoration(element: Element, points: readonly Vec[], lookup: (id: ElementId) => Element | undefined): readonly NotationPrimitive[];
export function isBpmnShapeType(type: string): boolean; // the 12 non-edge bpmn types

// routes.ts
export function bpmnRouteResolver(editor: Editor): (edge: Element) => readonly Vec[] | undefined; // resolveConnector(...).points
```

Design 6.1 names the second argument `document`; it is realised as an
optional `lookup` because shape notation needs no document and the UI
already has `editor.store.get`. Flow decorations need `lookup` to know the
source type (conditional diamond only for non-gateway sources).

### Pinned roles (tests count these; class = `bpmn-<role>`)

- participant: `participant-body`, `participant-header`,
  `participant-label` (rotated -90, centred in the 30-unit band); collapsed
  pool: `participant-body` + `participant-label` centred, no header
- lane: `lane-body`, `lane-header`, `lane-label`
- task, subProcess, callActivity: `activity-body` (rect rx 10, stroke 2;
  call activity stroke 5; event sub-process dash "2 3"); `activity-label`
  (wrapped, centred; expanded sub-process top-left)
- task icons: `task-icon-user|service|manual|send|receive|script|businessRule`
  (send icon filled, receive hollow)
- markers: `marker-loop`, `marker-parallel`, `marker-sequential`,
  `marker-compensation`, `marker-subprocess` (collapsed "+" box),
  `marker-adhoc`
- events: `event-border-start` (r 18, stroke 2), `event-border-intermediate`
  (outer r 18) plus `event-border-inner` (r 15, stroke 1.5),
  `event-border-end` (stroke 4); non-interrupting adds dash "4 3" to the
  border primitives
- event icons: `event-icon-<kind>-filled` or `event-icon-<kind>-hollow`,
  kind in message, timer, error, escalation, cancel, compensation,
  conditional, link, signal, terminate, multiple, parallelMultiple; filled
  on intermediateThrow and end, hollow otherwise (terminate is always
  `event-icon-terminate-filled`)
- gateways: `gateway-body` (diamond polygon), `gateway-marker-exclusive`
  (only when `markerVisible !== false`), `gateway-marker-parallel`,
  `gateway-marker-inclusive`, `gateway-marker-eventBased`,
  `gateway-marker-complex`
- data: `data-object-body`, `data-object-collection`,
  `data-object-input` (hollow arrow), `data-object-output` (filled arrow),
  `data-store-body`; `annotation-bracket`, `annotation-text`; `group-body`
  (dash "8 3 2 3", rx 10), `group-label`
- external label (events, boundary events, gateways, data object, data
  store): `label` text primitive; position from `bpmnLabelBox`
- flows: `sequence-arrow` (filled triangle at end), `default-slash`,
  `conditional-diamond` (hollow, at start; only when `condition` is a
  non-empty string, the flow is not default and the source is not a
  gateway), `message-start-circle` (hollow), `message-arrow` (hollow
  triangle), `association-arrow` (open arrow per direction; both -> two),
  `data-association-arrow` (open arrow at end), `flow-label` (text at
  `labelBounds` centre, else at the polyline midpoint)

Default label placement (design 6.1): top = shape bottom + 7, width 90,
centred on the shape, lines wrapped with `wrapTextLines`
(packages/core/src/text-layout.ts:50) at font size 11, line height 13.

Colours: stroke = `visual.style.stroke ?? "#000000"`, shape fill =
`visual.style.fill ?? "#ffffff"`, text = `visual.style.color ?? "#000000"`;
"filled" icons use the stroke colour as fill.

## File-level changes

### packages/core/src/bpmn/notation.ts

Pure functions only (no DOM, no editor). Implement every rule of design
6.1 with the roles above. Keep icon geometry small and simple (paths sized
to about 20x20 inside a 36 circle, 16x16 top-left inside activities).

### packages/core/src/shapes/connector.ts

Only these two functions change (connector.ts:787, 828):
- `connectorDecoration`: for the four `bpmn.*` flow types return
  `{ start: null, end: null, label: "" }` (labels and arrowheads come from
  `bpmnFlowDecoration`).
- `connectorDefaultDash`: `bpmn.messageFlow` -> `"6 4"`;
  `bpmn.association` and `bpmn.dataAssociation` -> `"1 4"`.

### packages/core/src/svg-export.ts

- `renderShape` (svg-export.ts:1118): add a branch for every type where
  `isBpmnShapeType(type)`: emit `<g transform="translate(x y)">` holding
  one SVG node per primitive with `class="bpmn-<role>"` (rect, circle,
  path, polygon, text with one `<tspan>` per line; rotated text uses
  `transform="rotate(-90 x y)"`). Escape text with `escapeXml`. Use the
  existing `tag`/`wrap`/`fmt` helpers.
- `renderConnector` (svg-export.ts:1317): for `bpmn.*` flows append the
  `bpmnFlowDecoration(element, resolved.points, lookup)` primitives after
  the line (page coordinates, no translate). `lookup` is
  `(id) => context.resolve(id)` (`ShapeContext.resolve`,
  packages/core/src/shape-util.ts:31).
- Export bounds: where `renderElementsSvg` pushes `boxes` (svg-export.ts
  ~1460), also push `bpmnLabelBox(element, box)` when it is non-null, and
  push the bounding box of `flow-label` primitives for flows, so page and
  selection exports include labels.
- Imitate the existing per-type branches; do not refactor other branches.

### packages/core/src/bpmn/routes.ts

`bpmnRouteResolver(editor)` returns a function that calls
`resolveConnector(edge, editor.createShapeContext(), endpointReaderFor(edge.type))`
and returns `points`, or `undefined` when unresolved. Create the shape
context once per resolver call batch is not required; correctness first.

## Pitfalls

- Shape primitives are box-local; flow primitives are page coordinates.
  Mixing them breaks bpmn-08's views.
- `routes.ts` uses `import type { Editor } from "../editor.ts"` (type-only)
  to avoid a runtime import cycle; `svg-export.ts` imports
  `./bpmn/notation.ts` directly, not the barrel.
- `bpmnNotation` must be deterministic (no Math.random, no Date).
- The exclusive gateway X is omitted only when `markerVisible === false`.
- Do not render BPMN labels twice: `connectorDecoration` returns `label: ""`
  for BPMN flows.
- Existing svg-export tests (packages/core/src/*svg*.test.ts and
  rotation-export.test.ts) must pass unchanged.

## Tests (input -> expected)

`notation.test.ts` (one case per element kind, assert roles):
- start/intermediateCatch message/intermediateThrow message/end event ->
  roles `event-border-start`; `event-border-intermediate` +
  `event-border-inner` + `event-icon-message-hollow`; ... +
  `event-icon-message-filled`; `event-border-end`
- boundary event `cancelActivity: false` -> border primitives have a dash
- two definitions -> `event-icon-multiple-*`; with `parallelMultiple` ->
  `event-icon-parallelMultiple-*`
- exclusive gateway, `markerVisible` absent -> `gateway-marker-exclusive`;
  `markerVisible: false` -> no marker; each other gateway type -> its role
- each taskType -> its `task-icon-*` role; loop/multi-instance/compensation
  -> marker roles; collapsed subProcess -> `marker-subprocess`; event
  sub-process -> dashed `activity-body`; call activity -> strokeWidth 5
- participant -> header + rotated label; collapsed participant -> no header
- event with no `labelBounds` -> `label` primitive top at box height + 7;
  with `labelBounds` -> label inside those bounds (converted to local)
- `visual.style.stroke: "#ff0000"` -> body stroke "#ff0000"
- flows: sequence -> one `sequence-arrow`; `isDefault` -> `default-slash`;
  task source with condition -> `conditional-diamond`; gateway source with
  condition -> no diamond; message flow -> `message-start-circle` +
  `message-arrow` and `connectorDefaultDash` "6 4"; association direction
  both -> two `association-arrow`

`routes.test.ts`:
- editor with two tasks and a sequence flow -> resolver returns >= 2
  points, first on the source outline, last on the target outline

`svg-export-bpmn.test.ts` (hand-built document, no io import):
- a pool with two lanes, a start event, a user task, a message throw, an
  exclusive gateway, an end event, sequence flows -> `exportPageSvg()`
  contains `class="bpmn-participant-header"` once,
  `class="bpmn-lane-header"` twice, `bpmn-task-icon-user` once,
  `bpmn-event-icon-message-filled` once, `bpmn-gateway-marker-exclusive`
  once, `bpmn-sequence-arrow` once per sequence flow
- the viewBox includes the label below the end event (label bottom <=
  viewBox bottom)
- non-BPMN regressions are covered by the existing svg export tests,
  which must pass unchanged (do not edit them)

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck                                    # exit 0 (ui-solid still compiles: MarkerKind unchanged)
bunx biome check packages/core/src/bpmn packages/core/src/svg-export.ts packages/core/src/shapes/connector.ts   # exit 0
bun test packages/core/src/bpmn/notation.test.ts packages/core/src/bpmn/routes.test.ts packages/core/src/bpmn/svg-export-bpmn.test.ts   # exit 0, pass count > 0, 0 fail (owned tests, design 11.1 rule 1)
bun test packages/core                               # exit 0
bun test packages/ui-solid                           # exit 0
```

## Done criteria

- `git diff packages/core/src/shapes/connector.ts` shows changes only
  inside `connectorDecoration` and `connectorDefaultDash` (bpmn-01's
  `@diagra/ir` import of the two waypoint functions, its re-export line and
  the removal of the two moved function bodies excepted; bpmn-01 lands in
  wave 1, so compare against the post-bpmn-01 state recorded in the
  bpmn-01 progress log).
- `grep -n "MarkerKind =" -A6 packages/core/src/shapes/connector.ts` lists
  the same five kinds as before.
- `packages/core/src/bpmn/index.ts` has the two new lines once each.
- All listed tests exist and pass; exit codes in the progress log.
