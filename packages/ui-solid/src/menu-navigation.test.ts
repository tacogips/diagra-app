import { expect, test } from "bun:test";
import { stepMenuIndex } from "./menu-navigation.ts";

test("menu navigation skips omitted disabled items and wraps in both directions", () => {
  const enabled = [0, 3, 7];
  expect(stepMenuIndex(enabled, 0, 1)).toBe(3);
  expect(stepMenuIndex(enabled, 7, 1)).toBe(0);
  expect(stepMenuIndex(enabled, 0, -1)).toBe(7);
  expect(stepMenuIndex(enabled, 7, -1)).toBe(3);
});

test("menu navigation recovers from removed items, empty menus and initial focus", () => {
  for (const current of [null, 4]) {
    expect(stepMenuIndex([1, 5], current, 1)).toBe(1);
    expect(stepMenuIndex([1, 5], current, -1)).toBe(5);
  }
  expect(stepMenuIndex([], 2, 1)).toBeNull();
  expect(stepMenuIndex([2], 2, -1)).toBe(2);
});
