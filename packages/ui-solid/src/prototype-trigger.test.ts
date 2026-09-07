import { expect, test } from "bun:test";
import { prototypeEventMatches } from "./prototype-trigger.ts";

test("prototype pointer triggers fire only for their configured input", () => {
  expect(prototypeEventMatches("click", "click")).toBe(true);
  expect(prototypeEventMatches("click", "pointer-enter")).toBe(false);
  expect(prototypeEventMatches("hover", "pointer-enter")).toBe(true);
  expect(prototypeEventMatches("hover", "click")).toBe(false);
  expect(prototypeEventMatches("press", "pointer-down")).toBe(true);
  expect(prototypeEventMatches("press", "click")).toBe(false);
  expect(prototypeEventMatches("after-delay", "click")).toBe(false);
});

test("interactive hotspots remain keyboard-operable", () => {
  for (const trigger of ["click", "hover", "press"] as const)
    expect(prototypeEventMatches(trigger, "keyboard-activate")).toBe(true);
  expect(prototypeEventMatches("after-delay", "keyboard-activate")).toBe(false);
});
