# bpmn-r2-task-icons-labels

- planId: bpmn-r2-task-icons-labels
- planPath: impl-plans/active/bpmn-r2-task-icons-labels.md
- wave: 1; dependsOn: none (runs in parallel with bpmn-r1-connector-backdrops)
- design: design-docs/specs/design-bpmn.md section 6.1 (Task icon bullets,
  Group, Labels), 6.2 (`renderBpmnShape` passes the resolved box),
  section 11 "rendering-defect regressions" (the notation.test.ts bullet and
  test (c) in svg-export-bpmn.test.ts)
- progress log: impl-plans/progress/bpmn-r2-task-icons-labels.md
- evidence: tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/ (tmp/ is
  git-ignored)
- branch: feat/bpmn-operation-flow, same working directory as the sibling
  plan. No worktrees, no private branches, no git write operations.

## Intent

Three small rendering fixes in the shared notation module. The canvas
(`packages/ui-solid/src/shapes/BpmnShapeView.tsx`) and SVG export both map
its primitives, so fixing it here fixes both:
1. Task-type icons. `packages/core/src/bpmn/notation.ts` (task branch,
   around lines 410-417) emits the same top-right square
   `M${box.width - 22} 8 h14 v14 h-14 z` for all seven task types. Replace
   it with distinct, original, recognisable icons at the top-left.
2. `bpmn.group` body. It is filled `#ffffff` today because
   `notation.ts:rect()` uses the paint fill. It must be unfilled by default.
3. Label offset origin. `labelText` (around notation.ts:115-128) uses
   `element.visual.x ?? box.x`. Export passes a zero box
   (`svg-export.ts:renderBpmnShape`, around line 1192), while the canvas
   passes the resolved absolute box. So the two renderers take the label
   origin from different sources. Today both happen to agree, because
   `nodeBounds` (`packages/core/src/shapes/node.ts`) maps a missing x/y to
   0, the same value the `??` fallback yields. But any box that differs
   from `visual` would make them diverge. Use the box origin only, and make
   export pass the resolved box, so canvas and export share one origin by
   construction.

## Non-goals

- No change to `packages/core/src/backdrops.ts` or any routing or layer code
  (bpmn-r1 owns them).
- Do NOT edit `packages/ui-solid/src/shapes/BpmnShapeView.tsx`. It already
  maps `rect`/`circle`/`path`/`polygon`/`text` and passes `props.box`.
- No change to the activity label layout, the loop, multi-instance or
  compensation markers, event icons, gateway markers, participant, lane or
  flow decorations, or `bpmnLabelBox`.
- No new `NotationPrimitive` kind and no new field (for example no
  `fillRule`). Use the existing union.
- Do NOT copy or trace bpmn-js, bpmn-font or `.reference/` artwork. Draw
  the geometry yourself.
- Do NOT edit `packages/core/src/bpmn/fixtures.test.ts`. It must keep
  passing unchanged (it pins "bpmn-task-icon-user": 3).
- No new dependencies, no emojis.

## writePaths

- packages/core/src/bpmn/notation.ts
- packages/core/src/bpmn/notation.test.ts
- packages/core/src/svg-export.ts
- packages/core/src/bpmn/svg-export-bpmn.test.ts
- impl-plans/progress/bpmn-r2-task-icons-labels.md (new)

sharedPaths: none. bpmn-r1 does not edit `svg-export.ts`; its new test file
`packages/core/src/bpmn/svg-export-layers.test.ts` only reads the export
output.

## File-level changes

### packages/core/src/bpmn/notation.ts

Task icons: replace the single `iconPath(...)` push in the
`element.type === "bpmn.task" && taskType !== "none"` block with a call to a
new private helper.

    function taskIcon(taskType: string, stroke: string, fill: string): NotationPrimitive[]

