// Connector notation: which markers and label a connector is drawn with.
//
// Shared by the canvas and the SVG exporter, so the table below is the one
// place either of them can disagree with the other.

import { describe, expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import { element } from "../test-helpers.ts";
import { makeEditor } from "../test-helpers.ts";
import {
  connectorDefaultDash,
  connectorDecoration,
  connectorWaypointFromPage,
  connectorWaypointToPage,
  connectorWaypointsWithInsertion,
  endpointReaderFor,
  readDirectEndpoints,
  readTableEndpoints,
  resolveConnector,
} from "./connector.ts";

function decorate(type: string, semantic: unknown) {
  return connectorDecoration(element({ id: "c", type, semantic }));
}

describe("connectorDecoration", () => {
  test("an erd relation is dotted at both ends and shows its cardinality", () => {
    expect(
      decorate("erd.relation", {
        from: { table: "a" },
        to: { table: "b" },
        cardinality: "1:*",
      }),
    ).toEqual({ start: "dot", end: "dot", label: "1:*" });
  });

  test("an erd relation's own label wins over the cardinality", () => {
    expect(
      decorate("erd.relation", { cardinality: "1:*", label: "places" }),
    ).toEqual({ start: "dot", end: "dot", label: "places" });
  });

  test("uml association kinds pick their classic notation", () => {
    expect(
      decorate("uml.association", { from: "a", to: "b", kind: "inherit" }),
    ).toEqual({ start: null, end: "triangle", label: "" });
    expect(
      decorate("uml.association", {
        from: "a",
        to: "b",
        kind: "aggregate",
        label: "has",
      }),
    ).toEqual({ start: "diamondOpen", end: null, label: "has" });
    expect(
      decorate("uml.association", { from: "a", to: "b", kind: "compose" }),
    ).toEqual({ start: "diamondFilled", end: null, label: "" });
    expect(
      decorate("uml.association", {
        from: "a",
        to: "b",
        kind: "associate",
        label: "uses",
      }),
    ).toEqual({ start: null, end: null, label: "uses" });
  });

  test("a generic edge defaults to a plain arrow at the far end", () => {
    expect(decorate("edge.generic", { from: "a", to: "b" })).toEqual({
      start: null,
      end: "arrow",
      label: "",
    });
    expect(
      decorate("edge.generic", {
        from: "a",
        to: "b",
        label: "calls",
        arrowheads: { start: "dot", end: "triangle" },
      }),
    ).toEqual({ start: "dot", end: "triangle", label: "calls" });
  });

  test("a sequence message uses its label and message arrow", () => {
    const message = element({
      id: "c",
      type: "sequence.message",
      semantic: {
        from: "a",
        to: "b",
        kind: "return",
        label: "Done",
      },
    });
    expect(connectorDecoration(message)).toEqual({
      start: null,
      end: "arrow",
      label: "Done",
    });
    expect(connectorDefaultDash(message)).toBe("6 4");
    expect(
      connectorDefaultDash(
        element({
          id: "sync",
          type: "sequence.message",
          semantic: { from: "a", to: "b", kind: "sync" },
        }),
      ),
    ).toBeUndefined();
  });

  test("an explicit `none` arrowhead draws nothing", () => {
    expect(
      decorate("edge.generic", {
        from: "a",
        to: "b",
        arrowheads: { end: "none" },
      }),
    ).toEqual({ start: null, end: null, label: "" });
  });

  test("a payload that is not an object still decorates", () => {
    expect(decorate("edge.generic", null)).toEqual({
      start: null,
      end: "arrow",
      label: "",
    });
  });
});

describe("endpointReaderFor", () => {
  test("only erd relations read their tables through an endpoint object", () => {
    expect(endpointReaderFor("erd.relation")).toBe(readTableEndpoints);
    expect(endpointReaderFor("edge.generic")).toBe(readDirectEndpoints);
    expect(endpointReaderFor("uml.association")).toBe(readDirectEndpoints);
    expect(endpointReaderFor("sequence.message")).toBe(readDirectEndpoints);
    expect(endpointReaderFor("future.edge")).toBe(readDirectEndpoints);
  });
});

describe("ERD row anchoring", () => {
  test("simple and composite relations attach to their selected row centers", () => {
    const editor = makeEditor();
    const from = editor.buildElement("erd.table", {
      id: "from-table",
      semantic: {
        tableName: "invoices",
        columns: [
          { id: "tenant", name: "tenant_id", dataType: "uuid" },
          { id: "number", name: "number", dataType: "text" },
          { id: "account", name: "account_id", dataType: "uuid" },
        ],
      },
      visual: { x: 0, y: 0, width: 240 },
    });
    const to = editor.buildElement("erd.table", {
      id: "to-table",
      semantic: {
        tableName: "accounts",
        columns: [
          { id: "name", name: "name", dataType: "text" },
          { id: "tenant", name: "tenant_id", dataType: "uuid", pk: true },
          { id: "id", name: "id", dataType: "uuid", pk: true },
        ],
      },
      visual: { x: 400, y: 100, width: 240 },
    });
    const relation = editor.buildElement("erd.relation", {
      id: "owner",
      semantic: {
        from: { table: from.id, columns: ["tenant", "account"] },
        to: { table: to.id, columns: ["tenant", "id"] },
        cardinality: "*:1",
      },
    });
    editor.apply(
      [from, to, relation].map((element) => ({
        type: "createElement" as const,
        element,
      })),
    );

    const resolved = resolveConnector(
      relation,
      editor.createShapeContext(),
      readTableEndpoints,
    );
    expect(resolved?.start).toEqual({ x: 240, y: 68 });
    expect(resolved?.end).toEqual({ x: 400, y: 180 });

    editor.apply([
      {
        type: "updateSemantic",
        id: from.id,
        semantic: {
          ...(from.semantic as Record<string, unknown>),
          columns: [
            { id: "tenant", name: "tenant_id", dataType: "uuid" },
            { id: "account", name: "account_id", dataType: "uuid" },
            { id: "number", name: "number", dataType: "text" },
          ],
        },
      },
    ]);
    expect(
      resolveConnector(
        relation,
        editor.createShapeContext(),
        readTableEndpoints,
      )?.start,
    ).toEqual({ x: 240, y: 56 });
  });

  test("whole-table endpoints retain center anchoring", () => {
    const editor = makeEditor();
    const from = editor.buildElement("erd.table", {
      id: "from-table",
      semantic: {
        tableName: "left",
        columns: [{ id: "a", name: "a", dataType: "text" }],
      },
      visual: { x: 0, y: 0, width: 240 },
    });
    const to = editor.buildElement("erd.table", {
      id: "to-table",
      semantic: {
        tableName: "right",
        columns: [{ id: "b", name: "b", dataType: "text" }],
      },
      visual: { x: 400, y: 100, width: 240 },
    });
    const relation = editor.buildElement("erd.relation", {
      semantic: {
        from: { table: from.id },
        to: { table: to.id },
        cardinality: "1:*",
      },
    });
    editor.apply(
      [from, to, relation].map((element) => ({
        type: "createElement" as const,
        element,
      })),
    );
    const resolved = resolveConnector(
      relation,
      editor.createShapeContext(),
      readTableEndpoints,
    );
    expect(resolved?.start).toEqual({ x: 240, y: 28 });
    expect(resolved?.end).toEqual({ x: 400, y: 128 });
  });
});

describe("orthogonal routing", () => {
  test("auto routing uses the dominant axis, a movable channel and route picking", () => {
    const editor = makeEditor();
    const from = editor.buildElement("node.generic", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const to = editor.buildElement("node.generic", {
      visual: { x: 300, y: 200, width: 100, height: 100 },
    });
    const edge = editor.buildElement("edge.generic", {
      semantic: {
        from: from.id,
        to: to.id,
        routing: "orthogonal",
        routingBend: 0.25,
      },
      visual: { style: { fill: "#ff0000" } },
    });
    editor.apply(
      [from, to, edge].map((element) => ({
        type: "createElement" as const,
        element,
      })),
    );
    const resolved = resolveConnector(
      edge,
      editor.createShapeContext(),
      readDirectEndpoints,
    );
    expect(resolved?.points).toEqual([
      { x: 100, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 250 },
      { x: 300, y: 250 },
    ]);
    expect(resolved?.labelPoint).toEqual({ x: 150, y: 200 });
    expect(editor.hitTest({ x: 150, y: 150 })).toBe(edge.id);
    expect(editor.exportPageSvg()).toContain(
      'points="100,50 150,50 150,250 300,250"',
    );
    expect(editor.exportPageSvg()).toMatch(/<polyline[^>]*fill="none"/);
    expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
      editor.getSnapshot(),
    );
  });

  test("vertical routing attaches to top and bottom ports", () => {
    const editor = makeEditor();
    const from = editor.buildElement("node.generic", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const to = editor.buildElement("node.generic", {
      visual: { x: 200, y: 300, width: 100, height: 100 },
    });
    const edge = editor.buildElement("edge.generic", {
      semantic: {
        from: from.id,
        to: to.id,
        routing: "orthogonal",
        routingAxis: "vertical",
      },
    });
    editor.apply(
      [from, to, edge].map((element) => ({
        type: "createElement" as const,
        element,
      })),
    );
    expect(
      resolveConnector(edge, editor.createShapeContext(), readDirectEndpoints)
        ?.points,
    ).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: 300 },
    ]);
  });

  test("automatically clears visible intervening layers and supports opt-out", () => {
    const editor = makeEditor();
    const from = editor.buildElement("node.generic", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const obstacle = editor.buildElement("node.generic", {
      visual: { x: 180, y: 80, width: 40, height: 140 },
    });
    const to = editor.buildElement("node.generic", {
      visual: { x: 300, y: 200, width: 100, height: 100 },
    });
    const edge = editor.buildElement("edge.generic", {
      semantic: { from: from.id, to: to.id, routing: "orthogonal" },
    });
    editor.apply(
      [from, obstacle, to, edge].map((element) => ({
        type: "createElement" as const,
        element,
      })),
    );
    const routed = resolveConnector(
      edge,
      editor.createShapeContext(),
      readDirectEndpoints,
    );
    expect(routed?.points).toEqual([
      { x: 100, y: 50 },
      { x: 232, y: 50 },
      { x: 232, y: 250 },
      { x: 300, y: 250 },
    ]);

    editor.apply([
      {
        type: "updateVisual",
        id: obstacle.id,
        visual: { hidden: true },
      },
    ]);
    expect(
      resolveConnector(edge, editor.createShapeContext(), readDirectEndpoints)
        ?.points,
    ).toEqual([
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 250 },
      { x: 300, y: 250 },
    ]);
    editor.undo();

    editor.apply([
      {
        type: "updateSemantic",
        id: edge.id,
        semantic: {
          from: from.id,
          to: to.id,
          routing: "orthogonal",
          routingAvoidObstacles: false,
        },
      },
    ]);
    expect(
      resolveConnector(
        editor.store.get(edge.id)!,
        editor.createShapeContext(),
        readDirectEndpoints,
      )?.points,
    ).toEqual([
      { x: 100, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 250 },
      { x: 300, y: 250 },
    ]);
    expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
      editor.getSnapshot(),
    );
  });
});

