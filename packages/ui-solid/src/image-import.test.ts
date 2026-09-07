import { expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import {
  insertRasterAssets,
  importRasterFiles,
  rasterAssetPlacements,
  replaceRasterAsset,
  replaceRasterFile,
  type DecodedRasterAsset,
} from "./image-import.ts";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Pause browser decoding without timers; restore globals even on failure. */
async function withPendingDecode(run: (finish: () => void) => Promise<void>) {
  const reader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  const image = Object.getOwnPropertyDescriptor(globalThis, "Image");
  let finish = () => {};
  const decoded = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: class {
      result = GIF;
      onload?: () => void;
      readAsDataURL() {
        this.onload?.();
      }
    },
  });
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class {
      src = "";
      naturalWidth = 1;
      naturalHeight = 1;
      decode() {
        return decoded;
      }
    },
  });
  try {
    await run(finish);
  } finally {
    if (reader) Object.defineProperty(globalThis, "FileReader", reader);
    else Reflect.deleteProperty(globalThis, "FileReader");
    if (image) Object.defineProperty(globalThis, "Image", image);
    else Reflect.deleteProperty(globalThis, "Image");
  }
}

test("pending import rejects reloading the same document identity", async () => {
  await withPendingDecode(async (finish) => {
    const editor = new Editor();
    const pending = importRasterFiles(
      editor,
      [new File(["image"], "image.gif")],
      { x: 0, y: 0 },
    );
    editor.loadDocument(editor.getSnapshot());
    finish();
    await expect(pending).rejects.toThrow("Document or image changed");
    expect(editor.store.listElements()).toHaveLength(0);
  });
});

test("pending import rejects switching away and returning to the original page", async () => {
  await withPendingDecode(async (finish) => {
    const editor = new Editor();
    const originalPage = editor.currentPageId;
    const otherPage = editor.createPage();
    editor.setCurrentPage(originalPage);
    const pending = importRasterFiles(
      editor,
      [new File(["image"], "image.gif")],
      { x: 0, y: 0 },
    );
    editor.setCurrentPage(otherPage);
    editor.setCurrentPage(originalPage);
    finish();
    await expect(pending).rejects.toThrow("Document or image changed");
    expect(editor.store.listElements()).toHaveLength(0);
  });
});

test("pending replacement preserves intervening description edits", async () => {
  await withPendingDecode(async (finish) => {
    const editor = new Editor();
    const id = editor.createElement("image.raster", {
      semantic: { src: PNG, alt: "Before" },
    });
    const pending = replaceRasterFile(
      editor,
      id,
      new File(["image"], "image.gif"),
    );
    editor.apply([
      {
        type: "updateSemantic",
        id,
        semantic: { src: PNG, alt: "Edited while decoding" },
      },
    ]);
    finish();
    await pending;
    expect(editor.store.get(id)?.semantic).toEqual({
      src: GIF,
      alt: "Edited while decoding",
    });
    editor.undo();
    expect(editor.store.get(id)?.semantic).toEqual({
      src: PNG,
      alt: "Edited while decoding",
    });
  });
});

test("pending replacement rejects a source edit even after undo", async () => {
  await withPendingDecode(async (finish) => {
    const editor = new Editor();
    const id = editor.createElement("image.raster", {
      semantic: { src: PNG, alt: "Before" },
    });
    const pending = replaceRasterFile(
      editor,
      id,
      new File(["image"], "image.gif"),
    );
    replaceRasterAsset(editor, id, {
      src: GIF,
      alt: "new.gif",
      width: 1,
      height: 1,
    });
    editor.undo();
    finish();
    await expect(pending).rejects.toThrow("Document or image changed");
    expect(editor.store.get(id)?.semantic).toEqual({ src: PNG, alt: "Before" });
  });
});

