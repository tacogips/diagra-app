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
| 2 | Drag empty canvas (select tool) | A dashed marquee grows from the press point and selects everything it touches; shift-drag adds to the selection. Panning is the hand tool or middle-drag, and the dot grid tracks it. |
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
| 20 | Escape while dragging or resizing | The shape snaps back to where the gesture started. Nothing is added to the undo stack (the Undo button does not light up for the abandoned gesture), the selection is cleared, and the tool returns to Select. |
| 21 | Middle-click, or put a second finger down, in the middle of a drag | The drag is unaffected by the stray contact. Afterwards Ctrl/Cmd + Z still works — a leaked history batch silently kills undo for the rest of the session, and this step is how a human catches it. |
| 22 | Right-click a shape | A context menu opens at the pointer with cut / copy / paste / duplicate / delete, the z-order items, group / ungroup, an "Align and distribute" submenu and "Edit text"; items that would do nothing are greyed out. Right-click on empty canvas shows only paste, select all and zoom to fit. Escape, a wheel turn or a click elsewhere closes it; arrows and Enter drive it from the keyboard. |
| 23 | Select one or more shapes | A floating toolbar appears above the selection with fill and stroke swatches, duplicate, delete, front / back, group / ungroup, align buttons (two or more shapes only) and "More". It hides while the mouse button is down on the canvas and reappears on release; it stays inside the canvas when the selection is near an edge. "More" focuses the Inspector on the right. |
| 24 | Click a fill swatch, then the "none" swatch | The selected shapes take the colour, then lose it again; each click is one undo step. |
| 25 | Zoom widget (bottom-right): -, percentage, +, Fit | Zoom steps through 10 / 25 / 50 / 75 / 100 / 125 / 150 / 200 / 300 / 400 / 800 %; clicking the percentage returns to 100 %; Fit frames the page content with a margin and never zooms in past 100 %. |
| 26 | Shift+1, then select a shape and Shift+2 | Shift+1 fits the page; Shift+2 fits the selection (zooming in up to 400 %). The widget's percentage follows. |
| 27 | Grid / Snap / Grid snap toggles in the zoom widget | Grid hides and shows the dot grid. With Snap on, dragging a shape near another's edge or centre pulls it into line and draws a guide; with Grid snap on, it lands on the 24-unit grid. Off, it moves freely. |
| 28 | Page tabs: "+", double-click a tab, the "..." menu | "+" adds "Page N" and switches to it; double-click renames inline (Enter commits, Escape cancels, typing V or R in the field does not switch tools); the menu offers Rename, Duplicate and Delete. Delete is disabled on the last page and asks for confirmation when the page has elements; Duplicate copies the page and every element on it. Undo brings a deleted page back in place. |
| 29 | Export SVG button, and Cmd/Ctrl+Shift+E | Desktop: a save dialog filtered to `.svg` opens with the document name pre-filled; the written file opens in a browser and matches the canvas, on the canvas background colour. With a selection, only the selection is exported. Browser: the same SVG downloads. |

Recorded results live with the change that required them; a run is only
meaningful for the build it was performed against.

### Running it

Every step above is automated against a real headless Chrome, driven with
real mouse and keyboard input over the DevTools Protocol, with the
assertions read back out of the rendered DOM:

```bash
bun --cwd=apps/desktop run dev        # in another shell
bun --cwd=apps/desktop run checklist  # prints one line per step, exits non-zero on failure
```

It needs Chrome (set `CHROME_BIN` for a different binary) and is therefore
not part of `bun test` or the default gate — run it before shipping a change
to the canvas. `packages/ui-solid/src/interaction.test.ts` covers the same
state machine without a browser and *does* run in `bun test`; the browser
pass is what confirms the parts only a browser supplies — real hit areas,
pointer capture, focus, layout and the CSS transform.

Reading the steps by hand is still worthwhile when the question is how
something *looks* rather than whether it happened.
