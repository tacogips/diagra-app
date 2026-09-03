// Z-order: the permutation first, then the keys that realise it.

import { describe, expect, test } from "bun:test";
import type { Element, ElementId } from "@diagra/ir";
import type { Command } from "./commands.ts";
import { isFractionalKey } from "./fractional.ts";
import { Store } from "./store.ts";
import {
  counterIds,
  document,
  element,
  makeEditor,
  seededRng,
  TEST_PAGE,
} from "./test-helpers.ts";
import { reorderCommands, targetOrder, type ZOrderAction } from "./z-order.ts";

const RNG = seededRng(11);

function order(ids: string, selected: string, action: ZOrderAction): string {
  return targetOrder([...ids], new Set([...selected]), action).join("");
}

describe("targetOrder", () => {
  test("front lifts the selection above everything, in its own order", () => {
    expect(order("ABCDE", "CD", "front")).toBe("ABECD");
    expect(order("ABCDE", "AC", "front")).toBe("BDEAC");
  });

  test("back drops the selection below everything, in its own order", () => {
    expect(order("ABCDE", "CD", "back")).toBe("CDABE");
    expect(order("ABCDE", "AC", "back")).toBe("ACBDE");
  });

  test("forward hops the selection over the next unselected element", () => {
    expect(order("ABCDE", "CD", "forward")).toBe("ABECD");
    expect(order("ABCD", "AC", "forward")).toBe("BADC");
    expect(order("ABCDE", "A", "forward")).toBe("BACDE");
  });

  test("backward is the mirror of forward", () => {
    expect(order("ABCDE", "CD", "backward")).toBe("ACDBE");
    expect(order("ABCD", "BD", "backward")).toBe("BADC");
    expect(order("ABCDE", "E", "backward")).toBe("ABCED");
  });

  test("a selection already at the extreme does not move", () => {
    expect(order("ABCDE", "DE", "forward")).toBe("ABCDE");
    expect(order("ABCDE", "DE", "front")).toBe("ABCDE");
    expect(order("ABCDE", "AB", "backward")).toBe("ABCDE");
    expect(order("ABCDE", "AB", "back")).toBe("ABCDE");
  });

  test("selecting everything is a no-op whatever the action", () => {
    for (const action of [
      "front",
      "forward",
      "backward",
      "back",
    ] as const satisfies readonly ZOrderAction[]) {
      expect(order("ABC", "ABC", action)).toBe("ABC");
    }
  });
});

function page(keys: readonly string[]): Element[] {
  return keys.map((index, at) =>
    element({
      id: String.fromCharCode(65 + at),
      type: "node.generic",
      index,
      semantic: { label: index },
      visual: { x: 0, y: 0 },
    }),
  );
}

/** The `reorder` commands, which is all this module ever emits. */
function reorders(
  commands: readonly Command[],
): { readonly id: ElementId; readonly index: string }[] {
  return commands.flatMap((command) =>
    command.type === "reorder"
      ? [{ id: command.id, index: command.index }]
      : [],
  );
}

/** Sort by the keys the commands would leave behind. */
function resultingOrder(
  elements: readonly Element[],
  commands: readonly Command[],
): string {
  const keys = new Map(elements.map((entry) => [entry.id, entry.index]));
  for (const command of reorders(commands)) {
    keys.set(command.id, command.index);
  }
  return [...keys]
    .sort(([leftId, leftKey], [rightId, rightKey]) =>
      leftKey === rightKey
        ? leftId.localeCompare(rightId)
        : leftKey < rightKey
          ? -1
          : 1,
    )
    .map(([id]) => id)
    .join("");
}

