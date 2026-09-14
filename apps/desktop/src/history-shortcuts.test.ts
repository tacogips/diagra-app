import { expect, test } from "bun:test";
import { handleHistoryShortcut } from "./history-shortcuts.ts";

function keyEvent(overrides: Record<string, unknown> = {}): KeyboardEvent {
  return {
    key: "z",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: { tagName: "BODY" },
    preventDefault(this: { defaultPrevented: boolean }) {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    ...overrides,
  } as unknown as KeyboardEvent;
}

test("shell history handles root/button focus and avoids a second canvas undo", () => {
  const calls: string[] = [];
  const history = {
    undo: () => {
      calls.push("undo");
    },
    redo: () => {
      calls.push("redo");
    },
  };
  const event = keyEvent();
  expect(handleHistoryShortcut(event, history)).toBe(true);
  expect(handleHistoryShortcut(event, history)).toBe(false);
  handleHistoryShortcut(
    keyEvent({ shiftKey: true, target: { tagName: "BUTTON" } }),
    history,
  );
  handleHistoryShortcut(
    keyEvent({ key: "y", metaKey: false, ctrlKey: true }),
    history,
  );
  expect(calls).toEqual(["undo", "redo", "redo"]);
});

test("text controls, composition and unrelated chords retain their own undo", () => {
  let changes = 0;
  const history = {
    undo: () => {
      changes++;
    },
    redo: () => {
      changes++;
    },
  };
  for (const overrides of [
    ...["INPUT", "TEXTAREA", "SELECT"].map((tagName) => ({
      target: { tagName },
    })),
    { target: { tagName: "DIV", isContentEditable: true } },
    { isComposing: true },
    { altKey: true },
    { metaKey: false },
    { defaultPrevented: true },
    { key: "s" },
  ])
    expect(handleHistoryShortcut(keyEvent(overrides), history)).toBe(false);
  expect(changes).toBe(0);
});
