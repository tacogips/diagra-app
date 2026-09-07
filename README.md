# diagra

A diagram editor for ER diagrams, UML class diagrams, sequence diagrams,
and freeform drawing, with a semantic JSONL file format and real-time
collaboration.

This repository is **diagra-app**, the public half of the project:

- Shared editor packages (`packages/*`): Diagram IR, framework-agnostic
  editor core, JSONL and import/export adapters, Yjs client binding, and
  the Solid renderer.
- The standalone desktop client (`apps/desktop`): a Tauri 2 app that edits
  local JSONL files and, when signed in, cloud documents.

The cloud edition (Cloudflare Workers sync server, hosted web SPA, auth,
infrastructure) lives in the private `diagra-cloud` repository, which
consumes this repository as a git submodule. Do not add server-side code
or deployment config here.

The full product design lives in the private `diagra-cloud` repository (`design-docs/specs/product-design.md`).

## Layout

```text
packages/
  ir/        Diagram IR: types, element type registry, validation, migrations
  core/      Editor core (no framework dependencies)
  io/        JSONL persistence, SVG/Mermaid/D2 adapters
  collab/    Yjs client binding (sync server is private)
  ui-solid/  Solid renderer
apps/
  desktop/   Tauri 2 desktop client
```

`ir` and `io` implement the Diagram IR and the deterministic JSONL file
format; see [`packages/ir/README.md`](packages/ir/README.md) and
[`packages/io/README.md`](packages/io/README.md). `core` implements the
editor engine — store, commands, camera, selection, history, ShapeUtil
registry and hit testing — and `ui-solid` renders it to SVG and DOM; the
desktop client wires the two together, see
[`apps/desktop/README.md`](apps/desktop/README.md) for the canvas layout and
the manual gesture checklist. `collab` is still a scaffold.

## Development

```bash
mise install
bun install
mise run dev
```

## Common Tasks

```bash
mise run check
mise run test        # typecheck + bun test + cargo test
mise run build
mise run tauri-build
mise run lint
```

Frontend unit tests run under `bun test` and live next to their sources as
`packages/*/src/**/*.test.ts`. Pointer and keyboard gestures need a real
pointer, so they are covered by the manual checklist in
[`apps/desktop/README.md`](apps/desktop/README.md) instead.

mise installs Bun, Rust, and rust-analyzer. Install the native Tauri system
libraries required by your operating system separately.

## Page ordering

Page options include Move left and Move right. New pages append to the document;
duplicates appear immediately after their source. Ordering is undoable, persists
in JSONL and synchronizes between clients without moving artwork or changing
the active page. Legacy documents keep ID order until an ordering operation
assigns explicit keys; loading alone does not rewrite them.
Opening a document activates its first displayed page. Deleting the active page
opens the next surviving tab, or the nearest previous tab if none follows it,
and restores that page's local pan/zoom. Remote deletion follows the same rule;
undoing deletion restores the tab without forcing collaborators to switch pages.

## Copy and paste styles

Copy style and Paste style are available in the selection menu and through
Cmd/Ctrl+Alt+C and Cmd/Ctrl+Alt+V. Copy one layer, then apply its literal
appearance to another selection in one undo step. Content and geometry stay
intact; style-token and typography links detach, while size and layout-token
bindings remain. Locked targets are skipped. This clipboard stays in the editor
session and is independent of the element clipboard.
An unstyled source clears custom styling. Paste is disabled when no editable
target would change; token/comment resources are excluded. Collaborative undo
preserves simultaneous content edits from another client.

## Exact zoom

The canvas zoom percentage is editable, including arithmetic such as `100 / 3`.
Exact zoom retains the page point at the viewport center and is limited to
10–800%. Separate 100%, Fit and Selection buttons reset or frame the desired
content. Zoom remains local to each page and does not edit the document.

## Numeric inspector fields

Numeric inspector fields accept arithmetic such as `390 - 32` or `(24 + 8) * 2`.
Enter or blur commits the result within the field's limits; Escape restores the
stored value. Up/Down changes one step and Shift changes ten steps. Expressions
support `+`, `-`, `*`, `/`, parentheses and scientific notation, without units or
percentages. Invalid expressions and overflow leave the design unchanged.

Selecting multiple layers exposes collective X/Y and width/height fields.
Position edits move the selection; size edits scale its layers and spacing from
the selection's top-left corner. Preserve selection proportions couples the two
dimensions. Artboard children follow constraints and auto layout, and database
table/class heights remain derived. Unsupported resize selections show a reason.

## Page navigation

Review comments can be filtered across all pages and searched by feedback,
author, target or page name. Show on canvas opens the thread's page and centers
its location while retaining that page's zoom. Thread numbers remain local to
each page; the all-pages list includes page names for context.

Navigate the page strip with Left/Right arrows or Home/End. F2 renames the
focused page; Down opens its options. Within page options, Up/Down and Home/End
move between actions, Escape returns to the page, and Tab leaves the menu.
Only the selected page and its options enter the normal tab order.
Each page remembers its pan and zoom for the current editing session. Returning
to a page restores its view; an unvisited page starts at 100% and the origin.
Remote page updates retain your active page, views and surviving layer selection.
Deleted layers and layers moved to another page leave the selection.
Opening a document resets
view memory. These preferences are local and never saved into the design.

## Database schema export

Layer search includes database columns and types, default/generated expressions,
index names, check constraints, UML attributes/methods/parameters and image
descriptions. Results show the matching detail and retain their parent hierarchy.
Internal IDs, embedded image data and extension metadata are not searched.
Enable All pages to search across the document; results retain their hierarchy
and show page names. Selecting a result opens its page. Go selects the layer and
fits its visible artwork to the canvas; hidden layers remain hidden.
Shift-click selects the visible range from the last selected anchor; Ctrl/Cmd-click
toggles individual layers, and Ctrl/Cmd+Shift-click adds a range. Ranges stay on
one page and exclude filtered-out rows and collapsed descendants. Hidden or
locked layers that appear in the list can still be selected for inspection.
Double-click a layer name or focus it and press F2 to rename it in place.
Enter or blur saves; Escape cancels. Clearing restores the content/type label
without changing visible text or database names. Concurrent name changes,
locks and document reloads reject stale drafts instead of overwriting them.
For multiple selected layers, Rename selected layers in the inspector previews
patterns using `{name}`, `{type}` and `{n}`, with a numbering start and minimum
digit count. Numbering follows expanded layer-panel order and skips locked
layers and resources. Only explicitly selected layers on the active page are
renamed; selected containers do not implicitly rename their children. Apply is
one undo step. An empty pattern clears editor-only names without changing
visible text, table names or other semantic content.
Optional Find in name and Replace with fields perform case-sensitive literal
replacement on the existing layer name before `{name}` expansion. Every match
is replaced; an empty Find skips replacement. Regex syntax, dollar signs and
placeholder-looking replacement text remain literal.
With a layer name focused, Up/Down and Home/End select visible rows; hold Shift
to extend the selection. Right expands a container or selects its first child;
Left collapses it or selects its parent. Filtered paths remain expanded, and
parent/child navigation never crosses a page boundary.