- Contract (design 6.1):
  - Every primitive lies inside the local square x 6..22, y 6..22. All
    coordinates are fixed constants and do not depend on `box`.
  - Exactly ONE primitive has role `task-icon-<taskType>` (the main
    outline). Any other primitive has role `task-icon-<taskType>-detail`.
    This keeps `fixtures.test.ts` ("bpmn-task-icon-user": 3) and
    `svg-export-bpmn.test.ts:121` (one `class="bpmn-task-icon-user"`)
    unchanged. Keep the existing role spelling, including
    `task-icon-businessRule`.
  - Paths use only absolute `M`, `L`, `C`, `Q` and `Z` commands with x y
    pairs. No `H`, `V`, `A` and no lowercase commands. Circles and rects
    use the `circle`/`rect` primitive kinds.
  - Unknown `taskType` values, and `none`, produce no icon (an empty array).
  - Stroke width 1 to 1.5. Reuse `iconPath(role, d, stroke, fill, strokeWidth)`.
- Per type (keep each recognisable at about 16 units):
  - user: main = a shoulders/bust path (a `Q`/`C` curve from about (7,22)
    over (14,15) to (21,22), closed), hollow (`fill: "none"`); detail = a
    head `circle` at about (14,10) r 3.5, hollow.
  - service: main = a gear outline path (8 teeth from `L` segments around
    centre (14,14), outer radius about 7.5, inner about 5.5), hollow;
    detail = a hub `circle` r 2.5, hollow. Precompute the tooth points
    with Math.cos/sin and round to 0.01, as other numeric output is
    rounded. Keep it deterministic.
  - manual: main = one closed hand outline path (palm with four finger
    strokes and a thumb, built from `L`/`Q`), hollow.
  - send: main = an envelope body path (rect plus flap, closed) with
    `fill = stroke` (filled); detail = the flap `V` line path in the task
    fill colour (`fill: "none"`, `stroke = fill`) so the flap is visible
    on the filled body.
  - receive: main = the same envelope rectangle path with `fill: "none"`
    (hollow); detail = the flap line, `stroke = stroke`, `fill: "none"`.
  - script: main = a scroll outline path (wavy left and right edges with
    `C`/`Q` curves), hollow; detail = one path with three short horizontal
    text lines.
  - businessRule: main = a `rect` table outline (about x 6, y 8, w 16,
    h 12), hollow; detail = a header-row `rect` (same x/w, h 3) with
    `fill = stroke`, and one path for one row divider and one column
    divider.
- Pitfalls:
  - The "hollow" meaning is `fill: "none"`. The "filled" meaning is
    `fill === stroke` (the element stroke, which `visual.style.stroke`
    overrides). Do not hard-code `#000000`.
  - Do not move the icon with `box.width` (the old one was top-right).
  - Do not emit role `task-icon-<type>` twice for one icon.

Group: in the `bpmn.group` case, the body rect must get `fill: "none"`
unless `element.visual.style?.fill` is set, in which case use that fill.
`rect()` closes over `fill` from `paint()`, so either pass an override or
spread the primitive with a corrected `fill`. Keep the roles
`["group-body", "group-label"]` exactly (pinned by notation.test.ts:161).

Labels: in `labelText`, compute the local offset as
`bounds.x - box.x + bounds.width / 2` and `bounds.y - box.y`. Remove the
`element.visual.x ??` / `element.visual.y ??` reads. The fallback branch
(no `labelBounds`) is unchanged. Do not change `bpmnLabelBox`.

### packages/core/src/svg-export.ts

- `renderBpmnShape(element, box)` (around line 1192): pass `box` itself
  (the resolved absolute box) to `bpmnNotation` instead of
  `{x: 0, y: 0, width: box.width, height: box.height}`. Keep the
  `translate(box.x box.y)` wrapper. This is the only edit in this file. Do
  not touch the layer assembly around line 1815 (bpmn-r1 relies on it as it
  is).
- Pitfall: verify by reading `bpmnNotation` that no primitive other than
  `labelText` uses `box.x`/`box.y`. Shape geometry uses `box.width`,
  `box.height` and `center` only. If you find another use, stop and record
  it under Open issues.

