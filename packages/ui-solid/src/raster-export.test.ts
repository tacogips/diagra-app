import { expect, test } from "bun:test";
import { createDefaultRegistry, Editor } from "@diagra/core";
import {
  assetFileName,
  rasterDimensions,
  rasterExportSnapshot,
  svgRasterDimensions,
  rasterizeSvg,
} from "./raster-export.ts";

test("PNG density scales web and mobile artboards with integer allocations", () => {
  expect(rasterDimensions(390, 844, 3)).toEqual({ width: 1170, height: 2532 });
  expect(rasterDimensions(1440, 900, 2)).toEqual({ width: 2880, height: 1800 });
  expect(rasterDimensions(100.2, 200.4, 1)).toEqual({
    width: 101,
    height: 201,
  });
  expect(rasterDimensions(24, 24, 0.75)).toEqual({ width: 18, height: 18 });
  expect(rasterDimensions(24, 24, 1.5)).toEqual({ width: 36, height: 36 });
  expect(rasterDimensions(24, 24, 4)).toEqual({ width: 96, height: 96 });
  expect(rasterDimensions(24, 24, 0.5)).toEqual({ width: 12, height: 12 });
});

test("invalid or excessive PNG allocations fail before rendering", () => {
  for (const [width, height, scale] of [
    [0, 100, 1],
    [-1, 100, 1],
    [Number.NaN, 100, 1],
    [100, Number.POSITIVE_INFINITY, 1],
    [100, 100, 0],
    [100, 100, 5],
    [8193, 1, 1],
    [6000, 6000, 1],
  ])
    expect(() =>
      rasterDimensions(width ?? 0, height ?? 0, scale ?? 0),
    ).toThrow();
  expect(rasterDimensions(8192, 1, 1).width).toBe(8192);
  expect(rasterDimensions(8000, 4000, 1)).toEqual({
    width: 8000,
    height: 4000,
  });
});

test("PNG snapshot uses the rotated artboard viewport rather than unrotated layout bounds", () => {
  const editor = new Editor({ registry: createDefaultRegistry() });
  const id = editor.createElement("frame", {
    semantic: { name: "Mobile" },
    visual: { x: 0, y: 0, width: 120, height: 80, rotation: 90 },
  });
  const before = editor.getSnapshot();
  const snapshot = rasterExportSnapshot(editor, { artboardId: id });
  expect(editor.getBounds(id)?.width).toBe(120);
  expect(snapshot.width).toBe(80);
  expect(snapshot.height).toBe(120);
  expect(snapshot.name).toBe("Mobile");
  expect(rasterDimensions(snapshot.width, snapshot.height, 2)).toEqual({
    width: 160,
    height: 240,
  });
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.selection.size).toBe(0);
});

test("selection PNG captures grouped visible artwork without unrelated layers or mutation", () => {
  const editor = new Editor({ registry: createDefaultRegistry() });
  const visible = editor.createElement("shape.geo", {
    visual: { x: 20, y: 20, width: 24, height: 24 },
  });
  const hidden = editor.createElement("shape.geo", {
    visual: { x: 200, y: 200, hidden: true },
  });
  const group = editor.createElement("group", {
    semantic: { memberIds: [visible, hidden] },
    visual: { layerName: "Toolbar icon" },
  });
  const unrelated = editor.createElement("text.note", {
    semantic: { text: "Not exported" },
  });
  editor.selection.set([group]);
  const before = editor.getSnapshot();
  const camera = editor.camera.get();
  const snapshot = rasterExportSnapshot(editor);
  expect(snapshot.name).toBe("Toolbar icon");
  expect(snapshot.svg).toContain(`data-id="${visible}"`);
  expect(snapshot.svg).not.toContain(`data-id="${hidden}"`);
  expect(snapshot.svg).not.toContain(`data-id="${unrelated}"`);
  expect(snapshot.svg).not.toContain("Not exported");
  expect(snapshot.width).toBeGreaterThanOrEqual(24);
  expect(snapshot.width).toBeLessThan(100);
  expect(editor.getSnapshot()).toEqual(before);
  expect([...editor.selection.ids()]).toEqual([group]);
  expect(editor.camera.get()).toEqual(camera);
  editor.selection.clear();
  expect(() => rasterExportSnapshot(editor)).toThrow("visible artwork");
});

