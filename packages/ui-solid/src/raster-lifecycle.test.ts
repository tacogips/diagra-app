import { expect, test } from "bun:test";
import { rasterizeSvg } from "./raster-export.ts";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 10 80 120"></svg>';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Browser API doubles test orchestration only, not pixels or browser behavior. */
async function withRenderer(
  run: (state: {
    image: { src: string; decode: () => Promise<void> };
    canvas: {
      width: number;
      height: number;
      getContext: () => object | null;
      toBlob: (callback: (blob: Blob | null) => void, mime: string) => void;
    };
    context: { drawImage: (...args: unknown[]) => void };
    drawn: unknown[][];
    revoked: string[];
    png: Blob;
    failUrl: () => void;
  }) => Promise<void>,
) {
  const saved = [
    [globalThis, "Image"],
    [globalThis, "document"],
    [URL, "createObjectURL"],
    [URL, "revokeObjectURL"],
  ].map(([target, key]) => ({
    target: target as object,
    key: key as string,
    descriptor: Object.getOwnPropertyDescriptor(target, key as string),
  }));
  const image = { src: "", decode: () => Promise.resolve() };
  const drawn: unknown[][] = [];
  const revoked: string[] = [];
  const png = new Blob(["fake encoded data"], { type: "image/png" });
  const context = {
    drawImage: (...args: unknown[]) => {
      drawn.push(args);
    },
  };
  const canvas = {
    width: 300,
    height: 150,
    getContext: (): object | null => context,
    toBlob: (callback: (blob: Blob | null) => void, mime: string) => {
      expect(mime).toBe("image/png");
      callback(png);
    },
  };
  const set = (target: object, key: string, value: unknown) =>
    Object.defineProperty(target, key, { configurable: true, value });
  set(globalThis, "Image", function ImageDouble() {
    return image;
  });
  set(globalThis, "document", {
    createElement: (tag: string) => {
      expect(tag).toBe("canvas");
      return canvas;
    },
  });
  set(URL, "createObjectURL", () => "blob:export-test");
  set(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  try {
    await run({
      image,
      canvas,
      context,
      drawn,
      revoked,
      png,
      failUrl: () =>
        set(URL, "createObjectURL", () => {
          throw new Error("URL failed");
        }),
    });
  } finally {
    for (const { target, key, descriptor } of saved) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  }
}

test("PNG lifecycle draws the captured viewport at density and releases browser resources", async () => {
  await withRenderer(async ({ image, canvas, drawn, revoked, png }) => {
    expect(await rasterizeSvg(SVG, 2)).toBe(png);
    expect(drawn).toEqual([[image, 0, 0, 160, 240]]);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(image.src).toBe("");
    expect(revoked).toEqual(["blob:export-test"]);
  });
});

test("PNG lifecycle cleans up URL, decode, context, draw and encode failures", async () => {
  for (const stage of [
    "url",
    "decode",
    "context",
    "draw",
    "encode",
    "empty",
  ] as const) {
    await withRenderer(async ({ image, canvas, context, revoked, failUrl }) => {
      if (stage === "url") failUrl();
      if (stage === "decode")
        image.decode = () => Promise.reject(new Error("Decode failed"));
      if (stage === "context") canvas.getContext = () => null;
      if (stage === "draw")
        context.drawImage = () => {
          throw new Error("Draw failed");
        };
      if (stage === "encode")
        canvas.toBlob = () => {
          throw new Error("Encode failed");
        };
      if (stage === "empty") canvas.toBlob = (callback) => callback(null);
      await expect(rasterizeSvg(SVG, 1)).rejects.toThrow();
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
      expect(image.src).toBe("");
      expect(revoked).toEqual(stage === "url" ? [] : ["blob:export-test"]);
    });
  }
});

test("cancelling PNG decoding releases resources and ignores a late decode", async () => {
  await withRenderer(async ({ image, canvas, drawn, revoked }) => {
    const decode = deferred<void>();
    image.decode = () => decode.promise;
    const controller = new AbortController();
    const result = rasterizeSvg(SVG, 1, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow("cancelled");
    decode.resolve();
    await Promise.resolve();
    expect(drawn).toEqual([]);
    expect(canvas.width).toBe(0);
    expect(image.src).toBe("");
    expect(revoked).toEqual(["blob:export-test"]);
  });
});

test("cancellation after decode settles prevents the synchronous drawing stage", async () => {
  await withRenderer(async ({ image, drawn }) => {
    const decode = deferred<void>();
    image.decode = () => decode.promise;
    const controller = new AbortController();
    const result = rasterizeSvg(SVG, 1, controller.signal);
    decode.resolve();
    queueMicrotask(() => controller.abort());
    await expect(result).rejects.toThrow("cancelled");
    expect(drawn).toEqual([]);
  });
});

test("cancellation at encoding completion suppresses the blob and cleans up", async () => {
  await withRenderer(async ({ canvas, image, revoked, png }) => {
    const ready = deferred<(blob: Blob | null) => void>();
    canvas.toBlob = (callback) => ready.resolve(callback);
    const controller = new AbortController();
    const result = rasterizeSvg(SVG, 1, controller.signal);
    const finish = await ready.promise;
    finish(png);
    queueMicrotask(() => controller.abort());
    await expect(result).rejects.toThrow("cancelled");
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(image.src).toBe("");
    expect(revoked).toEqual(["blob:export-test"]);
  });
});
