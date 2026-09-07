import { expect, test } from "bun:test";
import {
  dismissPrototypeOverlay,
  popPrototypeOverlay,
  prototypeOverlayPlacement,
  pushPrototypeOverlay,
  type PrototypeOverlayEntry,
} from "./prototype-overlays.ts";

function entry(
  frameId: string,
  patch: Partial<PrototypeOverlayEntry> = {},
): PrototypeOverlayEntry {
  return {
    key: `edge-${frameId}`,
    frameId,
    position: "center",
    x: 0,
    y: 0,
    backdrop: false,
    dismiss: false,
    transition: "instant",
    duration: 250,
    ...patch,
  };
}

test("overlay stacks nest, close from the top and reject recursive targets", () => {
  const first = pushPrototypeOverlay([], entry("menu"));
  const nested = pushPrototypeOverlay(first, entry("confirmation"));
  expect(nested.map((item) => item.frameId)).toEqual(["menu", "confirmation"]);
  expect(pushPrototypeOverlay(nested, entry("menu"))).toBe(nested);
  expect(popPrototypeOverlay(nested)).toEqual(first);
  expect(popPrototypeOverlay([])).toEqual([]);
});

test("outside dismissal is opt-in and affects only the top overlay", () => {
  const base = [entry("menu", { dismiss: true })];
  const fixed = [...base, entry("dialog")];
  expect(dismissPrototypeOverlay(fixed)).toBe(fixed);
  const dismissible = [...base, entry("popover", { dismiss: true })];
  expect(dismissPrototypeOverlay(dismissible)).toEqual(base);
});

test("overlay placement supports centered, top-left and manual coordinates", () => {
  const base = { x: 100, y: 50, width: 390, height: 844 };
  const overlay = { x: 900, y: 100, width: 300, height: 200 };
  expect(prototypeOverlayPlacement(base, overlay, entry("center"))).toEqual({
    x: 145,
    y: 372,
  });
  expect(
    prototypeOverlayPlacement(
      base,
      overlay,
      entry("top", { position: "top-left" }),
    ),
  ).toEqual({ x: 100, y: 50 });
  expect(
    prototypeOverlayPlacement(
      base,
      overlay,
      entry("manual", { position: "manual", x: 24, y: 80 }),
    ),
  ).toEqual({ x: 124, y: 130 });
});

test("overlay nesting is capped", () => {
  let stack: readonly PrototypeOverlayEntry[] = [];
  for (let index = 0; index < 10; index += 1)
    stack = pushPrototypeOverlay(stack, entry(`overlay-${index}`));
  expect(stack).toHaveLength(8);
});