describe("reorderCommands", () => {
  test("nothing to do produces no commands", () => {
    const elements = page(["a1", "a2", "a3"]);
    expect(reorderCommands(elements, ["A", "B", "C"], RNG)).toEqual([]);
  });

  test("only the elements that have to move are rewritten", () => {
    const elements = page(["a1", "a2", "a3", "a4", "a5"]);
    // C and D to the front: E can keep its key, they cannot.
    const commands = reorderCommands(elements, ["A", "B", "E", "C", "D"], RNG);
    expect(reorders(commands).map((command) => command.id)).toEqual(["C", "D"]);
    expect(resultingOrder(elements, commands)).toBe("ABECD");
  });

  test("every emitted key is a well-formed fractional key", () => {
    const elements = page(["a1", "a2", "a3", "a4"]);
    const commands = reorderCommands(elements, ["D", "C", "B", "A"], RNG);
    expect(reorders(commands)).toHaveLength(commands.length);
    for (const command of reorders(commands)) {
      expect(isFractionalKey(command.index)).toBe(true);
    }
    expect(resultingOrder(elements, commands)).toBe("DCBA");
  });

  test("a foreign index key renumbers the page instead of throwing", () => {
    const elements = page(["a1", "zz!", "a3"]);
    const commands = reorderCommands(elements, ["C", "A", "B"], RNG);
    expect(commands).toHaveLength(3);
    expect(resultingOrder(elements, commands)).toBe("CAB");
    for (const command of reorders(commands)) {
      expect(isFractionalKey(command.index)).toBe(true);
    }
  });

  test("tied index keys renumber the page too", () => {
    const elements = page(["a1", "a1", "a2"]);
    const commands = reorderCommands(elements, ["C", "B", "A"], RNG);
    expect(commands).toHaveLength(3);
    expect(resultingOrder(elements, commands)).toBe("CBA");
  });

  test("an order that leaves an element out is refused", () => {
    const elements = page(["a1", "a2"]);
    expect(reorderCommands(elements, ["B"], RNG)).toEqual([]);
    expect(reorderCommands(elements, [], RNG)).toEqual([]);
  });

  test("ids that are not on the page are ignored", () => {
    const elements = page(["a1", "a2"]);
    const commands = reorderCommands(elements, ["B", "A", "elsewhere"], RNG);
    expect(reorders(commands).map((command) => command.id)).toEqual(["A"]);
    expect(resultingOrder(elements, commands)).toBe("BA");
  });
});

function stack(): ReturnType<typeof makeEditor> {
  return makeEditor({
    document: document(
      ["a1", "a2", "a3"].map((index, at) =>
        element({
          id: `s${at + 1}`,
          type: "node.generic",
          index,
          semantic: { label: index },
          visual: { x: at * 10, y: 0 },
        }),
      ),
    ),
    idSource: counterIds("z"),
  });
}

function pageOrder(editor: ReturnType<typeof makeEditor>): string[] {
  return editor.store.getPageElements(TEST_PAGE.id).map((entry) => entry.id);
}

describe("editor z-order actions", () => {
  test("bring to front, and undo puts it back", () => {
    const editor = stack();
    editor.selection.set(["s1"]);
    const before = editor.history.undoSize;

    expect(editor.bringToFront()).toBe(true);
    expect(pageOrder(editor)).toEqual(["s2", "s3", "s1"]);
    expect(editor.history.undoSize).toBe(before + 1);

    editor.undo();
    expect(pageOrder(editor)).toEqual(["s1", "s2", "s3"]);
  });

  test("forward, backward and to back", () => {
    const editor = stack();
    editor.selection.set(["s1"]);
    expect(editor.bringForward()).toBe(true);
    expect(pageOrder(editor)).toEqual(["s2", "s1", "s3"]);

    expect(editor.sendBackward()).toBe(true);
    expect(pageOrder(editor)).toEqual(["s1", "s2", "s3"]);

    expect(editor.sendToBack()).toBe(false);

    editor.selection.set(["s3"]);
    expect(editor.sendToBack()).toBe(true);
    expect(pageOrder(editor)).toEqual(["s3", "s1", "s2"]);
  });

  test("a no-op costs no history entry", () => {
    const editor = stack();
    editor.selection.set(["s3"]);
    const before = editor.history.undoSize;
    expect(editor.bringToFront()).toBe(false);
    expect(editor.bringForward()).toBe(false);
    expect(editor.history.undoSize).toBe(before);
  });

  test("an empty selection changes nothing", () => {
    const editor = stack();
    expect(editor.bringToFront()).toBe(false);
    expect(pageOrder(editor)).toEqual(["s1", "s2", "s3"]);
  });

  test("a multi-selection keeps its own relative order", () => {
    const editor = stack();
    editor.selection.set(["s1", "s2"]);
    expect(editor.bringToFront()).toBe(true);
    expect(pageOrder(editor)).toEqual(["s3", "s1", "s2"]);
  });

  test("elements on another page are never touched", () => {
    const other = { id: "page-2", name: "Page 2", kind: "freeform" as const };
    const store = new Store(
      document(
        [
          element({ id: "a", type: "node.generic", index: "a1", semantic: {} }),
          element({ id: "b", type: "node.generic", index: "a2", semantic: {} }),
          element({
            id: "far",
            type: "node.generic",
            index: "a1",
            page: "page-2",
            semantic: {},
          }),
        ],
        [TEST_PAGE, other],
      ),
    );
    const elements = store.getPageElements(TEST_PAGE.id);
    const commands = reorderCommands(elements, ["b", "a"], RNG);
    expect(reorders(commands).map((command) => command.id)).not.toContain(
      "far",
    );
  });
});
