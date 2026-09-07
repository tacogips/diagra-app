import { expect, test } from "bun:test";
import { rasterStage } from "./raster-stage.ts";

test("raster stages resolve values and preserve synchronous and asynchronous errors", async () => {
  expect(await rasterStage(() => Promise.resolve("png"))).toBe("png");
  await expect(
    rasterStage(() => {
      throw new Error("decode failed");
    }),
  ).rejects.toThrow("decode failed");
  await expect(
    rasterStage(() => Promise.reject(new Error("encode failed"))),
  ).rejects.toThrow("encode failed");
  await expect(rasterStage(() => Promise.reject(null))).rejects.toBeNull();
});

test("pre-cancelled work never starts and active cancellation wins over late results", async () => {
  const stopped = new AbortController();
  stopped.abort();
  let started = false;
  await expect(
    rasterStage(() => {
      started = true;
      return Promise.resolve(1);
    }, stopped.signal),
  ).rejects.toThrow("cancelled");
  expect(started).toBe(false);
  const active = new AbortController();
  let finish: ((value: number) => void) | undefined;
  const work = rasterStage(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    active.signal,
  );
  active.abort();
  finish?.(3);
  await expect(work).rejects.toThrow("cancelled");
});

test("a stalled raster stage times out and successful stages ignore subsequent abort", async () => {
  await expect(
    rasterStage(() => new Promise(() => {}), undefined, 1),
  ).rejects.toThrow("timed out");
  const controller = new AbortController();
  const result = await rasterStage(
    () => Promise.resolve(42),
    controller.signal,
  );
  controller.abort();
  expect(result).toBe(42);
});
