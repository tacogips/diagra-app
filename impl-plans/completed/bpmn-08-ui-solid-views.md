# bpmn-08-ui-solid-views

- planId: bpmn-08-ui-solid-views
- planPath: impl-plans/completed/bpmn-08-ui-solid-views.md
- wave: 3; dependsOn: bpmn-04-core-notation-svg
- design: design-docs/specs/design-bpmn.md sections 6.1 (labels), 6.2
  (renderer wiring)
- progress log: impl-plans/progress/bpmn-08-ui-solid-views.md
- protocol: follow impl-plans/completed/bpmn-00-overview.md "Per-worker
  protocol".

## Completion (session-359)

- Status: COMPLETE. Implemented in session-359 and accepted through
  test-integrity, adversarial and branch-evidence review; archived to
  `impl-plans/completed/` in Step 8.
- Final verification: the session-359 serial integration review
  (comm-006269) passed on the combined tree: whole-repo
  `bun run typecheck`, `bunx biome check .` (515 files), `bun test`
  (1838 pass, 0 fail), cargo check/fmt/dialogs tests, the desktop build
  and gates FV1-FV7. Evidence (local, untracked):
  `tmp/bpmn-operation-flow-s359/reconcile-wave5-s359/reconcile-summary.md`.
- The session-359 status section below is the historical dispatch-time
  status.

## Session-359 status and gate: read this first

- Status: NOT STARTED. Runs in wave 3, after the wave-2 join, which
  includes bpmn-04. If an owned path already exists, re-read and
  inventory it instead of overwriting it.
- Gates: overview "Parallel-wave gate (design 11.1 rule 3)".
- G1 ownRegex:
  `^packages/ui-solid/src/shapes/(BpmnShapeView\.tsx|bpmn-primitive\.ts|bpmn-primitive\.test\.ts|ShapeView\.tsx|ConnectorView\.tsx)\(`.
- Focused owned test (strictly blocking):
  `bun test packages/ui-solid/src/shapes/bpmn-primitive.test.ts`. G2
  applies to `bun test packages/ui-solid`. A failure in an existing
  shape or connector view test is caused by this plan and blocks.
- Evidence: `tmp/bpmn-operation-flow-s359/bpmn-08-ui-solid-views/`.

## Intent

Draw BPMN notation on the editor canvas from the same primitives the SVG
export uses (`bpmnNotation`, `bpmnFlowDecoration` from bpmn-04), so the
canvas and the export look the same.

## Non-goals

- No palette, inspector, interaction or problems panel (bpmn-09..11).
- Do not change `MARKER_ELEMENTS` or `ConnectorMarkers`; BPMN flow markers
  are primitives, not `<marker>`s.
- No change to non-BPMN views.

## writePaths

- packages/ui-solid/src/shapes/BpmnShapeView.tsx (new)
- packages/ui-solid/src/shapes/bpmn-primitive.ts (new)
- packages/ui-solid/src/shapes/bpmn-primitive.test.ts (new)
- packages/ui-solid/src/shapes/ShapeView.tsx
- packages/ui-solid/src/shapes/ConnectorView.tsx
- impl-plans/progress/bpmn-08-ui-solid-views.md

sharedPaths: none.

## File-level changes

### shapes/bpmn-primitive.ts (new, pure, no JSX)

`primitiveAttributes(primitive: NotationPrimitive): { tag: "rect" |
"circle" | "path" | "polygon" | "text"; attrs: Record<string, string |
number | undefined> }` mapping each primitive to SVG attribute names
(`class: "bpmn-<role>"`, `stroke`, `fill`, `stroke-width`,
`stroke-dasharray`, geometry; polygon `points` as "x,y x,y"; text
`text-anchor`, `font-size`, rotate transform). This keeps the JSX trivial
and the mapping unit-testable without a DOM (ui-solid tests run without a
DOM; see packages/ui-solid/src/erd-table-view.test.ts).

### shapes/BpmnShapeView.tsx (new)

- Props `{ element: Element; box: Box }`.
- Renders one `<svg class="nodetto-bpmn" width=box.width
  height=box.height style="overflow: visible; position: absolute; left: 0;
  top: 0">` and one child per primitive of `bpmnNotation(element, box)`
  using `primitiveAttributes` (text: one `<tspan x dy>` per line).
- `pointer-events: none` like the other views (ShapeView.tsx header
  comment: picking is the core's job).
- Imitate `GeoShapeView.tsx` for the SVG-inside-div pattern.

### shapes/ShapeView.tsx

Add one `<Match when={isBpmnShapeType(props.element.type)}>` rendering
`<BpmnShapeView element={props.element} box={props.box} />` before the
fallback (ShapeView.tsx:~150-190). Nothing else changes.

### shapes/ConnectorView.tsx

For `bpmn.*` flow types only, after the existing line/polyline, render
`bpmnFlowDecoration(props.element, resolved().points, (id) =>
props.context.resolve(id))` primitives with `primitiveAttributes`.
`connectorDecoration` already returns no markers and an empty label for
BPMN flows (bpmn-04), and `connectorDefaultDash` gives the dash, so the
existing line code needs no change.

## Pitfalls

- Shape primitives are box-local; flow primitives are page coordinates
  (bpmn-04 contract). The connector layer is already in page coordinates.
- Labels below events overflow the shape div: the inner svg must have
  `overflow: visible`.
- Keep Solid reactivity: compute primitives in a function accessor
  (`() => bpmnNotation(props.element, props.box)`), not once at setup.

## Tests (input -> expected)

`bpmn-primitive.test.ts`:
- rect primitive with role `activity-body`, rx 10 -> tag `rect`, class
  `bpmn-activity-body`, `rx` 10
- circle with dash "4 3" -> `stroke-dasharray` "4 3"
- polygon points -> "x,y x,y" string
- rotated text -> transform `rotate(-90 x y)`
- `bpmnNotation` of a message catch event mapped through
  `primitiveAttributes` -> contains class `bpmn-event-icon-message-hollow`

## Verification

```
cd /Users/taco/gits/tacogips/nodetto-app-bpmn
bun run typecheck > tmp/bpmn-operation-flow-s359/bpmn-08-ui-solid-views/typecheck.log 2>&1   # gate G1 (overview): no ownRegex match, no unattributed "error TS" line; exit code recorded
bunx biome check packages/ui-solid/src/shapes           # exit 0
bun test packages/ui-solid/src/shapes/bpmn-primitive.test.ts   # exit 0, pass count > 0, 0 fail (owned tests, design 11.1 rule 1)
bun test packages/ui-solid                              # exit 0
```

## Done criteria

- `grep -n "BpmnShapeView" packages/ui-solid/src/shapes/ShapeView.tsx`
  shows the import and one Match.
- `git diff packages/ui-solid/src/shapes/ConnectorView.tsx` does not touch
  `MARKER_ELEMENTS` or `ConnectorMarkers`.
- Tests pass; exit codes in the progress log.
