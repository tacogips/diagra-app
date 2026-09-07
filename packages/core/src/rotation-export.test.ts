import { expect, test } from "bun:test";
import { rotatedBox } from "./geometry.ts";
import { makeEditor } from "./test-helpers.ts";

test("rotated envelopes include diagonal corners and use the supplied pivot", () => {
  const box = { x: 100, y: 100, width: 200, height: 40 };
  const diagonal = rotatedBox(box, 45);
  expect(diagonal.width).toBeCloseTo(240 / Math.SQRT2);
  expect(diagonal.height).toBeCloseTo(240 / Math.SQRT2);
  expect(diagonal.x + diagonal.width / 2).toBeCloseTo(200);
  expect(diagonal.y + diagonal.height / 2).toBeCloseTo(120);
  const offset = rotatedBox({ x: 0, y: 0, width: 120, height: 40 }, 90, {
    x: 50,
    y: 20,
  });
  expect(offset.x).toBeCloseTo(30);
  expect(offset.y).toBeCloseTo(-30);
  expect(offset.width).toBeCloseTo(40);
  expect(offset.height).toBeCloseTo(120);
  expect(rotatedBox(box, 360)).toBe(box);
});

function fixture(rotation = 90) {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "rect" },
    visual: { x: 100, y: 100, width: 200, height: 40, rotation },
  });
  editor.apply([{ type: "createElement", element: shape }]);
  return { editor, shape };
}

test("page and selection SVG bounds cover rotated artwork without rewriting it", () => {
  for (const rotation of [90, -90, 450]) {
    const { editor, shape } = fixture(rotation);
    const before = editor.getSnapshot();
    expect(editor.exportPageSvg({ padding: 0 })).toContain(
      'viewBox="180 20 40 200"',
    );
    editor.selection.set([shape.id]);
    expect(editor.exportSelectionSvg({ padding: 0 })).toContain(
      'viewBox="180 20 40 200"',
    );
    expect(editor.getSnapshot()).toEqual(before);
  }
});

test("rotated shadows expand the page envelope but retain local filter bounds", () => {
  const { editor, shape } = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: shape.id,
      visual: {
        style: {
          shadow: { x: 30, y: 0, blur: 0, color: "#000000", opacity: 1 },
        },
      },
    },
  ]);
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain('viewBox="180 20 40 230"');
  expect(svg).toContain(
    'filterUnits="userSpaceOnUse" x="100" y="100" width="230" height="40"',
  );
});

test("clipping sees rotated contents even when their unrotated box is outside", () => {
  const { editor, shape } = fixture();
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Clip",
      showTitle: false,
      clipContent: true,
      memberIds: [shape.id],
    },
    visual: { x: 170, y: 0, width: 60, height: 80 },
  });
  editor.apply([{ type: "createElement", element: frame }]);
  const svg = editor.exportPageSvg({ padding: 0 });
  expect(svg).toContain(`data-id="${shape.id}"`);
  expect(svg).toContain('viewBox="170 0 60 80"');
  expect(editor.exportArtboardSvg(frame.id)).toContain('viewBox="170 0 60 80"');
});

test("connector export ignores rotation metadata consistently with canvas picking", () => {
  const editor = makeEditor();
  const a = editor.buildElement("node.generic", { visual: { x: 0, y: 0 } });
  const b = editor.buildElement("node.generic", { visual: { x: 400, y: 0 } });
  const edge = editor.buildElement("edge.generic", {
    semantic: { from: a.id, to: b.id },
    visual: { rotation: 90 },
  });
  editor.apply(
    [a, b, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(editor.exportPageSvg()).not.toContain('transform="rotate(');
});