Pages containing ERD tables expose a Database DDL section in the inspector.
It generates deterministic PostgreSQL, MySQL, or SQLite SQL for every table on
the current page, including primary keys, nullability, relation-derived foreign
keys, one-to-one uniqueness, safe default expressions, and named or generated
ordered composite indexes. Columns can also carry a portable computed
expression; the editor marks them with `ƒ`, keeps them mutually exclusive with
defaults and primary keys, and emits `GENERATED ALWAYS AS (...) STORED` for all
three targets after a conservative row-local expression safety check. Stable-ID
table check constraints accept portable,
single-expression SQL predicates and are omitted with a warning if they contain
unsafe syntax. PostgreSQL and MySQL foreign keys are emitted after
all tables so forward references and cycles remain executable; SQLite keeps
them inline. The panel supports copy and `.sql` download and reports incomplete
endpoints, many-to-many relations that need junction tables, duplicate names,
unsafe/custom types, defaults or generated expressions, and other review items.
Mermaid and D2 explicitly warn when generated expressions cannot be represented
instead of silently flattening them. Export is read-only
and the generated migration should be reviewed before it is applied.

## Mermaid import and export

The shared inspector exports the current page's semantic ER, UML class or
sequence layers as deterministic Mermaid source. Choose any diagram family
present on a mixed page, copy the source for Markdown/documentation, or download
an `.mmd` file. ER export includes columns, supported keys and cardinality;
class export includes members, visibility, stereotypes, multiplicities and
association kinds; sequence export preserves participant/message order,
sync/async/return arrows and activation intervals. Stable aliases keep renamed
layers and duplicate display names safe. Unsupported cross-page endpoints and
lossy composite unique indexes are surfaced as warnings rather than generating
dangling syntax. The same adapter imports `erDiagram`, `classDiagram`, and
`sequenceDiagram` files into validated, editable IR with deterministic initial
layouts and line-addressed warnings for unsupported statements. Desktop Open
and the hosted file picker accept `.mmd`/`.mermaid`. Imports are intentionally
dirty and detached, so autosave cannot replace Mermaid source with JSONL; Save
asks for a Diagra document path.

## Sequence authoring

Use Actor, Service, or Seq DB in the shared toolbar to place ordered sequence
participants on an empty page. The Edge tool creates a timeline message when
both endpoints are participants, appends it below existing messages, and grows
unlocked lifelines in the same undoable edit. Participant inspectors can add
activation bars spanning that participant's messages; activations remain
attached when the participant moves. Message labels and sync, async, or return
kinds remain editable, with return messages dashed consistently on the canvas
and in SVG, Mermaid, and D2 output. Locked participants reject message or
activation creation rather than allowing a partial edit. Drag a participant
horizontally or a message vertically to rewrite its canonical fractional order;
crossing several peers is one undo step, Escape cancels the entire reorder, and
the inspector provides Move left/right and Earlier/later buttons for precise or
keyboard-driven changes. Reorders converge through Yjs and peer-local undo
preserves concurrent semantic edits.

## Connector routing

Generic edges, database relations, and UML associations can use either straight
or orthogonal routing. Orthogonal routes choose the dominant endpoint axis by
default, or can be pinned to horizontal-first or vertical-first in the
inspector. Drag the selected connector's middle handle to reposition its
channel; the whole gesture is one undo step and Escape restores the original
bend. Routing survives JSONL and collaboration, participates in segment-aware
picking, and is shared by the canvas and SVG export. Orthogonal routes avoid
visible intervening layers by default with a 12-unit clearance; the inspector
can disable avoidance when an exact manual channel is more important. Detours
are recomputed deterministically instead of storing derived waypoints. Manual
routing supports up to 32 ordered checkpoints with direct canvas dragging,
numeric along/offset editing, insertion, removal and reordering. Double-click a
connector segment to insert a projected checkpoint directly; straight and
orthogonal routes retain their visible internal vertices when converted to a
manual route. Checkpoints use an endpoint-relative basis, so moving or copying
both endpoints carries the authored path while moving one endpoint reshapes it
predictably. Manual edits are atomic, cancellable, JSONL/Yjs portable, pickable
and exported through the same polyline geometry. Browser pointer QA remains
unfinished.

## D2 export

Every page also exposes a lazy D2 export panel for architecture documentation
and version-controlled engineering diagrams. Generic flow shapes, nested
frames/groups and connectors export alongside native D2 SQL tables, UML
classes, and sequence diagrams. Copy the source or download `.d2`; unsupported
freehand/image fidelity, dangling references, ambiguous membership, composite
indexes, and non-portable styles are reported before handoff.

# Design artboards

