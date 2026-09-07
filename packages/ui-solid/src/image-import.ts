import type { Editor, Vec } from "@diagra/core";
import {
  isRasterDataUrl,
  MAX_IMAGE_BYTES,
  type ImageSemantic,
} from "@diagra/ir";

export const MAX_RASTER_IMPORT_FILES = 16;
export const RASTER_IMPORT_MAX_EDGE = 480;
export const RASTER_IMPORT_GAP = 24;
export const RASTER_IMPORT_ROW_WIDTH = 1200;

export interface DecodedRasterAsset {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export interface RasterAssetPlacement extends DecodedRasterAsset {
  readonly x: number;
  readonly y: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
}

function displaySize(asset: DecodedRasterAsset): {
  readonly width: number;
  readonly height: number;
} {
  if (
    !Number.isFinite(asset.width) ||
    !Number.isFinite(asset.height) ||
    asset.width <= 0 ||
    asset.height <= 0
  )
    throw new Error("Image has no valid dimensions.");
  const scale = Math.min(
    1,
    RASTER_IMPORT_MAX_EDGE / Math.max(asset.width, asset.height),
  );
  return { width: asset.width * scale, height: asset.height * scale };
}

/** Deterministic rows anchored at the chosen page point. */
export function rasterAssetPlacements(
  assets: readonly DecodedRasterAsset[],
  at: Vec,
): readonly RasterAssetPlacement[] {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y))
    throw new Error("Image drop point is invalid.");
  let x = at.x;
  let y = at.y;
  let rowHeight = 0;
  return assets.map((asset) => {
    const size = displaySize(asset);
    if (x > at.x && x + size.width > at.x + RASTER_IMPORT_ROW_WIDTH) {
      x = at.x;
      y += rowHeight + RASTER_IMPORT_GAP;
      rowHeight = 0;
    }
    const placement = {
      ...asset,
      x,
      y,
      displayWidth: size.width,
      displayHeight: size.height,
    };
    x += size.width + RASTER_IMPORT_GAP;
    rowHeight = Math.max(rowHeight, size.height);
    return placement;
  });
}

/** Insert all decoded assets in one document transaction and select them. */
export function insertRasterAssets(
  editor: Editor,
  assets: readonly DecodedRasterAsset[],
  at: Vec,
): readonly string[] {
  if (!assets.length) return [];
  const elements = rasterAssetPlacements(assets, at).map((asset) =>
    editor.buildElement("image.raster", {
      semantic: { src: asset.src, alt: asset.alt, fit: "contain" },
      visual: {
        x: asset.x,
        y: asset.y,
        width: asset.displayWidth,
        height: asset.displayHeight,
      },
    }),
  );
  editor.apply(
    elements.map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set(elements.map((element) => element.id));
  return elements.map((element) => element.id);
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function decodeRasterFile(file: File): Promise<DecodedRasterAsset> {
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error(`${file.name} is larger than the 1 MiB asset limit.`);
  const src = await readDataUrl(file);
  if (!isRasterDataUrl(src))
    throw new Error(`${file.name} is not a valid PNG, JPEG, WebP or GIF.`);
  const image = new Image();
  image.src = src;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight)
    throw new Error(`${file.name} has no dimensions.`);
  return {
    src,
    alt: file.name,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

/** Replace only the embedded source, retaining layout and authored metadata. */
export function replaceRasterAsset(
  editor: Editor,
  id: string,
  asset: DecodedRasterAsset,
): void {
  displaySize(asset);
  const element = editor.store.get(id);
  if (element?.type !== "image.raster")
    throw new Error("The image layer is no longer available.");
  if (editor.createShapeContext().isLocked?.(id))
    throw new Error("Unlock the image layer before replacing it.");
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: { ...(element.semantic as ImageSemantic), src: asset.src },
    },
  ]);
}

export async function replaceRasterFile(
  editor: Editor,
  id: string,
  file: File,
): Promise<void> {
  const original = editor.store.get(id);
  if (original?.type !== "image.raster")
    throw new Error("The image layer is no longer available.");
  const originalSource = (original.semantic as ImageSemantic).src;
  const guard = watchImportContext(editor, () => {
    const current = editor.store.get(id);
    return (
      current?.type === "image.raster" &&
      (current.semantic as ImageSemantic).src === originalSource
    );
  });
  try {
    const asset = await decodeRasterFile(file);
    guard.check();
    replaceRasterAsset(editor, id, asset);
  } finally {
    guard.dispose();
  }
}

/** Remember intervening changes even when the user later returns or undoes. */
function watchImportContext(editor: Editor, targetValid = () => true) {
  const meta = editor.store.getMeta();
  const pageId = editor.currentPageId;
  let invalid = false;
  const inspect = () => {
    invalid ||=
      editor.store.getMeta() !== meta ||
      editor.currentPageId !== pageId ||
      !targetValid();
  };
  const dispose = editor.subscribe(inspect);
  return {
    dispose,
    check() {
      inspect();
      if (invalid)
        throw new Error(
          "Document or image changed during import. Choose the images again.",
        );
    },
  };
}

/** Decode first, then commit atomically if the same document/page is open. */
export async function importRasterFiles(
  editor: Editor,
  files: readonly File[],
  at: Vec,
): Promise<readonly string[]> {
  if (!files.length) return [];
  if (files.length > MAX_RASTER_IMPORT_FILES)
    throw new Error(`Drop at most ${MAX_RASTER_IMPORT_FILES} images at once.`);
  const guard = watchImportContext(editor);
  try {
    const assets = await Promise.all(files.map(decodeRasterFile));
    guard.check();
    return insertRasterAssets(editor, assets, at);
  } finally {
    guard.dispose();
  }
}
