import type { Editor, RasterMaskPixel } from "@diagra/core";

type DecodedImage = {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
};

type CacheEntry = DecodedImage | "loading" | "unavailable";

function decode(cache: Map<string, CacheEntry>, src: string): void {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    cache.set(src, "unavailable");
    return;
  }
  cache.set(src, "loading");
  const image = new Image();
  image.onload = () => {
    try {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) throw new Error("Image has no decoded pixels");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D context is unavailable");
      context.drawImage(image, 0, 0);
      cache.set(src, {
        src,
        width,
        height,
        pixels: context.getImageData(0, 0, width, height).data,
      });
    } catch {
      // Cross-origin/tainted sources remain on the core's safe box fallback.
      cache.set(src, "unavailable");
    }
  };
  image.onerror = () => cache.set(src, "unavailable");
  image.src = src;
}

function pixelAt(
  decoded: DecodedImage,
  point: { readonly x: number; readonly y: number },
): RasterMaskPixel {
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)
    return { alpha: 0, luminance: 0 };
  const x = Math.min(decoded.width - 1, Math.floor(point.x * decoded.width));
  const y = Math.min(decoded.height - 1, Math.floor(point.y * decoded.height));
  const offset = (y * decoded.width + x) * 4;
  const red = decoded.pixels[offset] ?? 0;
  const green = decoded.pixels[offset + 1] ?? 0;
  const blue = decoded.pixels[offset + 2] ?? 0;
  const alpha = (decoded.pixels[offset + 3] ?? 0) / 255;
  return {
    alpha,
    luminance: (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255,
  };
}

/**
 * Decodes same-origin/data-image pixels for precise web raster-mask picking.
 * Decode failures are intentionally non-fatal: the core keeps its geometry
 * fallback, which also protects documents whose image CORS policy changes.
 */
export function installRasterMaskSampler(editor: Editor): () => void {
  const cache = new Map<string, CacheEntry>();
  const sampler = (
    id: string,
    point: { readonly x: number; readonly y: number },
  ) => {
    const element = editor.store.get(id);
    if (element?.type !== "image.raster") return undefined;
    const src = (element.semantic as { src?: unknown }).src;
    if (typeof src !== "string" || !src) return undefined;
    const entry = cache.get(src);
    if (!entry) {
      decode(cache, src);
      return undefined;
    }
    return typeof entry === "object" ? pixelAt(entry, point) : undefined;
  };
  editor.setRasterMaskSampler(sampler);
  return () => {
    cache.clear();
    editor.setRasterMaskSampler(undefined);
  };
}
