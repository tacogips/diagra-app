import { expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import { installRasterMaskSampler } from "./raster-mask-sampler.ts";

// Browser doubles verify lifecycle and sampling math, not rendered fidelity.
function withImages(run: (images: ImageDouble[], draws: string[]) => void) {
  const saved = ["Image", "document"].map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
  }));
  const images: ImageDouble[] = [];
  const draws: string[] = [];
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: function ImageConstructor() {
      const image = new ImageDouble();
      images.push(image);
      return image;
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (image: ImageDouble) => draws.push(image.src),
          getImageData: () => ({
            data: new Uint8ClampedArray([255, 0, 0, 128]),
          }),
        }),
      }),
    },
  });
  try {
    run(images, draws);
  } finally {
    for (const { key, descriptor } of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

class ImageDouble {
  src = "";
  naturalWidth = 1;
  naturalHeight = 1;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

function fixture() {
  const editor = new Editor();
  const ids = Array.from({ length: 10 }, (_, i) =>
    editor.createElement("image.raster", {
      semantic: {
        src: `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i]).toString("base64")}`,
        alt: "Mask",
      },
      visual: { x: 0, y: 0, width: 20, height: 20 },
    }),
  );
  const sample = (index: number) =>
    editor
      .createShapeContext()
      .rasterMaskSample?.(ids[index]!, { x: 0.5, y: 0.5 });
  return { editor, sample };
}

test("shared canvases retain sampling until the final idempotent cleanup", () => {
  withImages((images) => {
    const { editor, sample } = fixture();
    const first = installRasterMaskSampler(editor);
    const second = installRasterMaskSampler(editor);
    expect(sample(0)).toBeUndefined();
    images[0]!.onload?.();
    expect(sample(0)).toEqual({ alpha: 128 / 255, luminance: 0.2126 });
    first();
    first();
    expect(sample(0)?.alpha).toBe(128 / 255);
    second();
    expect(editor.createShapeContext().rasterMaskSample).toBeUndefined();
  });
});

test("disposal cancels pending loads and ignores already queued callbacks", () => {
  withImages((images, draws) => {
    const { editor, sample } = fixture();
    const dispose = installRasterMaskSampler(editor);
    sample(0);
    const late = images[0]!.onload;
    dispose();
    expect(images[0]!.src).toBe("");
    expect(images[0]!.onload).toBeNull();
    late?.();
    expect(draws).toEqual([]);
  });
});

test("LRU eviction cancels pending images and allows retry on next use", () => {
  withImages((images, draws) => {
    const { editor, sample } = fixture();
    const dispose = installRasterMaskSampler(editor);
    try {
      sample(0);
      const late = images[0]!.onload;
      for (let i = 1; i < 9; i++) sample(i);
      expect(images[0]!.src).toBe("");
      late?.();
      expect(draws).toEqual([]);
      sample(0);
      expect(images).toHaveLength(10);
    } finally {
      dispose();
    }
  });
});

test("oversized images use geometry fallback without allocating pixel buffers", () => {
  withImages((images, draws) => {
    const { editor, sample } = fixture();
    const dispose = installRasterMaskSampler(editor);
    try {
      sample(0);
      images[0]!.naturalWidth = 10000;
      images[0]!.naturalHeight = 10000;
      images[0]!.onload?.();
      expect(draws).toEqual([]);
      expect(sample(0)).toBeUndefined();
      expect(images[0]!.src).toBe("");
    } finally {
      dispose();
    }
  });
});
