// Connector notation: which markers and label a connector is drawn with.
//
// Shared by the canvas and the SVG exporter, so the table below is the one
// place either of them can disagree with the other.

import { describe, expect, test } from "bun:test";
import { element } from "../test-helpers.ts";
import {
  connectorDecoration,
  endpointReaderFor,
  readDirectEndpoints,
  readTableEndpoints,
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
    expect(endpointReaderFor("future.edge")).toBe(readDirectEndpoints);
  });
});