### packages/core/src/bpmn/notation.test.ts

Add tests. Keep the existing ones unchanged, except where a literal
assertion pins the old square path (none known; check with
`grep -n "h14 v14"`).
- For each of the 7 task types with box `{x: 10, y: 20, width: 100, height: 80}`:
  - exactly one primitive has role `task-icon-<type>`, and every other icon
    primitive's role is `task-icon-<type>-detail`
  - every icon primitive lies within x 6..22, y 6..22: for `path`, parse
    the coordinate pairs from `d` (only M/L/C/Q/Z allowed, so assert
    `/^[MLCQZ0-9 .,-]+$/` first); for `circle`, use cx ± r and cy ± r; for
    `rect`, use x..x+width and y..y+height
- The 7 icon signatures (the concatenated kind + geometry of all icon
  primitives) are pairwise distinct.
- send: the `task-icon-send` primitive has `fill === stroke`, using
  default black and also with `visual.style.stroke: "#123456"` (fill
  `"#123456"`). receive: `task-icon-receive` has `fill === "none"`.
- `taskType: "none"` -> no role starting with `task-icon`.
- The icon is identical for box widths 100 and 160 (top-left, independent
  of width).
- group: the `group-body` primitive has `fill === "none"`; with
  `visual.style.fill: "#eeeeee"` it has `"#eeeeee"`.
- label origin: a `bpmn.event` with `labelBounds {x: 100, y: 200, width:
  60, height: 27}`, `visual.x = 999`, `visual.y = 999` and box
  `{x: 110, y: 150, ...}` puts the label text `x` at
  `100 - 110 + 30 = 20`. The box origin wins over a stale `visual.x`. The
  existing test at notation.test.ts:227 must still pass unchanged.

### packages/core/src/bpmn/svg-export-bpmn.test.ts

Add test (c). Imitate "includes an external event label in export bounds"
in the same file. A `bpmn.event` whose `visual` has width and height plus
`labelBounds`, but NO `x`/`y`, is rendered through `renderPageSvg`. Expect
the `bpmn-label` text's absolute position (the group's
`translate(tx ty)` plus the text `x`/`y`) to equal
`bpmnNotation(element, resolvedBox)` text position plus `resolvedBox` x/y,
which is `labelBounds.x + labelBounds.width / 2`. Get the resolved box from
`createShapeContext(store, registry, 1).boundsOf(id)` or from the shape
util (`packages/core/src/shapes/bpmn.ts` `getBounds` -> `nodeBounds`, so
the box is at x 0, y 0). Use `labelBounds` far from 0 (for example x 300,
y 200). This test pins the canvas/export agreement. It is expected to pass
both before and after the change, because the latent mismatch is not
observable through `nodeBounds`. The failing-before proof is the
stale-`visual.x` notation test (Verification step 1). Keep the existing
tests unchanged.

## Invariants

- `packages/core/src/bpmn/fixtures.test.ts` passes unchanged:
  `bpmn-task-icon-user` stays 3, and the other pinned counts are unchanged.
- `svg-export-bpmn.test.ts:121` one `class="bpmn-task-icon-user"` is
  unchanged.
- `packages/ui-solid/src/shapes/bpmn-primitive.test.ts` passes unchanged.
- Rendering of every non-BPMN element type is byte-identical (only the BPMN
  branch of `renderShape` is touched).
- Strict TypeScript, Biome style (2-space indent, double quotes), no `any`.

## Acceptance criteria

- Seven distinct top-left icons. Send is filled and receive hollow. All
  new notation tests pass.
- The group body is unfilled by default and honours `visual.style.fill`.
- The label offset uses the box origin, export passes the resolved box,
  the stale-`visual.x` test fails before and passes after the fix, and test
  (c) passes.
- `git diff --name-only` lists, from this plan, only the writePaths above.