test("generated SVG viewport parsing rejects invalid sizes before browser allocation", async () => {
  expect(
    svgRasterDimensions(
      '<svg width="100" height="50" viewBox="-10 -20 100 50"></svg>',
    ),
  ).toEqual({ width: 100, height: 50 });
  for (const svg of [
    "",
    '<svg viewBox="0 0 0 20"></svg>',
    '<svg viewBox="0 0 -10 20"></svg>',
    '<svg viewBox="0 0 NaN 20"></svg>',
    '<svg viewBox="0 0 10 20 30"></svg>',
  ]) {
    expect(() => svgRasterDimensions(svg)).toThrow("viewport");
    await expect(rasterizeSvg(svg, 1)).rejects.toThrow("viewport");
  }
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    rasterizeSvg('<svg viewBox="0 0 10 20"></svg>', 1, cancelled.signal),
  ).rejects.toThrow("cancelled");
});

test("asset names cannot contain path separators or control characters", () => {
  expect(assetFileName("Mobile / Home", 2)).toBe("Mobile - Home@2x.png");
  expect(assetFileName("../bad\\name\n", 1)).toBe("-bad-name-@1x.png");
  expect(assetFileName("...", 3)).toBe("artboard@3x.png");
  expect(assetFileName("x".repeat(200), 1).length).toBe(107);
});

test("whole-page PNG includes visible unselected artwork with export-only padding and background", () => {
  const editor = new Editor({ registry: createDefaultRegistry() });
  editor.renamePage(editor.currentPageId, "Architecture overview");
  const one = editor.createElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 50 },
  });
  const two = editor.createElement("shape.geo", {
    visual: { x: 200, y: 0, width: 100, height: 50 },
  });
  const hidden = editor.createElement("shape.geo", {
    visual: { x: 1000, y: 0, hidden: true },
  });
  editor.selection.set([one]);
  const before = editor.getSnapshot();
  const plain = rasterExportSnapshot(editor, { wholePage: true });
  const padded = rasterExportSnapshot(editor, {
    wholePage: true,
    padding: 12,
    background: "#abcdef",
  });
  expect(padded.name).toBe("Architecture overview");
  expect(padded.width).toBe(plain.width + 24);
  expect(padded.height).toBe(plain.height + 24);
  expect(padded.svg).toContain(`data-id="${two}"`);
  expect(padded.svg).not.toContain(`data-id="${hidden}"`);
  expect(padded.svg).toContain('fill="#abcdef"');
  expect(plain.svg).not.toContain("#abcdef");
  expect(rasterExportSnapshot(editor).svg).not.toContain(`data-id="${two}"`);
  expect(editor.getSnapshot()).toEqual(before);
  expect([...editor.selection.ids()]).toEqual([one]);
  editor.selection.clear();
  expect(rasterExportSnapshot(editor, { wholePage: true }).svg).toBe(plain.svg);
});

test("raster background and padding settings are bounded without changing artboard size", () => {
  const editor = new Editor({ registry: createDefaultRegistry() });
  const id = editor.createElement("frame", {
    visual: { x: 0, y: 0, width: 100, height: 50 },
  });
  const before = editor.getSnapshot();
  const snapshot = rasterExportSnapshot(editor, {
    artboardId: id,
    padding: 20,
    background: "#ffffff",
  });
  expect(snapshot.width).toBe(100);
  expect(snapshot.height).toBe(50);
  for (const padding of [-1, 257, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() =>
      rasterExportSnapshot(editor, { wholePage: true, padding }),
    ).toThrow("padding");
  for (const background of [
    "red",
    "#fff",
    "url(https://example.invalid/image)",
    "#12345678",
  ])
    expect(() =>
      rasterExportSnapshot(editor, { wholePage: true, background }),
    ).toThrow("background");
  expect(editor.getSnapshot()).toEqual(before);
});
