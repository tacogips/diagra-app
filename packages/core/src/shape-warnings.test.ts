import { expect, test } from "bun:test";
import type { Element } from "@nodetto/ir";
import { shapeAuthoringWarnings } from "./shape-warnings.ts";
import { element } from "./test-helpers.ts";

const make = (id: string, type: string, semantic: unknown, page = "p") =>
  element({ id, type, semantic, page });
function warnings(shape: Element, others: readonly Element[] = []) {
  const byId = new Map(
    [shape, ...others].map((element) => [element.id, element]),
  );
  return shapeAuthoringWarnings(shape, { resolve: (id) => byId.get(id) });
}

test("missing and incompatible connector ends are visible without throwing", () => {
  const note = make("n", "text.note", { text: "" });
  expect(
    warnings(
      make("e", "uml.association", {
        from: "missing",
        to: "n",
        kind: "association",
      }),
      [note],
    ),
  ).toEqual(
    expect.arrayContaining([
      "Source endpoint is missing.",
      "Target endpoint must connect to a UML class.",
    ]),
  );
  expect(
    warnings(
      make("m", "sequence.message", {
        from: "n",
        to: "n",
        kind: "sync",
        order: "a1",
      }),
      [note],
    ).length,
  ).toBe(2);
});

test("ERD table columns and indexes flag duplicate names and missing index columns", () => {
  const table = make("t", "erd.table", {
    tableName: "t",
    columns: [
      { id: "a", name: "id", dataType: "int" },
      { id: "b", name: "id", dataType: "int" },
    ],
    indexes: [{ id: "idx", name: "by_id", columns: ["missing"] }],
  });
  expect(warnings(table)).toEqual([
    "Duplicate column name: id.",
    "Index by_id needs existing columns.",
  ]);
});

test("UML duplicate attributes warn while overloaded methods remain valid", () => {
  expect(
    warnings(
      make("c", "uml.class", {
        name: "C",
        attributes: [
          { id: "a", name: "id" },
          { id: "b", name: "id" },
        ],
        methods: [
          { id: "m1", name: "get", parameters: [{ name: "id", type: "int" }] },
          {
            id: "m2",
            name: "get",
            parameters: [{ name: "id", type: "string" }],
          },
        ],
      }),
    ),
  ).toEqual(["Duplicate attribute name: id."]);
});

test("component owners, instances and responsive sources are checked", () => {
  const note = make("n", "text.note", { text: "" });
  expect(
    warnings(
      make("port", "uml.port", {
        name: "p",
        owner: "n",
        side: "left",
        offset: 0.5,
      }),
      [note],
    ),
  ).toContain("Port owner has an incompatible shape type.");
  expect(
    warnings(make("f", "frame", { name: "f", instanceOf: "n" }), [note]),
  ).toContain("Component source has an incompatible shape type.");
  expect(
    warnings(make("f", "frame", { name: "f", responsiveSource: "f" })),
  ).toContain("Responsive source cannot be the frame itself.");
  const component = make(
    "def",
    "frame",
    { name: "def", component: true },
    "library",
  );
  expect(
    warnings(make("f", "frame", { name: "f", instanceOf: "def" }), [component]),
  ).toEqual([]);
});

test("sequence activations, images and prototype targets report incomplete settings", () => {
  const participant = make("p", "sequence.participant", {
    name: "p",
    kind: "actor",
    order: "a1",
  });
  expect(
    warnings(
      make("a", "sequence.activation", {
        participant: "p",
        fromOrder: "a2",
        toOrder: "a1",
      }),
      [participant],
    ),
  ).toEqual(["Activation must end after it starts."]);
  expect(warnings(make("i", "image.raster", { src: "", alt: "" }))).toEqual([
    "Image source is not assigned.",
  ]);
  expect(
    warnings(
      make("e", "edge.generic", { from: "p", to: "p", prototype: true }),
      [participant],
    ),
  ).toContain("Prototype target must be an artboard or component frame.");
});

test("BPMN boundary hosts reuse notation type requirements", () => {
  const note = make("n", "text.note", { text: "" });
  expect(
    warnings(make("b", "bpmn.boundaryEvent", { attachedTo: "n" }), [note]),
  ).toContain("Boundary event host has an incompatible shape type.");
});

test("fixed warnings clear immediately with new references and do not mutate elements", () => {
  const edge = make("e", "uml.association", {
    from: "a",
    to: "b",
    kind: "association",
  });
  const before = JSON.stringify(edge);
  expect(warnings(edge).length).toBe(2);
  expect(
    warnings(edge, [
      make("a", "uml.class", { name: "A", attributes: [], methods: [] }),
      make("b", "uml.class", { name: "B", attributes: [], methods: [] }),
    ]),
  ).toEqual([]);
  expect(JSON.stringify(edge)).toBe(before);
});