The shared toolbar includes Web, iPhone, Android, Tablet and Document
artboards. Select a preset and click the canvas, then edit its name and
dimensions in the inspector. Artboards support resizing, undo/redo, JSONL
persistence and SVG export. Presets are editable design dimensions.
Swap width / height changes a fixed-size artboard between portrait
and landscape while reflowing responsive and auto-layout children in one undo
step. A locked aspect ratio follows the new dimensions; direct width/height
token bindings are detached. Size limits remain enforced. Safe-area values stay
on their authored edges and can be adjusted for the landscape design. Nested
frames are supported, including absolute overlays inside auto layout. Locked,
square, hug-content and parent-controlled fill/stretch frames show why the
action is unavailable.
iPhone, Android and Tablet presets also carry their target platform and default
system-UI safe-area insets. The Artboard inspector can change the platform,
enable or disable safe areas and edit all four insets precisely. Safe boundaries
are canvas-only construction overlays shown with grids; when grid snapping is
enabled, child movement and resizing snap to them. Generated HTML exposes the insets as CSS custom
properties, and native handoff records how to map them to SwiftUI safe-area APIs
or Compose WindowInsets without hard-coding device pixels.
Frame selection wraps one or more sibling layers in a tightly fitted artboard
from the toolbar, context menu, floating selection toolbar or
Cmd/Ctrl+Alt/Option+G. Rotated geometry contributes its full oriented envelope,
the new frame stays below its contents, and existing frame/group ownership is
replaced atomically rather than duplicated. Cross-parent selections are refused.
Select an artboard by its border or title area; its interior stays available
for drawing. The Layers panel lists artboards and nested contents, supports
selection (Shift for multiple layers), collapsing and z-order controls.
Dragging, nudging, copying, duplicating or deleting a selected artboard
includes its contents and supports undo. Content belongs to the smallest
enclosing artboard below it in z-order; moving content outside releases it.
Layer Hide/Show and Lock/Unlock controls persist in JSONL and synchronize
through collaboration. Hidden artboards/groups hide descendants without
overwriting their own visibility settings. Locked layers remain visible
and exportable, but canvas picking and direct element edits are disabled;
unlock them in Layers. These are editing aids, not access permissions.
The Artboard inspector offers horizontal/vertical auto layout with gap,
padding, cross-axis alignment and fixed or hug-content dimensions. Fixed
main-axis layouts can wrap overflowing children into rows or columns with an
independent line gap; per-line alignment, distribution and stretch remain
deterministic. Fill-container children use a stable minimum basis for wrapping
and divide each line's remaining space by weight. Individual members can opt
out as absolute overlays for badges, floating controls and layered media. They
remain attached to the frame, retain parent-relative geometry and responsive
constraints, and consume no flow or hug space. Enabling layout attaches the current contents explicitly. Child
size changes reflow the stack in the same undo step; nested frames, copy and
collaboration preserve membership. “Keep contents attached” pins geometric
membership without enabling layout. Existing unpinned frames keep geometric
behavior.
Flow members and auto-layout frames can set independent minimum and maximum
widths/heights. These bounds constrain fill, stretch, hug-content and automatic
text dimensions while leaving fixed authored sizes editable. Wrapped fill uses
minimum sizes to choose stable lines, then redistributes remaining space around
capped siblings. Limits can use measurement tokens and survive components,
JSONL and collaboration; web, SwiftUI and Compose handoff emit native sizing
constraints.
Artboards can also carry up to eight canvas-only construction grids: repeating
square grids and stretch column/row grids with configurable count, gutter,
margin, color, opacity and visibility. Grid entries have stable identities so
concurrent edits to separate fields merge instead of replacing the array, and
peer-local undo preserves the other peer's edit. Grids persist in JSONL and
component/clipboard semantics but are deliberately omitted from prototype
preview, SVG and PNG export. With grid snapping enabled, translation and resize
use the artboard-relative square grid and the exact column/row band boundaries;
objects outside a gridded artboard retain the global 24-unit grid. Browser
visual QA remains unfinished.
Zoom-aware rulers run across the top and left of the canvas. Drag from either
ruler to create a persistent vertical or horizontal page guide, then drag the
guide directly or edit its axis, position, color, visibility and lock state in
the Page inspector. Guides snap movement and resizing independently of grid and
object snapping, survive JSONL and collaboration, and stay out of Layers and
artwork exports. Hold Cmd/Ctrl to bypass snapping during a gesture.
The Frame membership inspector moves a selected layer or group to an
artboard or directly onto the page. Earlier/Later controls reorder auto-layout
members. Reparenting freezes existing geometric memberships on that page,
so a detached layer stays detached even when still inside a frame's bounds.
Locked affected frames must be unlocked first. Select the whole group to
move grouped content; self-parenting and descendant cycles are rejected.
The Style inspector supports font family, arbitrary font size, weight,
italic style, line-height multiplier and letter spacing. Free text and
inline editing use these settings, and SVG preserves font attributes.
Fonts must be installed on the viewing system; exports do not embed fonts.
SVG wrapping uses deterministic width estimates rather than font shaping.
The document Typography library saves complete reusable text styles: family,
size, weight, slant, line height, tracking, horizontal alignment, decoration
and vertical alignment. Create a style from formatted text, apply it from the
library or inspector, and update it from another selection. Linked consumers
refresh atomically across pages and collaborators; locked layers defer until
unlocked. A direct typography or typography-measurement edit detaches the
composite style while preserving literal appearance. Removing a style likewise
keeps its last materialized values. Clipboard fragments detach external styles,
while component construction and page duplication preserve or remap them.
Developer handoff exposes stable per-property typography CSS variables with
literal fallbacks; web and native generation consume the materialized values.
Text notes also support overlapping inline Bold, Italic, Underline, Code, Strike and Link
marks. Select characters in the Text inspector to toggle marks, apply or remove
a link, or clear formatting. Marks use portable UTF-16 ranges, rebase when plain
text changes, persist through JSONL/undo/clipboard/collaboration and component
refresh, and render in the canvas, SVG, generated HTML, SwiftUI and Jetpack
Compose handoff. Generated HTML/SVG/native annotations allowlist safe link
protocols. The direct canvas textarea remains plain while editing, and browser
selection/rendering fidelity remains unverified.
Review comments are stored as portable, page-scoped threads rather than a
cloud-only side channel. Add a comment from the left panel to anchor it to the
selected layer, or to the visible canvas when nothing is selected. Numbered
canvas pins open a compact thread preview; the panel supports replies,
resolve/reopen and undoable deletion, including resolved-thread filtering.
Use Place on canvas to turn a drafted comment into a one-shot crosshair tool.
The next canvas click supplies its exact page-space pin while retaining the
single selected layer as contextual metadata; Escape, Cancel, or another tool
leaves the draft intact, and successful placement clears it.
Drag an open pin to refine its page-space position at any zoom. Movement uses a
local preview and commits once on release; Escape, focus loss, pointer
cancellation, camera changes, or incoming document edits discard the preview.
The configured collaboration display name is recorded as the author. Comments
round-trip through JSONL and converge through Yjs, while remaining absent from
the Layers list and SVG/web/native handoff output. Deleting a referenced layer
detaches the thread but preserves its page-space pin and discussion.
Custom color pickers set fills, strokes and text colors beyond the preset
palette. Rectangle, node and artboard corner radii persist and export to SVG;
explicitly rounded rectangles and nodes exclude transparent corners when
picking. Generic node fill/stroke/opacity now render on the canvas too.
Fillable layers also support linear, radial, angular and diamond gradients with
2–8 ordered stops, per-stop opacity, direction controls, and normalized
center/radius controls where applicable.
Gradients retain their first stop as a solid fallback, render in HTML and SVG
canvas shapes, persist through JSONL/copy/undo, export to SVG and developer
handoff CSS, synchronize between clients, and participate in component style
inheritance and override reset. Applying a solid fill or linked color replaces
the gradient; simply disabling the gradient keeps its fallback. Gradient canvas
editing exposes the renderer's aspect-aware linear axis and draggable direction
and stop handles, plus radial center, radius and stop handles. The interaction
works in rotated layer space, keeps stop ordering valid, respects inherited
locks, commits as one undo step and merges geometry fields between peers.
Stroke gradients use the same four paint models and inspector controls with
their own canvas-edit mode. Angular stops drag around a circular track; diamond
radius handles control size and direction. Native CSS conic paint and
deterministic sampled SVG patterns keep HTML layers, SVG geometry, freehand
paths, connectors, standalone export and handoff aligned. Solid fallbacks,
component refresh/reset, and concurrent geometry edits remain supported.
Image/mesh gradients and browser visual QA remain unfinished.
Stroke styling also provides butt, round and square endpoint caps plus miter,
round and bevel joins. Miter joins expose an exact limit. These values render
on canvas SVG geometry and connectors, survive JSONL/Yjs/component workflows,
export to standalone SVG, and participate in Smart Animate when both states
define them. Developer CSS retains SVG presentation properties; SwiftUI emits
an exact `StrokeStyle`, while Compose handoff reports that exact caps and joins
require a Canvas stroke instead of `BorderStroke`. Pressure-derived
variable-width freehand marks remain filled round-capped outlines, so cap/join
choices currently apply only to centerline strokes.
The Color palette above Layers stores named six-digit hex colors as portable
`design.token` resources. Add, rename, recolor and remove palette entries;
apply a swatch to the selection's fill, stroke or text color. Palette edits
support undo and JSONL persistence. Entries are visible across the document,
but belong to the page where they were created (deleting that page removes
its entries). Link applied colors is enabled by default: token edits update
bound fill/stroke/text values in the same undo step. Disable it to copy a literal
value. Direct Style inspector edits unlink only that field; Unlink controls
keep the current appearance. Token deletion preserves the last color and
detaches unlocked consumers. Locked layers defer updates and cleanup until
unlocked. Clipboard fragments retain links only when the token is included;
otherwise they keep literal colors. Same-document component creation and rebuilds
retain source token links. Component refresh inherits binding changes while
preserving local token choices or explicitly unlinked colors, even when their
literal values match. Resetting a color override restores the source binding;
variant switches retain local color overrides on matched layers. Shared palette
changes are not classified as component overrides. Color and measurement tokens
support same-kind aliases plus named per-page modes. Each mode may override with
a literal or alias; missing, deleted, wrong-kind and cyclic targets use the
token's portable Default fallback. The palette switches each page independently,
adds, renames and removes modes document-wide in one undoable edit, and blocks a
mode lifecycle edit if an affected token is locked. Browser-level interaction
remains unverified.
The Color bindings inspector shows linked token names/values, unlinked fields,
mixed selections and missing resources. Its selectors rebind or unlink editable
selected layers; locked layers are skipped. Deferred-color notices identify
layers still retaining a fallback value.
The Measurements panel stores reusable non-negative pixel values in the same
portable `design.token` resource family. Measurement bindings cover width,
height, corner radius, stroke width, font size, letter spacing, auto-layout gap
and default/per-side padding. Token edits materialize before responsive and
auto-layout planning, so linked geometry reflows in the same transaction.
Direct Style edits, inspector sizing, canvas resize, match-size and layout edits
unlink only the property being changed. Deletion and ordinary clipboard copies
retain the last literal; copied resources remap their links. Locked layers defer
refresh until unlocked. Developer handoff includes stable CSS custom properties,
linked declarations with literal fallbacks, and linked flex gap/padding rules.
Component refresh inherits changed source measurement identities, preserves
local instance bindings, and exposes them to override reset; variant switches
carry local measurement overrides across matching layers. Measurement aliases
and page modes resolve before layout, so theme/platform spacing and dimensions
reflow atomically. Browser-level interaction remains unverified.
The Layer name inspector field assigns an editor-only label to any selected
element, including shapes and groups. It appears in Layers without changing
visible text, table names, columns or other engineering semantics. Clearing it
restores the content/type label. Names persist in JSONL and duplication and
support undo; locked layers cannot be renamed.
Search layers filters the current page by layer name, visible-text/name fields
or element type while retaining ancestor context. Matching paths temporarily
expand without changing saved collapse choices. Hidden and locked layers remain
searchable. Cyclic imported group hierarchies receive a display-only root
fallback so their layers remain accessible; document references are not rewritten.
Auto-layout Distribute controls position children along the row/column: Start,
Center, End or Space between. Distribution uses spare space in fixed-size
frames and preserves the configured minimum gap. Overflow stays start-aligned;
hug-content frames have no spare space to distribute. Align independently
controls the cross axis.
Width sizing and Height sizing can independently override the default sizing
with Fixed or Hug contents. For example, use fixed width plus hug height for a
card, or hug width plus fixed height for a toolbar. Use default sizing restores
the shared setting for that axis. These controls resize frames around existing
child dimensions; automatic text measurement and fill-container children are
handled separately by text-note sizing and layout-fill rules.
Individual padding expands top/right/bottom/left overrides for auto-layout
frames. Unset sides use the shared Padding value; Use default restores that
behavior. Hug sizing includes each side separately, and alignment/distribution
operate within the resulting inner space.
Align → Stretch fills the fixed cross axis: width in vertical layouts, height
in horizontal layouts. Resizable, visible, unlocked children use the available
inner size; rotated children and children that hug that axis are skipped.
Hug-sized parent axes do not stretch. Nested rows reflow after receiving their
new size. Layout fill weight controls main-axis allocation: 0 keeps the current
size; positive weights proportionally share the space left after fixed siblings,
gaps and padding. This requires a fixed parent main axis. Locked/hidden/rotated
or nonresizable children and hug-sized child axes are not filled. Flexible
children keep at least one design pixel when content overflows. Nested layouts
reflow after allocation. Auto-sized text owns its intrinsic axes instead of
competing with stretch or fill allocation. Optional per-axis minimums and
maximums clamp all three derived sizing modes; when minimums exceed available
space, overflow is retained deterministically.

