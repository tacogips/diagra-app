import type { Editor, RasterMaskPixel } from "@diagra/core";

type DecodedImage = {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
};

type PendingImage = { readonly cancel: () => void };
type CacheEntry = DecodedImage | PendingImage | "unavailable";

// Bound retained RGBA buffers to 64 MiB (browser decode/canvas memory is extra).
// Oversized sources keep the core geometry fallback instead of a huge canvas.
const MAX_ENTRIES = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const installations = new WeakMap<
  Editor,
  { users: number; dispose: () => void }
>();

function decode(cache: Map<string, CacheEntry>, src: string): void {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    cache.set(src, "unavailable");
    return;
  }
  const image = new Image();
  const pending: PendingImage = {
    cancel: () => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    },
  };
  cache.set(src, pending);
  image.onload = () => {
    if (cache.get(src) !== pending) return;
    let canvas: HTMLCanvasElement | undefined;
    try {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) throw new Error("Image has no decoded pixels");
      if (width * height * 4 > MAX_IMAGE_BYTES)
        throw new Error("Image exceeds pixel picking budget");
      canvas = document.createElement("canvas");
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
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      pending.cancel();
    }
  };
  image.onerror = () => {
    if (cache.get(src) !== pending) return;
    cache.set(src, "unavailable");
    pending.cancel();
  };
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
  const existing = installations.get(editor);
  if (existing) {
    existing.users++;
    return releaseOnce(editor, existing);
  }
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
      if (cache.size >= MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          const evicted = cache.get(oldest);
          cache.delete(oldest);
          if (typeof evicted === "object" && "cancel" in evicted)
            evicted.cancel();
        }
      }
      decode(cache, src);
      return undefined;
    }
    cache.delete(src);
    cache.set(src, entry);
    return typeof entry === "object" && "pixels" in entry
      ? pixelAt(entry, point)
      : undefined;
  };
  editor.setRasterMaskSampler(sampler);
  const installation = {
    users: 1,
    dispose: () => {
      const entries = [...cache.values()];
      cache.clear();
      for (const entry of entries)
        if (typeof entry === "object" && "cancel" in entry) entry.cancel();
      if (editor.createShapeContext().rasterMaskSample === sampler)
        editor.setRasterMaskSampler(undefined);
    },
  };
  installations.set(editor, installation);
  return releaseOnce(editor, installation);
}

function releaseOnce(
  editor: Editor,
  installation: { users: number; dispose: () => void },
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--installation.users > 0) return;
    installations.delete(editor);
    installation.dispose();
  };
}
