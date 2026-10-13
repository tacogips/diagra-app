# bpmn-08-ui-solid-views

- planId: bpmn-08-ui-solid-views
- planPath: impl-plans/active/bpmn-08-ui-solid-views.md
- wave: 3; dependsOn: bpmn-04-core-notation-svg
- design: design-docs/specs/design-bpmn.md sections 6.1 (labels), 6.2
  (renderer wiring)
- progress log: impl-plans/progress/bpmn-08-ui-solid-views.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

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
- Renders one `<svg class="diagra-bpmn" width=box.width
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
cd /Users/taco/gits/tacogips/diagra-app-bpmn
bun run typecheck                                       # exit 0
bunx biome check packages/ui-solid/src/shapes           # exit 0
bun test packages/ui-solid                              # exit 0
```

## Done criteria

- `grep -n "BpmnShapeView" packages/ui-solid/src/shapes/ShapeView.tsx`
  shows the import and one Match.
- `git diff packages/ui-solid/src/shapes/ConnectorView.tsx` does not touch
  `MARKER_ELEMENTS` or `ConnectorMarkers`.
- Tests pass; exit codes in the progress log.
