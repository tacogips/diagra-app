import { expect, test } from "bun:test";
import { PrototypeSurfaceFocus } from "./prototype-surface-focus.ts";

test("overlay focus follows nested open, pop and return to screen", () => {
  const queue: (() => void)[] = [];
  const focused: string[] = [];
  const focus = new PrototypeSurfaceFocus((callback) => queue.push(callback));
  const surface = (key: string) => ({
    isConnected: true,
    focus: (options: { preventScroll: boolean }) => {
      expect(options.preventScroll).toBe(true);
      focused.push(key);
    },
  });
  focus.update(null, () => surface("initial"));
  expect(queue).toHaveLength(0);
  for (const key of ["menu", "confirm", "menu", null]) {
    focus.update(key, () => surface(key ?? "screen"));
    expect(queue).toHaveLength(1);
    queue.shift()?.();
  }
  expect(focused).toEqual(["menu", "confirm", "menu", "screen"]);
  focus.update(null, () => surface("redundant"));
  expect(queue).toHaveLength(0);
});

test("stale navigation and teardown cannot steal focus", () => {
  const queue: (() => void)[] = [];
  let calls = 0;
  const focus = new PrototypeSurfaceFocus((callback) => queue.push(callback));
  const resolve = () => ({
    isConnected: true,
    focus: () => {
      calls++;
    },
  });
  focus.update("old", resolve);
  focus.update("new", resolve);
  queue.shift()?.();
  expect(calls).toBe(0);
  queue.shift()?.();
  expect(calls).toBe(1);
  focus.update("closing", resolve);
  focus.dispose();
  queue.shift()?.();
  focus.update("closed", resolve);
  expect(calls).toBe(1);
  expect(queue).toHaveLength(0);
});

test("missing and detached surfaces are never focused", () => {
  const queue: (() => void)[] = [];
  const focus = new PrototypeSurfaceFocus((callback) => queue.push(callback));
  focus.update("missing", () => null);
  queue.shift()?.();
  focus.update("detached", () => ({
    isConnected: false,
    focus: () => {
      throw new Error("Focused a detached surface");
    },
  }));
  queue.shift()?.();
});