Text notes offer Fixed box, Auto width and Auto height sizing. Auto width fits
explicit lines without wrapping; Auto height wraps to the stored width and
grows vertically. Text and typography edits materialize deterministic geometry
in the same undo transaction before auto layout, so cards and mobile screens
reflow and collaborators converge. Width/height token bindings are retained only
on axes the text mode does not own. Manual numeric or canvas resizing switches
the note back to Fixed box. Measurement uses the SVG exporter’s portable average-
glyph estimate, caps derived dimensions at 1,000,000 design units and cannot
match every installed font’s shaping exactly.
Collaborative documents reconcile linked colors and auto-layout geometry after remote merges and
on attachment. Derived repairs are synchronized separately from user undo
history. Simultaneous parent-width and padding edits are covered by two-client
tests, including repair settling and undo isolation; live cloud behavior and
broader concurrent layout combinations still require verification. A concurrent
token-edit/new-binding regression verifies the merged color value and source
token undo without removing the peer's binding.
Developer handoff can copy the full palette as CSS custom properties or emit
linked layer declarations using `var()` with literal fallbacks. Variable names
encode stable token IDs; Design JSON maps them to human-readable palette names.
The original literal CSS export remains available. Palette and measurement
handoff identify the current page mode and retain Default values, active aliases,
all named-mode definitions and broken-link state while emitting effective CSS.
Palette CSS can differ from locked layers awaiting a token refresh.
SVG selection export expands selected artboards and groups recursively, so
component contents are included without selecting every child. Overlapping
selections are deduplicated; hidden descendants and unrelated page content are
omitted, and existing clipping applies. Selecting exactly one artboard and
choosing Export SVG produces its exact designed dimensions, clips overflow and
omits the root editor title, without adding the canvas background or padding.
Hidden or rotated roots are rejected. Ancestor clipping still applies for
nested artboards. Page and multi-selection exports retain padded content bounds.
Unrotated Bézier paths use curve extrema for SVG content bounds, excluding unused
endpoint handles. Existing control-point mapping and selection/resize frames
remain unchanged by default to preserve saved designs. Fit frame to curve in
the stroke inspector explicitly adopts tight selection/resize bounds without
moving page-space anchors or handles. The change supports undo and JSONL;
subsequent point edits and open/close changes preserve that mode. Auto-layout
parents may reflow after the frame changes. These are centerline bounds, not
full stroked-outline measurements; rotated path bounds remain approximate.
The inspector offers Download PNG for a whole page, selected layer, group or multi-selection
at 0.5×, 0.75×, 1×, 1.5×, 2×, 3× or 4×. Single artboards use their exact exported
envelope by default; the scope selector can use selected artwork or the whole
page instead. Page/selection export supports 0–256 units of padding; all scopes
offer transparency or a solid background color without editing artwork. Raster dimensions
come from the SVG viewport, including rotated artboards, rather than layout bounds.
It renders a captured SVG snapshot through the browser and requests a download,
without changing the document. Allocations are limited to 8192 pixels per side
and 32 megapixels; use a lower scale or SVG for larger assets. Installed fonts
and browser image decoding can affect results. Browser/Tauri PNG rendering and
download behavior have not yet been runtime-verified.
PNG decoding and encoding each time out after 15 seconds. Cancel PNG export or
switch pages to stop waiting and release export resources. Document reloads
also cancel pending work. Changing or clearing selection does not retarget an
already captured export. These
deadlines cannot interrupt synchronous browser work such as drawing to canvas.
Artboards can become components using Create component in the inspector.
Create instance copies the complete design with a source reference. Reset
from component replaces instance contents from the source while keeping
its position; Detach instance removes that link. Reset replaces child IDs
and does not preserve overrides. Deleting the source leaves detached,
editable instances. These operations support undo and JSONL persistence.
The Components library above Layers searches definitions across all pages
by name or page. Insert adds an instance to the current page near the visible
canvas corner; Go to source opens the definition's page and selects it.
To prototype a flow, connect a shape or frame to a destination frame using
Edge, then enable Prototype navigation in the edge inspector. Mark an
artboard as Prototype starting screen and open Preview in the toolbar.
Links can navigate on click/tap, hover, primary-pointer press or after a
100–60,000 ms delay. Interactive hotspots remain keyboard-operable. If a
screen has multiple delayed links, the shortest delay wins; equal delays use
stable link-ID order. Changing screens or closing Preview cancels its pending
timer. Back and the screen selector explore the flow.
Prototype actions can also open a destination artboard as an overlay or close
the top overlay. Overlays stack without adding screen history, can be centered,
top-left aligned or placed at manual screen-relative coordinates, and can
optionally dim the screen or close when the user clicks outside. Only the top
overlay receives hotspots and delayed routes. Back closes that overlay before
returning to a previous screen; navigation from an overlay closes the stack.
Overlay content supports the same component-state interactions as screens and
runs entirely in Preview's transient editor. Connect a close control back to
its containing overlay artboard and choose Close overlay in the edge inspector.
Artboards can make Preview content scroll vertically, horizontally or on both
axes. Wheel and trackpad input is clamped to visible content beyond the
artboard, including rotated geometry; horizontal-only prototypes also accept a
vertical mouse wheel. Pointer and touch dragging uses a movement threshold,
accounts for Preview zoom, and suppresses the following hotspot click once a
drag becomes scrolling. A focusable viewport supports Arrow, Page Up/Down,
Home and End keys; covered base screens leave the tab order while an overlay is
open. Enable Fix position when prototype scrolls on a top-level layer or group
to pin that visual root, its descendants and its hotspots to the viewport. Base
screens and nested overlays keep independent transient offsets, which reset on
navigation or when authored content changes.
Preview does not edit the design. Hidden layers do not create hotspots, and
deleting a destination removes its links through the normal reference rules.
Preview also renders ordinary connectors, ERD relationships and UML
associations whose two endpoints belong to the screen. Hidden endpoints and
cross-screen connectors are omitted; prototype navigation edges remain
invisible hotspots. Connector notation, labels and styles use the shared
canvas renderer.
Frame membership also provides per-axis resize constraints: Start, End,
Center, Stretch and Scale. Setting a constraint attaches the frame's members
explicitly; resizing an outer frame updates constrained nested frames in
the same undo step. Auto layout takes precedence for its direct children.
Frame position changes from the inspector carry nested content too;
explicit child moves within the same batch are preserved without double
translation. Derived layout geometry is followed by another constraint pass.
The Artboard inspector can turn the selected screen into a responsive Web,
iPhone, Android, Tablet or Document copy. The complete hierarchy is cloned
beside the source, shared color/number/typography tokens remain linked, and the
new dimensions run through constraints and auto layout. Creation, reflow and
selection are one undoable operation and one collaboration transaction, making
side-by-side breakpoint design practical without rebuilding each screen.
Each copy retains a portable source link and field baselines. Refresh inherited
content pulls source text, rich-text marks, paint, typography and token-link
changes while retaining target geometry and mobile-specific overrides. The
link can be detached without changing the rendered design; deleting the source
also detaches surviving viewports safely. Update responsive structure adds and
removes source layers while reusing surviving IDs, retaining breakpoint
geometry and local layers, and reflowing new layers through constraints or
auto layout. Field overrides can be restored individually from Source
overrides. Refresh and structure reconciliation each form one undoable,
collaborative transaction.
The Image toolbar button embeds PNG, JPEG, WebP or GIF assets (up to 1 MiB
each). The same formats can be dragged directly onto the canvas, with up to
16 files decoded before one atomic insertion. Multi-image drops begin at the
exact pointer location in page coordinates, retain aspect ratio within a
480-pixel edge and flow into deterministic rows. A failed file or a document
or page switch aborts the whole drop instead of leaving a partial import.
Resize images on the canvas. Use Replace image in the inspector to update a
screenshot or mockup while
retaining its layer identity, position, dimensions, rotation, styling,
description and normalized crop. Replacement is undoable and refuses a deleted,
locked or concurrently replaced target.
Pending imports and replacements also abort after reloading the same document
or switching pages and returning, so delayed decoding cannot apply a stale edit.
Edit the image's description and Contain/Cover/Stretch behavior in the inspector.
Crop mode provides direct,
rotation-aware corner trimming; exact normalized percentages and Reset crop
remain available in the inspector. Crops are non-destructive, compose across
repeated trims, synchronize field-by-field and render identically in the canvas
and clipped SVG exports. Assets remain inside JSONL and SVG exports; opening a
design never fetches remote image URLs. Large asset libraries and live
drag-and-drop browser QA are pending.
The asset validator checks decoded byte size, canonical base64 and matching
file signatures; the browser performs full image decoding during import.
Draw creates freehand annotations as editable strokes. Select and resize a
stroke, change its stroke color/width, or export it to SVG. Pressure-bearing
solid strokes derive a smoothed variable-width outline: mid-pressure retains the
configured width, lighter/heavier input tapers it, and open paths receive round
caps. The live preview, committed canvas, pressure-aware picking, visual export
bounds, SVG output and Smart Animate stroke-color host share that geometry;
only raw points are serialized and collaborated. Unpressured and dashed paths
retain uniform centerline rendering. Escape, focus loss, pointer cancellation,
tool changes, and document or camera updates discard unfinished strokes. This
includes incoming collaborative edits; the gesture must be restarted after an
update. Advanced velocity smoothing and pointer-device runtime QA remain.
Selected strokes expose anchor coordinates, point insertion/removal and a
Closed path switch in the inspector. Edits preserve untouched page-space
anchors after resizing and remain undoable. Closed paths support fill picking
and SVG closure. Anchor editing currently excludes rotated strokes. Incoming/outgoing
control coordinates can be enabled and edited per anchor in the inspector;
segments use cubic curves when controls are present. Curves persist in JSONL,
export as SVG cubics and use adaptive subdivision for picking. Bounds currently
use the conservative control-point hull, not tight curve extrema. Choose Anchors in the toolbar
and select a nonrotated stroke to drag individual points directly. The orange
preview commits once on release; Escape, focus loss, pointer cancellation,
document/camera/selection changes or leaving the tool discard it. Numeric
anchor controls remain available for keyboard editing. Dense-stroke performance
and live pointer-device behavior remain unverified.
In Anchors mode, purple handles and guide lines expose existing Bézier controls
for direct dragging. Each control moves independently of the anchor and opposite
control, using the same preview, cancellation and single-step undo behavior.
Insert point after subdivides an existing cubic segment without changing its
shape (including a closed path's closing segment). After the final anchor of
an open path, it instead extends the stroke. Point removal can change geometry.
The inspector's Developer handoff section provides copyable CSS declarations
and design JSON for any selected layer, including locked layers. Selecting an
artboard additionally exposes generated HTML, complete literal or token-linked
CSS, and a semantic manifest. Generation recursively preserves frame/group DOM
order, emits flexbox for nested auto layout and parent-relative positioning
elsewhere, escapes untrusted labels, sizes gradient backgrounds, reproduces
normalized image crops, and maps common geometric shapes to CSS outlines.
Hidden content is excluded. Connector geometry stays out of HTML but its full
semantic payload remains in the manifest. The same artboard traversal also
generates SwiftUI and Jetpack Compose starting points, including native stacks,
parent-relative placement, typography, gradients, normalized image crops and
an asset-catalog list. A responsive-family handoff follows transitive responsive
source links, sorts unique artboard widths, emits every designer-authored DOM
branch, and switches branches with deterministic mobile-first media queries.
Its manifest retains each breakpoint's platform, width and complete semantic
manifest; duplicate widths and invalid artboards are reported rather than
silently flattened. Adaptive SwiftUI and Jetpack Compose outputs reuse that
family resolution, generate collision-free view symbols per artboard, and add
GeometryReader/BoxWithConstraints dispatchers that select the authored layout
from the available container width. Their manifest includes all breakpoint
symbols, assets, notes and nested semantics. Diamond gradients, rotated Compose
sweep gradients, layer
effects and exact engineering/vector geometry require platform-specific
finishing. The outputs are deterministic implementation starting points;
runtime browser fidelity still needs application work. If
clipboard access is unavailable, select and copy the read-only output manually.
Any selected layer can also carry a portable accessibility role, label, hint,
value, decorative state, disabled state and heading level. These annotations
validate and serialize independently of visible styling, merge by field between
collaborators, appear in interactive prototype DOM, and map to escaped HTML
ARIA, SwiftUI accessibility modifiers and Jetpack Compose semantics. Full
metadata remains in handoff manifests when a native platform has no exact role.
The same inspector runs a read-only accessibility audit over a selected
artboard and links its first findings back to the affected layers. Developer
handoff can copy the complete machine-readable report. It checks missing names,
decorative/interactive conflicts, heading order, duplicate landmarks,
platform-specific target size and solid-color WCAG text contrast; uncertain
gradient, translucent and inherited host colors are left unguessed.
Prototype hotspots now inherit explicit accessibility labels and link roles
from their source layers while preserving explicit interaction labels. Their
keyboard order follows the recursive artboard hierarchy rather than connector
creation order. Disabled or decorative sources render disabled hotspot controls
and cannot fire pointer, keyboard or automatic delayed actions.
The shared property Inspector is loaded on demand in both hosted and desktop
shells, keeping its shape editors, accessibility audit and developer generators
out of initial application JavaScript while preserving the same fallback panel
and public component API.
Artboards can enable Clip contents to hide overflow beyond their rectangular
bounds. Nested clips intersect, including grouped descendants. Canvas drawing,
picking, marquee selection, snapping, prototype hotspots and SVG export use
the clip while preserving editable geometry. Enabling clipping pins current
members; attach additional layers through Parent artboard in the inspector.
Selection handles remain visible outside the clip to allow editing overflow.
Rounded frame boundaries and live UI verification remain unfinished.
Groups can designate one member as a layer mask. Rectangles, ellipses,
diamonds, triangles, hexagons, parallelograms and ordinary box layers provide
deterministic convex mask geometry, including rotation and intersection with
nested frame or group clips. The mask source remains selectable in Layers but
does not paint or receive pointer hits. Canvas picking/rendering, prototype
content and hotspots, SVG, HTML/CSS, SwiftUI and Jetpack Compose handoff all
consume the shared polygon. Mask roles validate, serialize, remap on paste,
detach safely on deletion, undo and converge through collaboration. Concave
and decorative masks, alpha/luminance image masks and live browser visual QA
remain unfinished.
Rectangles, nodes, frames and images can switch from one corner radius to four
independent top-left, top-right, bottom-right and bottom-left values. Oversized
values use CSS-compatible proportional normalization, so rendered geometry and
picking agree. Rounded frame clips and rounded rectangle masks now use the same
sampled convex boundary instead of falling back to a square. Canvas HTML/SVG,
standalone SVG (including clipped raster images), CSS handoff, SwiftUI and
Jetpack Compose preserve the corners. Values validate, serialize, undo, inherit
through component overrides and merge per corner in collaboration. The uniform
radius and each independent corner can bind separately to number tokens,
including aliases and page modes. Direct edits detach only the changed corner;
component override reset restores source links, and linked CSS emits one safe
variable with a literal fallback per corner. Independent-corner Smart Animate
normalizes uniform and asymmetric endpoints to four values. HTML-backed layers
animate CSS radii, while SVG rectangles morph compatible rounded paths alongside
position, scale, rotation and paint. Browser/native pixel QA remains unfinished.
Layers support Normal plus fifteen portable blend modes: Multiply, Screen,
Overlay, Darken, Lighten, Color dodge/burn, Hard/Soft light, Difference,
Exclusion, Hue, Saturation, Color and Luminosity. The inspector writes one
undoable style field; canvas and prototype compositing, SVG, HTML/CSS, SwiftUI
and Jetpack Compose handoff preserve it. Blend modes serialize canonically,
inherit through components with override/reset behavior, and merge alongside
independent style changes in collaboration. The Yjs representation retains an
empty internal style map so even simultaneous first-time style edits converge
field by field without adding empty styles to saved IR. Groups now expose
pass-through or isolated Normal/blend compositing plus group opacity. Canvas and
prototype render ordered descendants inside one compositing boundary, and SVG
and generated web/native output retain the same hierarchy; recursive rendering
also terminates safely for malformed cyclic imports. Native runtime pixel parity
and browser visual QA remain unfinished.
Style controls include an ordered stack of up to eight drop-shadow and layer-
blur effects. Each entry can be enabled, disabled, reordered or removed;
shadows expose X/Y offsets, Gaussian blur, color and opacity. Effect stacks
persist in JSONL, support undo and component overrides, converge through
collaboration, and appear in canvas/preview rendering, SVG exports and developer
handoff CSS. Export bounds compose three blur standard deviations per enabled
stage and honor frame clipping; effects remain decorative and do not enlarge
picking geometry. Older single-shadow documents remain readable and migrate on
their first inspector edit. Inset shadows, spread, background blur, exact
rotated-effect bounds and browser visual parity remain unfinished.
New or reset instances also offer Refresh text, styles and geometry. It compares
each field with the last source snapshot, updates inherited values, and
preserves custom overrides and child IDs. Descendant positions are tracked
relative to the component root, so moving an instance never becomes an
override. Refresh is undoable and keeps its tracking through JSONL and
collaboration. It does not add/remove source layers, layout rules, or
engineering semantic rows. Existing auto layout may reflow after edits.
Legacy instances need a full Reset once to establish tracking. Locked contents
or invalid tracking reject refresh without a partial update.
Select an instance, responsive copy or one of their tracked layers to inspect
Source overrides.
Each customized text/style/geometry field shows its current and source values with an
individual Reset control. This restores the latest source value, preserves
other overrides and keeps future source refreshes working. Resets are undoable;
locked layers remain inspectable but cannot be reset.
Update structure adopts the source's layer membership, geometry and semantic
structure. Surviving tracked source layers keep their instance IDs and explicit
text/style/geometry overrides, even without variant layer keys. New source layers are
added and removed source layers are removed. Locally added layers are retained
under their surviving parent, or attached to the instance root if their source
parent disappears. This is one undoable operation. Full Reset remains available
to discard all overrides and recreate children.
Component definitions can share a Variant family and carry names such as
Default, Hover and Disabled. The library searches these labels across pages;
instances offer a variant selector for their source family. Give corresponding
source layers the same Component / motion key in Frame membership. Switching reuses
unique, same-type keyed layers, preserving their IDs and explicit
text/style/geometry overrides; the new variant supplies unmodified fields. The
root position and its text/style overrides are also retained. Unkeyed, unmatched,
or changed-type layers are replaced. Duplicate keys reject the switch. A
definition can additionally declare up to sixteen named properties such as
`State=Hover`, `Size=Large`, and `Platform=Android`. Instances expose one
selector per property and retain the other axes while switching only to an
existing unambiguous combination. Stable property IDs allow concurrent edits
to separate name/value fields to merge with peer-local undo. The library shows
and searches the complete property combination. The whole operation is
undoable; preview state transitions are described below.
Tracked instances can opt into Automatically refresh component. Local source
edits and derived instance updates share one undo transaction, and the result
synchronizes through collaboration. Inherited text/style/geometry fields update
incrementally; source additions, removals, reparenting and ordering trigger an
ID-reusing structure reconciliation that retains local layers and explicit
overrides. Nested dependencies update in order. Locked contents, malformed
tracking, ambiguous reuse and cyclic dependencies pause refresh atomically.
Runtime browser verification remains unfinished.

Insert UI block in the toolbar creates editable button, text-input, card and
navigation component presets on the current page. They use ordinary frames,
text layers, auto layout and stable layer keys, so they work with the component
library, overrides and variants. These are drawn design elements, not functional
form widgets. Show artboard title can hide a frame's visible name without
removing its library/layer name. Preset visual QA remains pending.

Prototype preview defaults to Fit screen and also offers 50%, 100% and 200%
zoom. Screen contents and hotspots scale together without changing document
geometry. Fit adapts to the preview viewport; larger fixed-zoom screens scroll.
Prototype links can use instant, fade, slide-from-right, slide-from-left or
Smart animate destination transitions with a configurable duration up to five
seconds. Smart animate matches same-type layers whose Component / motion key is
unique on both screens, then interpolates their screen-relative position and
size, shortest-path rotation, layer opacity and ordered effect filter; new and
ambiguous layers fade to their stored destination opacity. Layer opacity now
lives on the shared wrapper, so interface, image and engineering layers animate
once without double-applying alpha. Matched layers also interpolate mutually
defined solid fill, stroke color/width, corner radius, text color, font size,
weight, line height and letter spacing on their actual box, SVG and text paint
hosts. Matching linear or radial fill/stroke gradients with the same stop count
animate their geometry, stop positions, colors and opacity on HTML and inline
SVG paint hosts. Font family/style, text alignment and decoration switch as
discrete typography values. Missing values are not guessed; incompatible,
angular and diamond gradients remain intact at their destination value rather
than being flattened for animation. Source-only layers and connectors
render in a clipped, pointer-inert overlay between the destination background
and destination content, then fade out and are removed at the bounded animation
deadline. A subsequent navigation cancels the overlay with the other keyframes.
Starting a new navigation cancels the previous animation, and reduced-motion
preferences disable motion while preserving navigation.
Live viewport and hotspot alignment verification remains pending.
Hotspots preserve their source layer's rotation and center, with ancestor
clipping applied in page space. Fully off-screen links are excluded. Ellipses,
primitive polygons, cylinders, rounded rectangles and closed freehand paths now
emit local outline polygons for the actual pointer region; keyboard activation
remains available. Open strokes and group hotspots retain rectangular regions.
Prototype interactions can navigate to another artboard or Change component
variant when an edge starts at an instance root and targets a compatible variant
definition. Preview runs the change through a transient editor, so the authored
document and undo history stay untouched. Click/tap and keyboard activation
toggle the state; hover restores it on pointer leave, press restores it on
release/cancel, and after-delay changes once per screen visit. Configured
fade/slide transitions animate the instance, while Smart animate compares the
screen before and after the variant switch using reused IDs and unique motion
keys. The preview runtime is lazy-loaded. Browser pointer/timing verification
remains pending.

Point and marquee selection respect stored rotation and visible primitive
outlines, including triangles, hexagons, stars and cylinders, while preserving
freehand/path hit regions and page-space frame clipping. SVG export includes
rotated box envelopes and shadow offsets before clipping; explicit artboard
exports retain their fixed viewport.
Geometry offers degree-based rotation for individual shapes, text, images,
strokes and database/class boxes, with rotated selection outlines and undo.
Multiple compatible selected layers expose one shared rotation handle and
orbit their common visual envelope without requiring a persistent group. Shift
snaps the gesture to 15-degree increments; nested selections are reduced to
their owning container, and implicit frame ownership freezes before movement.
The same shared envelope exposes eight resize handles: layer centers and local
dimensions scale from a stable gesture snapshot, Shift preserves the envelope
aspect ratio, and Alt/Option scales about its center. Rotated layers retain
their orientation, groups scale their resizable descendants, and frames keep
their auto-layout and responsive-constraint behavior.
Ordinary resizable layers also expose a persistent Lock aspect ratio control in
Geometry. The stored width-to-height proportion applies without holding Shift
to canvas and numeric resizing, non-uniform multi-selection scaling,
responsive constraints, and auto layout. A layout's main axis drives the
coupled size, cross-axis stretch yields to the lock, and authored min/max limits
bound both dimensions without distorting the ratio. Row-derived engineering
layers and text with an automatically owned axis do not expose the control.
Groups and frames rotate as a unit from the canvas handle or numeric inspector:
member centers orbit the container center, each supported leaf advances its own
orientation, nested frame/group state advances without double-transforming
leaves, and connectors remain attached to their transformed endpoints. Legacy
geometric frame membership freezes explicitly in the same undoable operation.
Rotated rectangular and rounded frame clips remain exact in page space, and
artboard SVG assets use the rotated envelope. Auto-layout and responsive
constraints continue operating in the rotated frame's local axes, including
gap, alignment, distribution, hug, stretch and fill sizing. Cycles, inherited
locks, missing geometry and
unsupported container contents reject atomically; container rotation also
converges through Yjs with peer-local undo. Rotated frames retain all eight
local-axis resize handles. Rotated database/class boxes expose local east/west
handles because semantic rows own their height; Shift does not couple the
derived height, while Alt resizes width from center. Other leaf layers preserve
aspect ratio with Shift and resize from center with Alt. Page-axis snapping is
disabled during rotated resizing. Resize cursors follow the rotated handle axis
using the nearest native 45-degree direction. Connection handles and target
hover outlines rotate with the layer; creation/reconnection uses rotated shape
hit regions after frame clipping.
Inline text editors follow layer rotation around the owning layer center;
double-click row detection in rotated database/class boxes uses local coordinates.
Connectors now meet stored endpoint outlines in canvas, preview, hit geometry,
SVG and raster capture. Ellipses use analytic intersections; diamonds,
triangles, hexagons, parallelograms and stars use their rendered polygon;
rounded rectangles use normalized corner geometry; and freehand paths use the
same deterministic Bézier flattening as picking. Rotation is resolved in local
coordinates and transformed back to page space. Stroke-width offsets remain a
centerline approximation.
Fit page and fit selection use visible rotated extents, expand selected
containers, respect frame clipping and ignore hidden layers. Layout dimensions
remain unrotated; visible locked layers still contribute to camera fitting.
Text-note selections offer Top/Middle/Bottom vertical alignment, persisted with
styles and reflected in SVG and CSS handoff. Overflow falls back to the top.
Inline editing adjusts alignment from measured wrapped content on input and
layer changes. Browser typography, composition and caret behavior still need QA.
Typography also supports underline, strikethrough or both, including inline
editing, SVG export and CSS handoff. Reset typography clears the decoration.
Developer handoff also offers separate flex CSS for explicit auto-layout
frames: direction, padding, gap, axis sizing, alignment, distribution and child
fill weights. Design JSON lists the required visible child order. Generated
artboard code consumes these rules automatically and recursively traverses
non-layout frames and groups. Reachable nested auto-layout frames retain stable,
isolated classes mapped in Design JSON.
Exported flex-grow factors are normalized without changing their ratios or
stored design weights, including fractional weights totaling less than one.
The Anchors tool edits rotated freehand/Bézier paths directly in page space.
Bounding-box rebasing preserves the rotation and untouched anchor/control
positions. Rotated paths also support fitting their frame to the curve and
closing/reopening without shifting existing anchors or controls. Numeric
anchor/control editing and insertion/removal use page coordinates for both
rotated and unrotated paths; browser pointer verification remains pending.
Collaborative undo restores a layer's previous literal color when undoing a
new token binding after a concurrent palette update, without adding a separate
repair undo entry. Repeated redo/undo and intervening manual color edits have
in-memory regression coverage; live-server verification remains pending.
The circular handle above a selected leaf rotates it directly; hold Shift for
15-degree snapping. A drag is one undo step; Escape or pointer cancellation
discards it. Marquee selection tests oriented layer bounds after frame clipping,
including group members, instead of the empty corners of their envelopes.
