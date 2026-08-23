import { describe, expect, test } from "bun:test";
import { Camera, clampZoom, MAX_ZOOM, MIN_ZOOM } from "./camera.ts";

function expectClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9);
}

describe("clampZoom", () => {
  test("holds the documented range", () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  test("falls back to 1 for a non-finite zoom", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("projection", () => {
  test("screen = (page + camera) * zoom", () => {
    const camera = new Camera({ x: 10, y: 20, z: 2 });
    expect(camera.pageToScreen({ x: 5, y: 5 })).toEqual({ x: 30, y: 50 });
  });

  test("round-trips page -> screen -> page at several zooms", () => {
    for (const z of [0.1, 0.35, 1, 2.5, 8]) {
      const camera = new Camera({ x: -13.5, y: 42, z });
      const page = { x: 123.25, y: -87.5 };
      const back = camera.screenToPage(camera.pageToScreen(page));
      expectClose(back.x, page.x);
      expectClose(back.y, page.y);
    }
  });
});

describe("panBy", () => {
  test("moves the content by the screen delta at any zoom", () => {
    const camera = new Camera({ x: 0, y: 0, z: 4 });
    const before = camera.pageToScreen({ x: 0, y: 0 });
    camera.panBy(40, -20);
    const after = camera.pageToScreen({ x: 0, y: 0 });
    expectClose(after.x - before.x, 40);
    expectClose(after.y - before.y, -20);
  });
});

describe("zoomBy", () => {
  test("keeps the page point under the anchor fixed", () => {
    const camera = new Camera({ x: 7, y: -3, z: 1 });
    const anchor = { x: 320, y: 180 };
    const anchored = camera.screenToPage(anchor);
    camera.zoomBy(1.7, anchor);
    const after = camera.screenToPage(anchor);
    expectClose(after.x, anchored.x);
    expectClose(after.y, anchored.y);
    expectClose(camera.get().z, 1.7);
  });

  test("stays anchored across a sequence of zoom steps", () => {
    const camera = new Camera({ x: 0, y: 0, z: 1 });
    const anchor = { x: 100, y: 250 };
    const anchored = camera.screenToPage(anchor);
    for (const factor of [1.2, 1.2, 0.5, 3, 0.8]) {
      camera.zoomBy(factor, anchor);
      const after = camera.screenToPage(anchor);
      expectClose(after.x, anchored.x);
      expectClose(after.y, anchored.y);
    }
  });

  test("clamps at the limits and stays anchored there", () => {
    const camera = new Camera({ x: 0, y: 0, z: 1 });
    const anchor = { x: 400, y: 300 };
    const anchored = camera.screenToPage(anchor);
    camera.zoomBy(1000, anchor);
    expect(camera.get().z).toBe(MAX_ZOOM);
    expectClose(camera.screenToPage(anchor).x, anchored.x);
    camera.zoomBy(0.0001, anchor);
    expect(camera.get().z).toBe(MIN_ZOOM);
    expectClose(camera.screenToPage(anchor).y, anchored.y);
  });

  test("zoomTo reaches an absolute zoom about an anchor", () => {
    const camera = new Camera({ x: 5, y: 5, z: 1 });
    const anchor = { x: 200, y: 200 };
    const anchored = camera.screenToPage(anchor);
    camera.zoomTo(3, anchor);
    expect(camera.get().z).toBe(3);
    expectClose(camera.screenToPage(anchor).x, anchored.x);
  });
});

describe("subscription", () => {
  test("notifies on every change and stops after unsubscribe", () => {
    const camera = new Camera();
    const seen: number[] = [];
    const unsubscribe = camera.subscribe((state) => seen.push(state.z));
    camera.zoomBy(2, { x: 0, y: 0 });
    camera.panBy(10, 10);
    unsubscribe();
    camera.panBy(10, 10);
    expect(seen).toEqual([2, 2]);
  });

  test("set clamps the incoming zoom", () => {
    const camera = new Camera();
    camera.set({ x: 1, y: 2, z: 100 });
    expect(camera.get()).toEqual({ x: 1, y: 2, z: MAX_ZOOM });
  });
});
