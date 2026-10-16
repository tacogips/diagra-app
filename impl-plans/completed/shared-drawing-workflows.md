# Shared drawing workflows

Implemented the follow-up editor work on top of the AI drawing CLI:

- Local filesystem and synchronized cloud Y.Doc notifications implement the same
  `DocumentChangeSource` interface. The monitor handles resource switching,
  immediate unsubscribe, failed setup and stale events; adapters retain native
  watch serialization and CRDT transaction origins/changed IDs.
- Selected shapes expose Comment in the selection toolbar and context menu. The
  composer focuses immediately and creates a thread with the shape as its target.
- Export opens one modal with SVG, PNG, PDF, Mermaid, D2, SQL, BPMN and Code tabs.
  Availability follows page content/selection; arrow keys navigate tabs and Escape
  returns focus to the opener. Existing rendering and native save backends remain.
- Creation shapes can be dragged from the palette onto the canvas. Window-owned
  pointer move/release handling survives palette DOM updates, with a four-pixel
  threshold and cancellation on Escape, pointer cancellation and window blur.
  Placement shares click creation and is one undo step. Click selection still works.
- Removed persistent obvious hints from Shapes, shared styles, color tokens and
  the component library. Control-specific tooltips remain.
- Local page creation, renaming and ordering autosave. Switching active pages
  remains view state and does not dirty the document.

Mode cleanup, right-button panning and draggable page tabs are included through
`80ffd79`, `36a26d3` and their ancestors.

Validation:

- Lint/typecheck pass; 1,989 tests pass, 5 local-reference fixture tests skip.
- Desktop production build passes (existing chunk-size warning).
- Real browser: drag a palette rectangle onto canvas, verify the selected new
  layer, undo once to remove it, redo; select the shape, open Comment, submit and
  verify the thread identifies its target; open Export and verify all format tabs.
  Earlier checks also exercised Mermaid/D2 source and Escape focus restoration.
- `cli-live.test.ts` invokes real CLI subprocesses and uses real filesystem events
  across atomic replacements: CLI additions appear in the editor, a pending human
  move merges with a second CLI addition, saves back to disk, then CLI outline,
  JSON inspection, snapshot diff and PNG rendering succeed.
- Existing two-editor collaboration tests exercise the cloud notification adapter
  through field merges, remote additions/deletions, page ordering and local undo.

The private repository's full Worker runtime gate was still running without a
terminal result when this record was written; it is not counted as passed here.