describe("manual connector waypoints", () => {
  test("endpoint-relative coordinates round-trip and move with both endpoints", () => {
    const from = { x: 50, y: 50 };
    const to = { x: 350, y: 250 };
    const point = { x: 180, y: 140 };
    const waypoint = connectorWaypointFromPage(point, from, to);
    expect(connectorWaypointToPage(waypoint, from, to).x).toBeCloseTo(point.x);
    expect(connectorWaypointToPage(waypoint, from, to).y).toBeCloseTo(point.y);
    const moved = connectorWaypointToPage(
      waypoint,
      { x: from.x + 100, y: from.y + 40 },
      { x: to.x + 100, y: to.y + 40 },
    );
    expect(moved.x).toBeCloseTo(point.x + 100, 2);
    expect(moved.y).toBeCloseTo(point.y + 40, 2);
  });

  test("manual routes drive shared geometry, picking, SVG and persistence", () => {
    const editor = makeEditor();
    const from = editor.buildElement("node.generic", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const to = editor.buildElement("node.generic", {
      visual: { x: 300, y: 200, width: 100, height: 100 },
    });
    const edge = editor.buildElement("edge.generic", {
      semantic: {
        from: from.id,
        to: to.id,
        routing: "manual",
        routingWaypoints: [
          { u: 0.25, v: 80 },
          { u: 0.75, v: -50 },
        ],
      },
    });
    editor.apply(
      [from, to, edge].map((element) => ({
        type: "createElement" as const,
        element,
      })),
    );
    const resolved = resolveConnector(
      edge,
      editor.createShapeContext(),
      readDirectEndpoints,
    );
    expect(resolved?.waypointPoints).toHaveLength(2);
    expect(resolved?.points).toHaveLength(4);
    const waypoint = resolved?.waypointPoints?.[0];
    if (!waypoint) throw new Error("expected waypoint");
    expect(editor.hitTest(waypoint)).toBe(edge.id);
    expect(editor.exportPageSvg()).toContain("<polyline");
    expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
      editor.getSnapshot(),
    );
  });

  test("route insertion projects onto the nearest segment in document order", () => {
    const editor = makeEditor();
    const from = editor.buildElement("node.generic", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const to = editor.buildElement("node.generic", {
      visual: { x: 300, y: 0, width: 100, height: 100 },
    });
    const edge = editor.buildElement("edge.generic", {
      semantic: {
        from: from.id,
        to: to.id,
        routing: "manual",
        routingWaypoints: [
          { u: 0.25, v: 100 },
          { u: 0.75, v: 100 },
        ],
      },
    });
    editor.apply(
      [from, to, edge].map((element) => ({
        type: "createElement" as const,
        element,
      })),
    );
    const resolved = resolveConnector(
      edge,
      editor.createShapeContext(),
      readDirectEndpoints,
    );
    if (!resolved) throw new Error("expected route");
    const inserted = connectorWaypointsWithInsertion(
      resolved,
      { x: 200, y: 106 },
      true,
    );
    expect(inserted).toHaveLength(3);
    expect(
      inserted?.map((waypoint) =>
        connectorWaypointToPage(waypoint, { x: 50, y: 50 }, { x: 350, y: 50 }),
      ),
    ).toEqual([
      { x: 125, y: 150 },
      { x: 200, y: 150 },
      { x: 275, y: 150 },
    ]);
  });

  test("route insertion refuses to exceed the portable waypoint limit", () => {
    expect(
      connectorWaypointsWithInsertion(
        {
          start: { x: 0, y: 0 },
          end: { x: 100, y: 0 },
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          labelPoint: { x: 50, y: 0 },
          waypointPoints: Array.from({ length: 32 }, (_, index) => ({
            x: index + 1,
            y: 10,
          })),
          fromBox: { x: -10, y: -10, width: 20, height: 20 },
          toBox: { x: 90, y: -10, width: 20, height: 20 },
        },
        { x: 50, y: 10 },
        true,
      ),
    ).toBeNull();
  });
});