test("image replacement preserves authored layout and crop and undoes in one step", () => {
  const editor = new Editor();
  const id = editor.createElement("image.raster", {
    semantic: {
      src: PNG,
      alt: "Checkout screen",
      fit: "cover",
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
    },
    visual: {
      x: 120,
      y: 60,
      width: 300,
      height: 500,
      rotation: 15,
      style: { opacity: 0.8 },
    },
  });
  editor.selection.set([id]);
  const before = editor.store.get(id);
  if (!before) throw new Error("Missing image fixture");
  replaceRasterAsset(editor, id, {
    src: GIF,
    alt: "new.gif",
    width: 1,
    height: 1,
  });
  expect(editor.store.get(id)).toEqual({
    ...before,
    semantic: { ...(before?.semantic as object), src: GIF },
  });
  expect([...editor.selection.ids()]).toEqual([id]);
  expect(editor.undo()).toBe(true);
  expect(editor.store.get(id)).toEqual(before);
});

test("replacement rejects invalid sources, locked layers and deleted targets", () => {
  const editor = new Editor();
  const id = editor.createElement("image.raster", {
    semantic: { src: PNG, alt: "Screenshot" },
  });
  const before = editor.getSnapshot();
  expect(() =>
    replaceRasterAsset(editor, id, {
      src: "https://example.com/image.png",
      alt: "remote",
      width: 1,
      height: 1,
    }),
  ).toThrow();
  expect(editor.getSnapshot()).toEqual(before);
  editor.apply([{ type: "updateVisual", id, visual: { locked: true } }]);
  expect(() =>
    replaceRasterAsset(editor, id, {
      src: GIF,
      alt: "new.gif",
      width: 1,
      height: 1,
    }),
  ).toThrow("Unlock the image layer");
  expect(() => replaceRasterAsset(editor, "missing", asset("new.png"))).toThrow(
    "The image layer is no longer available.",
  );
});

function asset(name: string, width = 960, height = 960): DecodedRasterAsset {
  return { src: PNG, alt: name, width, height };
}

test("raster assets scale down and wrap into deterministic rows", () => {
  const placements = rasterAssetPlacements(
    [asset("one.png"), asset("two.png"), asset("three.png")],
    { x: 100, y: 200 },
  );

  expect(
    placements.map(({ x, y, displayWidth, displayHeight }) => ({
      x,
      y,
      displayWidth,
      displayHeight,
    })),
  ).toEqual([
    { x: 100, y: 200, displayWidth: 480, displayHeight: 480 },
    { x: 604, y: 200, displayWidth: 480, displayHeight: 480 },
    { x: 100, y: 704, displayWidth: 480, displayHeight: 480 },
  ]);
});

test("raster assets insert and select as one undoable transaction", () => {
  const editor = new Editor();
  const ids = insertRasterAssets(
    editor,
    [asset("wide.png", 800, 400), asset("small.png", 120, 80)],
    { x: 25, y: 50 },
  );

  expect(ids).toHaveLength(2);
  expect([...editor.selection.ids()]).toEqual([...ids]);
  expect(
    editor.store.listElements().map((element) => ({
      type: element.type,
      semantic: element.semantic,
      visual: element.visual,
    })),
  ).toMatchObject([
    {
      type: "image.raster",
      semantic: { src: PNG, alt: "wide.png", fit: "contain" },
      visual: { x: 25, y: 50, width: 480, height: 240 },
    },
    {
      type: "image.raster",
      semantic: { src: PNG, alt: "small.png", fit: "contain" },
      visual: { x: 529, y: 50, width: 120, height: 80 },
    },
  ]);
  expect(editor.undo()).toBe(true);
  expect(editor.store.listElements()).toHaveLength(0);
});

test("invalid decoded geometry is rejected before document mutation", () => {
  const editor = new Editor();

  expect(() =>
    insertRasterAssets(editor, [asset("invalid.png", Number.NaN, 20)], {
      x: 0,
      y: 0,
    }),
  ).toThrow("Image has no valid dimensions.");
  expect(() =>
    insertRasterAssets(editor, [asset("valid.png")], {
      x: Number.POSITIVE_INFINITY,
      y: 0,
    }),
  ).toThrow("Image drop point is invalid.");
  expect(editor.store.listElements()).toHaveLength(0);
});
