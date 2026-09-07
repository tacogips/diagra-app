import { expect, test } from "bun:test";
import { PrototypeVariantState } from "./prototype-variant-state.ts";

test("click activation toggles between the requested and original variant", () => {
  const state = new PrototypeVariantState();
  expect(state.next("edge", "default", "hover", "toggle")).toBe("hover");
  expect(state.next("edge", "hover", "hover", "toggle")).toBe("default");
  expect(state.next("edge", "default", "hover", "toggle")).toBe("hover");
});

test("hover and press activation restore once and tolerate cancellation", () => {
  const state = new PrototypeVariantState();
  expect(state.next("hover", "default", "hovered", "activate")).toBe("hovered");
  expect(state.next("hover", "hovered", "hovered", "activate")).toBeUndefined();
  expect(state.next("hover", "hovered", "hovered", "restore")).toBe("default");
  expect(state.next("hover", "default", "hovered", "restore")).toBeUndefined();
  state.next("press", "default", "pressed", "activate");
  state.clear();
  expect(state.next("press", "pressed", "pressed", "restore")).toBeUndefined();
});

test("separate interactions retain independent origins", () => {
  const state = new PrototypeVariantState();
  expect(state.next("first", "a", "b", "activate")).toBe("b");
  expect(state.next("second", "b", "c", "activate")).toBe("c");
  expect(state.next("second", "c", "c", "restore")).toBe("b");
  expect(state.next("first", "b", "b", "restore")).toBe("a");
});
