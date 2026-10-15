# Left shape palette

## Goal

Make common shapes and grouping frames discoverable in the left pane, without
opening a toolbar menu or switching to All tools. Keep the layer tree and hosted
workspace navigation available.

## Interaction and layout

- Place a Shapes section above Layers. Show a compact grid of outlined shape
  previews with text labels, selected-tool highlighting, and keyboard focus.
- Always offer rectangle, ellipse, diamond, cylinder, triangle, hexagon,
  parallelogram, star, text, node, connector, and a general frame.
- In ERD, UML class, and sequence workspaces, show the relevant semantic tools
  first. All tools includes these in a collapsible Diagram shapes section.
- Design workspaces also offer artboard presets in a collapsed section.
- Selecting a tile activates the existing canvas tool. Click the canvas to place
  a shape at its default size; resize with its handles. Existing connectors still
  connect shape endpoints. Placement returns to Select. Escape cancels the tool.
- Keep Frame selection, Group, and Ungroup visible below the shape grid, with
  enabled states from the shared action table. Frame selection wraps the current
  selection; the Frame tile places an empty, transparent general-purpose frame.
- Keep the left pane resizable and scrollable. Collapsing it hides both Shapes
  and Layers. Do not obscure the layer tree with a floating palette.

## Architecture

Add a shared ShapePalette component and a typed palette catalogue to ui-solid.
The app shell remains the owner of the active tool and action context; the
palette uses the same tool-change callback as Toolbar and Canvas. Add one
general frame creation tool, using existing frame rendering, membership, history,
and resize behavior. Do not introduce a parallel insertion or grouping model.

Define named values in a single `Tool` catalogue and derive the closed `ToolKind`
union from it. Palette entries and creation dispatch use those names, including
`Tool.Frame`. Creation dispatch is exhaustive: adding a tool requires handling
it explicitly, and typed maps cover every geometry, artboard and participant
tool without parsing strings or falling back to an unrelated tool.

Read-only documents disable every creation tile and mutating action. The action
table and editor enforce that again on execution. Tool and selection changes
update the palette through the existing Solid/editor adapter.

## Verification

Check creation through palette entries, tool reset, undo/redo, general frame
styling, and read-only behavior with interaction tests. Run lint, typecheck, app
tests, and production builds. Use the visible browser to check palette placement,
shape creation, framing, workspace switching, keyboard cancellation, and pane
collapse/resize. Publishing a desktop release is a separate operation.

Verified on 2026-10-16: app lint/typecheck, 1,713 app tests, 38 hosted-web tests,
hosted typecheck, and both production builds passed. Visible Brave checks covered
triangle placement and return to Select, grouping two layers and framing the
group, Escape cancellation from a focused tile, ERD-specific tools, resizing to
180px and back to 280px, and collapsing/restoring the pane. Interaction tests
cover placement, undo/redo and read-only rejection for every creation tile.
