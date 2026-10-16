# UML component mode

Choose **UML component** in **Mode**. The left palette exposes Component,
Provided interface (ball), Required interface (socket), Port, Dependency,
Realization, and Connector, followed by Text and Frame. Common geometry remains
available under More shapes. All tools also includes these tools.

Select a component or interface tool and click the canvas. Select Port and click
inside a component near the desired boundary; clicking elsewhere keeps the tool
active without creating an orphan. A port snaps to its component boundary and
follows its owner when it moves, resizes, or rotates. Drag a port to reposition it
along that boundary, or edit its side and percentage position in the inspector.

Drag Dependency, Realization, or Connector between components, interfaces, or
ports. Dependency uses a dashed open arrow, realization a dashed hollow triangle,
and a connector a plain line. The inspector edits relationship kind, label, and
shared connector routing. The common Connector tool also chooses a component
relationship automatically when both endpoints are component-diagram elements.
Class diagrams continue to use class associations.

The inspector edits names and provided/required interface kinds. Double-click
names to edit them on canvas. Interfaces can be rotated to orient their socket.
Interface and port labels remain visible in SVG export, including export bounds.

## Data and operations

- `uml.component`, `uml.interface`, `uml.port`, and
  `uml.component-relationship` are registered semantic types with named typed
  catalogues. No class-association payload is reused.
- A port stores its owner ID, boundary side, and normalized offset. Coordinates
  are derived in the same undo transaction as owner transforms. A relationship
  stores endpoint IDs and a closed connector/dependency/realization kind.
- JSONL round-trips these types canonically. SVG renders their notation.
- Copying or duplicating a component includes its ports and remaps owner IDs.
  Copy/cut of a port without its owner is refused, as with connectors missing
  their endpoints. Select the component to copy its ports.
- Deleting a component deletes its ports and their incident relationships;
  undo restores the complete set. Read-only documents cannot author these tools.

## Scope

This is diagram notation and authoring, not a UML metamodel validator. Interfaces
are standalone symbols connected to components/ports; they do not own operation
lists or automatically attach to a component boundary. Only ports have automatic
boundary ownership. Assembly/delegation distinctions and UML interchange formats
are not modeled. Mermaid and D2 do not gain component-specific import/export in
this change; use native JSONL or SVG to preserve this notation.

## Verification

Regression coverage includes all relationship decorations, native JSONL golden
files, SVG, palette placement, typed connector gestures, port ownership and
reanchoring, owner move/resize/rotation, combined owner/port movement, undo/redo,
copy/paste/duplicate owner remapping, refusal of orphan port copies, cascading
deletes, read-only checks, and invalid semantic values.

The full suite passes 1,735 tests (10,630 assertions), with lint, TypeScript
checking, and desktop production build passing. Manual Brave preview smoke checks
confirmed Component placement, mid-boundary Port placement without selection-handle
interception, readable active-tool labels, provided Interface placement, dashed
Dependency creation, and attached-port movement/rerouting when dragging a component.
