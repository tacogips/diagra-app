import { expect, test } from "bun:test";
import { Editor, endpointReaderFor, resolveConnector } from "@nodetto/core";
import {
  canStraightenConnector,
  removeConnectorWaypoint,
  straightenConnectors,
} from "./connector-routing.ts";
import { getAction, runAction } from "./shortcuts.ts";

function setup() {
  const editor = new Editor();
  const from = editor.createElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const to = editor.createElement("shape.geo", {
    visual: { x: 400, y: 200, width: 100, height: 100 },
  });
  const edge = editor.connect(from, to);
  if (!edge) throw new Error("expected connector");
  editor.apply([
    {
      type: "updateSemantic",
      id: edge,
      semantic: {
        from,
        to,
        label: "Keep this label",
        routing: "manual",
        routingWaypoints: [
          { u: 0.3, v: 60 },
          { u: 0.7, v: -40 },
        ],
      },
    },
  ]);
  const route = () => {
    const element = editor.store.get(edge);
    if (!element) throw new Error("connector was deleted");
    return resolveConnector(
      element,
      editor.createShapeContext(),
      endpointReaderFor(element.type),
    );
  };
  return { editor, from, to, edge, route };
}

test("removing one bend retains neighboring vertices; the last removal produces a straight line", () => {
  const { editor, from, to, edge, route } = setup();
  const before = editor.getSnapshot();
  const undoSize = editor.history.undoSize;
  removeConnectorWaypoint(editor, edge, 0);
  expect(route()?.points).toHaveLength(3);
  expect(editor.store.get(edge)?.semantic).toMatchObject({
    from,
    to,
    label: "Keep this label",
    routingWaypoints: [{ u: 0.7, v: -40 }],
  });
  expect(editor.history.undoSize).toBe(undoSize + 1);
  removeConnectorWaypoint(editor, edge, 0);
  expect(route()?.points).toHaveLength(2);
  expect(editor.store.get(edge)?.semantic).toMatchObject({
    from,
    to,
    label: "Keep this label",
    routing: "straight",
  });
  expect(canStraightenConnector(editor, edge)).toBe(false);
  editor.undo();
  expect(route()?.points).toHaveLength(3);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.redo();
  expect(route()?.points).toHaveLength(3);
});

test("Straighten action removes an orthogonal route in one undoable edit", () => {
  const { editor, edge, route } = setup();
  editor.apply([
    {
      type: "updateSemantic",
      id: edge,
      semantic: {
        ...(editor.store.get(edge)?.semantic as Record<string, unknown>),
        routing: "orthogonal",
        routingBend: 0.7,
        routingAxis: "horizontal",
      },
    },
  ]);
  const before = editor.getSnapshot();
  editor.selection.set([edge]);
  const context = {
    editor,
    viewport: { width: 800, height: 600 },
    requestEdit: () => {},
    exportSvg: () => {},
  };
  expect(getAction("straightenConnector").enabled(context)).toBe(true);
  expect(runAction(getAction("straightenConnector"), context)).toBe(true);
  expect(route()?.points).toHaveLength(2);
  const semantic = editor.store.get(edge)?.semantic as Record<string, unknown>;
  expect(semantic["routingWaypoints"]).toBeUndefined();
  expect(semantic["routingBend"]).toBeUndefined();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("invalid points, locked connectors and viewers cannot remove bends", () => {
  const { editor, edge } = setup();
  const before = editor.getSnapshot();
  for (const index of [-1, 9, 0.5])
    removeConnectorWaypoint(editor, edge, index);
  expect(editor.getSnapshot()).toEqual(before);
  editor.apply([{ type: "updateVisual", id: edge, visual: { locked: true } }]);
  const locked = editor.getSnapshot();
  removeConnectorWaypoint(editor, edge, 0);
  straightenConnectors(editor, [edge]);
  expect(canStraightenConnector(editor, edge)).toBe(false);
  expect(editor.getSnapshot()).toEqual(locked);
  editor.undo();
  editor.setReadOnly(true);
  removeConnectorWaypoint(editor, edge, 0);
  straightenConnectors(editor, [edge]);
  expect(editor.getSnapshot()).toEqual(before);
});
