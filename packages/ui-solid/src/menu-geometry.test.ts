import { expect, test } from "bun:test";
import { clampToHost, menuLimits, placeSubmenu } from "./menu-geometry.ts";

test("submenu placement respects offset host coordinates and bottom overflow", () => {
  const bounds = { left: 250, top: 100, width: 800, height: 500 };
  expect(
    placeSubmenu(
      { left: 300, right: 500 },
      200,
      { width: 220, height: 200 },
      bounds,
    ),
  ).toEqual({ x: 500, y: 200 });
  expect(
    placeSubmenu(
      { left: 800, right: 1000 },
      550,
      { width: 220, height: 200 },
      bounds,
    ),
  ).toEqual({ x: 580, y: 396 });
});

test("submenu placement also works with viewport fallback bounds and narrow hosts", () => {
  expect(
    placeSubmenu(
      { left: 400, right: 600 },
      100,
      { width: 220, height: 300 },
      { left: 0, top: 0, width: 640, height: 480 },
    ),
  ).toEqual({ x: 180, y: 100 });
  const host = { left: 200, top: 50, width: 150, height: 180 };
  expect(
    placeSubmenu({ left: 204, right: 346 }, 100, menuLimits(host), host),
  ).toEqual({ x: 204, y: 54 });
});

test("menu boxes reserve margins in narrow and short editor hosts", () => {
  const bounds = { width: 150, height: 180 };
  const limits = menuLimits(bounds);
  expect(limits).toEqual({ width: 142, height: 172 });
  expect(clampToHost({ x: 140, y: 170 }, limits, bounds)).toEqual({
    x: 4,
    y: 4,
  });
  expect(menuLimits({ width: 0, height: 3 })).toEqual({ width: 1, height: 1 });
});

test("menu placement clamps every edge and leaves an interior point unchanged", () => {
  const bounds = { width: 800, height: 600 };
  const size = { width: 220, height: 300 };
  expect(clampToHost({ x: -100, y: -100 }, size, bounds)).toEqual({
    x: 4,
    y: 4,
  });
  expect(clampToHost({ x: 790, y: 590 }, size, bounds)).toEqual({
    x: 576,
    y: 296,
  });
  expect(clampToHost({ x: 120, y: 80 }, size, bounds)).toEqual({
    x: 120,
    y: 80,
  });
});