## Verification

All logs go to `tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/`.
Run every command in the foreground from the repository root. Record the
exact command, exit code, counts and log path in the progress log.

1. Pre-change proof (after writing test (c) and the label-origin test,
   before editing `labelText`/`renderBpmnShape`):
   `bun test packages/core/src/bpmn/svg-export-bpmn.test.ts packages/core/src/bpmn/notation.test.ts > tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/label-prechange.log 2>&1`
   -> expected NON-zero exit, with the stale-`visual.x` label-origin test
   in notation.test.ts failing (the old formula gives 100 - 999 + 30).
   Test (c) may pass here, which is expected; record its result.
2. Focused owned tests (strictly blocking, exit 0, positive pass count,
   0 fail):
   `bun test packages/core/src/bpmn/notation.test.ts packages/core/src/bpmn/svg-export-bpmn.test.ts > tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/focused.log 2>&1`
3. Unchanged-invariant tests (strictly blocking for this plan):
   `bun test packages/core/src/bpmn/fixtures.test.ts packages/ui-solid/src/shapes/bpmn-primitive.test.ts packages/core/src/svg-export.test.ts > tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/invariants.log 2>&1`
   -> exit 0.
4. `bunx biome check packages/core/src/bpmn/notation.ts packages/core/src/bpmn/notation.test.ts packages/core/src/svg-export.ts packages/core/src/bpmn/svg-export-bpmn.test.ts > tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/biome.log 2>&1`
   -> exit 0. Use `bunx biome check --write <these files>` only.
5. Gate G1:
   `bun run typecheck > tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/typecheck.log 2>&1`,
   then
   `grep -E '^packages/core/src/(bpmn/(notation|notation\.test|svg-export-bpmn\.test)|svg-export)\.ts\(' tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/typecheck.log`
   must print nothing. A line starting with `error TS` and no file blocks.
   Diagnostics in bpmn-r1's writePaths go under "Sibling diagnostics
   (non-blocking)".
6. Gate G2:
   `bun test packages/core packages/ui-solid > tmp/bpmn-render-fix-s360/bpmn-r2-task-icons-labels/packages.log 2>&1`.
   Record the exit code and counts. A failing file in this plan's
   writePaths, or a failure caused by icon, group-fill or label changes,
   blocks. A failure only in bpmn-r1's files (`backdrops.test.ts`,
   `svg-export-layers.test.ts`, `connector.test.ts`, `bpmn-backdrop.test.ts`)
   goes under "Sibling test failures (non-blocking)".
7. Static checks, each recorded:
   `grep -c "h14 v14" packages/core/src/bpmn/notation.ts` -> 0;
   `git diff --name-only -- packages/ui-solid/src/shapes/BpmnShapeView.tsx packages/core/src/bpmn/fixtures.test.ts packages/core/src/backdrops.ts` -> empty.

## Progress log and protocol

Create `impl-plans/progress/bpmn-r2-task-icons-labels.md` with these
sections: Start (UTC), Files (path, pre-hash, post-hash via `shasum -a 256`),
Commands (command, exit, counts, log), Pre-change proof, Icon originality
note (one line per icon describing how its geometry was constructed),
Sibling diagnostics (non-blocking), Sibling test failures (non-blocking),
Drift, Open issues, Done checklist.
- Do a fresh read and record a pre-hash before each edit, and a post-hash
  after it. Before finishing, re-hash every owned file. If a hash differs
  from your last post-hash, re-read, re-apply your intent and log the drift.
- Foreground commands only. No git write operations. Never touch
  `.reference/`.

## Done checklist (mechanical)

- [ ] Verification step 1 log shows the expected pre-change failure
- [ ] Verification steps 2, 3 and 4 exit 0
- [ ] The step 5 own-path grep prints nothing
- [ ] Step 6 has no blocking failure
- [ ] Step 7 static checks hold
- [ ] The progress log is complete, including the icon originality note
