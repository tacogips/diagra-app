import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@diagra/io";
import type { FrameSemantic } from "@diagra/ir";
import {
  normalizedCornerRadii,
  unevenRoundedBoxContains,
} from "./corner-radii.ts";
import { roundedBoxContains } from "./geometry.ts";
import { inspectDesign } from "./handoff.ts";
import { generateMobileInterfaceCode } from "./mobile-code.ts";
import { componentOverrides } from "./component-overrides.ts";
import { makeEditor } from "./test-helpers.ts";

test("rounded hit regions reject corners and clamp oversized radii", () => {
  const box = { x: 0, y: 0, width: 100, height: 40 };
  expect(roundedBoxContains(box, { x: 0, y: 0 }, 20)).toBe(false);
  expect(roundedBoxContains(box, { x: 20, y: 0 }, 20)).toBe(true);
  expect(roundedBoxContains(box, { x: 50, y: 20 }, 1000)).toBe(true);
  expect(roundedBoxContains(box, { x: 0, y: 0 }, 0)).toBe(true);
});

test("independent radii normalize and preserve asymmetric hit regions", () => {
  const box = { x: 0, y: 0, width: 100, height: 60 };
  const radii = {
    topLeft: 40,
    topRight: 0,
    bottomRight: 20,
    bottomLeft: 10,
  };
  expect(unevenRoundedBoxContains(box, { x: 0, y: 0 }, radii)).toBe(false);
  expect(unevenRoundedBoxContains(box, { x: 100, y: 0 }, radii)).toBe(true);
  expect(unevenRoundedBoxContains(box, { x: 100, y: 60 }, radii)).toBe(false);
  expect(
    normalizedCornerRadii(
      { width: 100, height: 60 },
      { topLeft: 80, topRight: 80, bottomRight: 80, bottomLeft: 80 },
    ),
  ).toEqual({
    topLeft: 30,
    topRight: 30,
    bottomRight: 30,
    bottomLeft: 30,
  });
});

test("independent radii persist, hand off and clip rounded frames", () => {
  const editor = makeEditor();
  const radii = {
    topLeft: 32,
    topRight: 4,
    bottomRight: 20,
    bottomLeft: 8,
  };
  const child = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Card" },
    visual: {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      style: { fill: "#123456", cornerRadii: radii },
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Screen", memberIds: [child.id], clipContent: true },
    visual: {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      style: { cornerRadii: radii },
    },
  });
  editor.apply([
    { type: "createElement", element: frame },
    { type: "createElement", element: child },
  ]);
  const saved = serializeDocument(editor.getSnapshot());
  expect(parseDocument(saved)).toEqual(editor.getSnapshot());
  expect(saved).toContain(
    '"cornerRadii":{"topLeft":32,"topRight":4,"bottomRight":20,"bottomLeft":8}',
  );
  expect(editor.hitTest({ x: 0, y: 0 })).toBeNull();
  expect(
    editor.createShapeContext().clipPolygonOf?.(child.id)?.length,
  ).toBeGreaterThan(4);
  expect(inspectDesign(editor, child.id)?.css).toContain(
    "border-radius: 32px 4px 20px 8px;",
  );
  const svg = editor.exportPageSvg();
  expect(svg).toContain('<path d="M 32 0 H 196');
  const native = generateMobileInterfaceCode(editor, frame.id);
  expect(native?.swiftUi).toContain(
    "UnevenRoundedRectangle(topLeadingRadius: 32",
  );
  expect(native?.jetpackCompose).toContain(
    "RoundedCornerShape(topStart = 32.dp, topEnd = 4.dp, bottomEnd = 20.dp, bottomStart = 8.dp)",
  );
});

test("independent corner component overrides survive refresh and reset", () => {
  const editor = makeEditor();
  const child = editor.buildElement("node.generic", {
    visual: {
      style: {
        cornerRadii: {
          topLeft: 8,
          topRight: 8,
          bottomRight: 8,
          bottomLeft: 8,
        },
      },
    },
  });
  const source = editor.buildElement("frame", {
    semantic: { name: "Card", component: true, memberIds: [child.id] },
  });
  editor.apply([
    { type: "createElement", element: source },
    { type: "createElement", element: child },
  ]);
  const instance = editor.createComponentInstance(source.id);
  if (!instance) throw new Error("missing instance");
  const target = (editor.store.get(instance)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target) throw new Error("missing target");
  editor.selection.set([target]);
  editor.setSelectionStyle({
    cornerRadii: {
      topLeft: 24,
      topRight: 8,
      bottomRight: 8,
      bottomLeft: 8,
    },
  });
  expect(
    componentOverrides(editor, target).map((item) => item.field),
  ).toContain("style.cornerRadii");
  editor.refreshComponentInstance(instance);
  expect(editor.store.get(target)?.visual.style?.cornerRadii?.topLeft).toBe(24);
  expect(
    editor.resetComponentOverride(instance, target, "style.cornerRadii"),
  ).toBe(true);
  expect(editor.store.get(target)?.visual.style?.cornerRadii?.topLeft).toBe(8);
});

test("independent image corners become a standalone SVG clip path", () => {
  const editor = makeEditor();
  const image = editor.buildElement("image.raster", {
    id: "rounded-image",
    semantic: {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      alt: "Rounded",
    },
    visual: {
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      style: {
        cornerRadii: {
          topLeft: 24,
          topRight: 4,
          bottomRight: 12,
          bottomLeft: 0,
        },
      },
    },
  });
  editor.apply([{ type: "createElement", element: image }]);
  const svg = editor.exportPageSvg();
  expect(svg).toContain("-corners");
  expect(svg).toContain('<clipPath id="diagra-gradient-');
  expect(svg).toContain('clip-path="url(#diagra-gradient-');
});

test("corner radius and custom colors persist and export for interface shapes", () => {
  for (const type of ["shape.geo", "node.generic", "frame"]) {
    const editor = makeEditor();
    const item = editor.buildElement(type, {
      visual: {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        style: {
          cornerRadius: 24,
          fill: "#123456",
          stroke: "#abcdef",
          color: "#345678",
        },
      },
    });
    editor.apply([{ type: "createElement", element: item }]);
    expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
      editor.getSnapshot(),
    );
    const svg = editor.exportPageSvg();
    expect(svg).toContain('rx="24"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('stroke="#abcdef"');
  }
});
