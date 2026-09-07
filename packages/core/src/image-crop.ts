import type { ImageCrop } from "@diagra/ir";
import type { Box } from "./geometry.ts";

export const MIN_IMAGE_CROP = 0.01;

export function fullImageCrop(): ImageCrop {
  return { x: 0, y: 0, width: 1, height: 1 };
}

/** Compose a trim rectangle, expressed within the current visible image. */
export function composeImageCrop(
  current: ImageCrop | undefined,
  trim: ImageCrop,
): ImageCrop {
  const source = current ?? fullImageCrop();
  return {
    x: source.x + trim.x * source.width,
    y: source.y + trim.y * source.height,
    width: trim.width * source.width,
    height: trim.height * source.height,
  };
}

/** Placement of the full source image behind a fixed crop viewport. */
export function croppedImageBox(crop: ImageCrop, viewport: Box): Box {
  return {
    x: viewport.x - (crop.x / crop.width) * viewport.width,
    y: viewport.y - (crop.y / crop.height) * viewport.height,
    width: viewport.width / crop.width,
    height: viewport.height / crop.height,
  };
}

export function cropFromCorners(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  box: Box,
): ImageCrop {
  const x1 = Math.max(box.x, Math.min(box.x + box.width, start.x));
  const y1 = Math.max(box.y, Math.min(box.y + box.height, start.y));
  const x2 = Math.max(box.x, Math.min(box.x + box.width, end.x));
  const y2 = Math.max(box.y, Math.min(box.y + box.height, end.y));
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.max(MIN_IMAGE_CROP, Math.abs(x2 - x1) / box.width);
  const height = Math.max(MIN_IMAGE_CROP, Math.abs(y2 - y1) / box.height);
  return {
    x: Math.min(1 - width, (left - box.x) / box.width),
    y: Math.min(1 - height, (top - box.y) / box.height),
    width,
    height,
  };
}
