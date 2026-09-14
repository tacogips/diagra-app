import { expect, test } from "bun:test";
import { stopPanelKeyDown } from "./panel-keyboard.ts";

function stopped(overrides: Record<string, unknown> = {}): boolean {
  let result = false;
  stopPanelKeyDown({
    key: "z",
    metaKey: true,
    target: { tagName: "BUTTON" },
    stopPropagation: () => {
      result = true;
    },
    ...overrides,
  } as unknown as KeyboardEvent);
  return result;
}

test("panel buttons and View summary pass history chords to the shell", () => {
  expect(stopped()).toBe(false);
  expect(stopped({ shiftKey: true })).toBe(false);
  expect(stopped({ key: "Z", metaKey: false, ctrlKey: true })).toBe(false);
  expect(stopped({ key: "y", metaKey: false, ctrlKey: true })).toBe(false);
  expect(stopped({ target: { tagName: "SUMMARY" } })).toBe(false);
});

test("panels retain native editing, handled events and non-history keys", () => {
  for (const overrides of [
    ...["INPUT", "TEXTAREA", "SELECT"].map((tagName) => ({
      target: { tagName },
    })),
    { target: { tagName: "DIV", isContentEditable: true } },
    { defaultPrevented: true },
    { isComposing: true },
    { altKey: true },
    { metaKey: false },
    { key: "Delete" },
    { key: "ArrowRight" },
    { key: "v" },
  ])
    expect(stopped(overrides)).toBe(true);
});
