import { expect, test } from "bun:test";
import { prototypeFitScale } from "./prototype-scale.ts";

test("web and mobile screens fit with margins while preserving aspect ratio", () => {
  for (const screen of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    const viewport = { width: 800, height: 600 };
    const scale = prototypeFitScale(screen, viewport);
    expect(screen.width * scale).toBeLessThanOrEqual(viewport.width - 48);
    expect(screen.height * scale).toBeLessThanOrEqual(viewport.height - 48);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(1);
  }
});

test("fit does not enlarge small designs and handles unmeasured viewports", () => {
  expect(
    prototypeFitScale({ width: 100, height: 100 }, { width: 800, height: 600 }),
  ).toBe(1);
  expect(
    prototypeFitScale({ width: 390, height: 844 }, { width: 0, height: 0 }),
  ).toBe(1);
  expect(
    prototypeFitScale(
      { width: Number.NaN, height: 100 },
      { width: 800, height: 600 },
    ),
  ).toBe(1);
  expect(
    prototypeFitScale({ width: 100, height: 100 }, { width: 10, height: 10 }),
  ).toBe(0.01);
});
