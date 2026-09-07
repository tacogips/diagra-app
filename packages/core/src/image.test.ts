import { expect, test } from "bun:test";
import { isRasterDataUrl, MAX_IMAGE_BYTES } from "@diagra/ir";
import { makeEditor } from "./test-helpers.ts";

test("image source policy rejects external requests, SVG and oversized payloads", () => {
  expect(isRasterDataUrl("https://example.com/image.png")).toBe(false);
  expect(isRasterDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
  expect(
    isRasterDataUrl(`data:image/png;base64,${"A".repeat(MAX_IMAGE_BYTES * 2)}`),
  ).toBe(false);
  expect(
    isRasterDataUrl(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
  ).toBe(true);
});
test("embedded image resizes, exports and undoes", () => {
  const editor = makeEditor();
  const image = editor.buildElement("image.raster");
  editor.apply([{ type: "createElement", element: image }]);
  editor.resizeElement(image.id, { x: 20, y: 30, width: 200, height: 100 });
  expect(editor.getBounds(image.id)?.width).toBe(200);
  expect(editor.exportPageSvg()).toContain('href="data:image/png;base64,');
  expect(editor.exportPageSvg()).toContain(
    'preserveAspectRatio="xMidYMid meet"',
  );
  editor.undo();
  expect(editor.getBounds(image.id)?.width).toBe(320);
});

test("cropped image export clips and maps the full source consistently", () => {
  const editor = makeEditor();
  const image = editor.buildElement("image.raster", {
    semantic: {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      alt: "Crop test",
      fit: "cover",
      crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.5 },
    },
    visual: { x: 20, y: 30, width: 200, height: 100 },
  });
  editor.apply([{ type: "createElement", element: image }]);
  const svg = editor.exportPageSvg();
  expect(svg).toContain(
    '<svg x="20" y="30" width="200" height="100" overflow="hidden">',
  );
  expect(svg).toContain('x="-100" y="-20" width="400" height="200"');
  expect(svg).toContain('preserveAspectRatio="none"');
});
