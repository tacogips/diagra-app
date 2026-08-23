# @diagra/desktop

The Tauri 2 desktop client. It builds an `Editor` from `@diagra/core`, seeds a
demo document that exercises every element type the phase-0 renderer knows,
and mounts the `@diagra/ui-solid` canvas.

```bash
mise run dev                    # Tauri window (Rust toolchain required)
bun --cwd=apps/desktop run dev  # browser only, http://localhost:1420
```

Both entry points serve the same frontend, so the checklist below can be run
in a browser when the native toolchain is not available.

## Layers

The canvas is one CSS-transformed viewport holding three layers: an SVG layer
for connectors, a DOM layer for box shapes, and an SVG overlay for the
selection outline and resize handles. Only the resize handles take pointer
events — everything else is picked through the core's hit test, so a click on
the transparent corner of an ellipse misses it.

## Manual canvas checklist

Gestures need a real pointer, so they are verified by hand rather than in
`bun test`; the DOM-free geometry underneath them is unit-tested in
`packages/ui-solid/src/interaction.test.ts` and `packages/core`.

Run through this after any change to the canvas, the interaction state
machine, or a ShapeUtil.

| # | Step | Expected |
| - | ---- | -------- |
| 1 | Launch | Two ERD tables joined by a relation, two UML classes joined by an inheritance arrow, three geo shapes, and two nodes joined by a labelled arrow. |
| 2 | Drag empty canvas | The view pans and the dot grid tracks it. |
| 3 | Ctrl/Cmd + wheel | Zooms about the pointer; the page point under the cursor stays put. Stops at 0.1x and 8x. |
| 4 | Wheel / shift-wheel | Pans vertically / horizontally without zooming. |
| 5 | Middle-drag, and the Hand tool | Pan, whatever tool is active. |
| 6 | Click a shape | It gets a dashed outline and eight resize handles. |
| 7 | Shift-click a second shape | Both are outlined; handles disappear (multi-selection is not resizable). |
| 8 | Drag a selected shape | The whole selection moves with the cursor, at any zoom. |
| 9 | Drag a corner handle | The shape resizes; dragging past the opposite edge flips rather than inverting, and nothing shrinks below 8 page units. |
| 10 | Resize an ERD table or UML class | Width follows; height stays derived from the row count. |
| 11 | Pick Rect/Ellipse/Diamond/Cylinder, click the canvas | The shape is placed centred on the click, selected, and the tool returns to Select. |
| 12 | Pick Table/Class/Node, click the canvas | Same, with the registry's default semantic payload rendered (a `table` with an `id` column, a `Class` with empty compartments). |
| 13 | Edge tool, drag from one shape to another | A dashed rubber band follows the cursor; releasing over a second shape creates an arrow that stops at both borders. |
| 14 | Edge tool, release over empty canvas or the source shape | Nothing is created. |
| 15 | Move a connected shape | Both connectors re-route and stay attached to the borders. |
| 16 | Select a shape, press Delete or Backspace | The shape and any connector that referenced it go together. |
| 17 | Ctrl/Cmd + Z | Undoes the last edit. A drag or resize undoes in one step, not pixel by pixel. |
| 18 | Ctrl/Cmd + Shift + Z, and Ctrl/Cmd + Y | Redo. |
| 19 | Undo/Redo toolbar buttons | Enabled exactly when the keyboard shortcuts would do something; the seeded document is not undoable. |
| 20 | Escape mid-gesture | Cancels the gesture, clears the selection, returns to the Select tool. |

Recorded results live with the change that required them; a run is only
meaningful for the build it was performed against.
