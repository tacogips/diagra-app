import { expect, test } from "bun:test";
import { overlapsVisibleElement } from "./selection-geometry.ts";
import { makeEditor } from "./test-helpers.ts";

function fixture(rotation = 90) {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    visual: { x: 100, y: 100, width: 200, height: 40, rotation },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  return { editor, shape };
}

test("marquee intersects drawn rotated bounds rather than the original rectangle", () => {
  for (const rotation of [90, -90, 450]) {
    const { editor, shape } = fixture(rotation);
    const context = editor.createShapeContext();
    expect(
      overlapsVisibleElement(
        shape,
        { x: 190, y: 30, width: 20, height: 20 },
        context,
      ),
    ).toBe(true);
    expect(
      overlapsVisibleElement(
        shape,
        { x: 110, y: 110, width: 20, height: 20 },
        context,
      ),
    ).toBe(false);
  }
});

test("diagonal envelopes do not select their empty corners", () => {
  const { editor, shape } = fixture(45);
  const context = editor.createShapeContext();
  expect(
    overlapsVisibleElement(
      shape,
      { x: 115, y: 195, width: 5, height: 5 },
      context,
    ),
  ).toBe(false);
  expect(
    overlapsVisibleElement(
      shape,
      { x: 195, y: 115, width: 10, height: 10 },
      context,
    ),
  ).toBe(true);
});

test("clips reject invisible portions but keep rotated portions outside the original box", () => {
  const { editor, shape } = fixture();
  const frame = editor.buildElement("frame", {
    semantic: { name: "Clip", clipContent: true, memberIds: [shape.id] },
    visual: { x: 170, y: 0, width: 60, height: 80 },
  });
  editor.apply([{ type: "createElement", element: frame }]);
  const context = editor.createShapeContext();
  expect(
    overlapsVisibleElement(
      shape,
      { x: 190, y: 30, width: 10, height: 10 },
      context,
    ),
  ).toBe(true);
  expect(
    overlapsVisibleElement(
      shape,
      { x: 190, y: 100, width: 10, height: 10 },
      context,
    ),
  ).toBe(false);
});

test("unrotated overlap keeps boundary contact and rejects disjoint rectangles", () => {
  const { editor, shape } = fixture(0);
  const context = editor.createShapeContext();
  expect(
    overlapsVisibleElement(
      shape,
      { x: 300, y: 110, width: 10, height: 10 },
      context,
    ),
  ).toBe(true);
  expect(
    overlapsVisibleElement(
      shape,
      { x: 301, y: 110, width: 10, height: 10 },
      context,
    ),
  ).toBe(false);
});
