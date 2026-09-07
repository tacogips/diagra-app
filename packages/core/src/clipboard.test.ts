// Copy and paste as pure functions, before the editor gets involved.

import { describe, expect, test } from "bun:test";
import type { Element, GroupSemantic } from "@diagra/ir";
import {
  type ClipboardPayload,
  Clipboard,
  copyElements,
  PASTE_OFFSET,
  planPaste,
} from "./clipboard.ts";
import { Store } from "./store.ts";
import { counterIds, document, element, erdFixture } from "./test-helpers.ts";

function storeOf(elements: readonly Element[]): Store {
  return new Store(document(elements));
}

/** A key generator that reads like the fractional one but is predictable. */
function indexes(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `z${next}`;
  };
}

describe("copyElements", () => {
  test("takes present elements bottom to top", () => {
    const store = storeOf([
      element({ id: "top", type: "node.generic", index: "a5", semantic: {} }),
      element({ id: "low", type: "node.generic", index: "a1", semantic: {} }),
    ]);
    const payload = copyElements(store, ["top", "low", "missing"]);
    expect(payload.elements.map((entry) => entry.id)).toEqual(["low", "top"]);
  });

  test("drops a connector whose other endpoint was not copied", () => {
    const store = storeOf(erdFixture());
    const payload = copyElements(store, ["users", "rel"]);
    expect(payload.elements.map((entry) => entry.id)).toEqual(["users"]);
  });

  test("keeps a connector when both endpoints came along", () => {
    const store = storeOf(erdFixture());
    const payload = copyElements(store, ["rel", "users", "orders"]);
    expect(payload.elements.map((entry) => entry.id)).toEqual([
      "users",
      "orders",
      "rel",
    ]);
  });

  test("is a deep clone: editing the document cannot reach the payload", () => {
    const store = storeOf(erdFixture());
    const payload = copyElements(store, ["users"]);
    const copied = payload.elements[0] as Element;
    const live = store.get("users") as Element;
    expect(copied.semantic).toEqual(live.semantic);
    expect(copied.semantic).not.toBe(live.semantic);
    expect((copied.semantic as { columns: unknown[] }).columns[0]).not.toBe(
      (live.semantic as { columns: unknown[] }).columns[0],
    );
  });
});

describe("planPaste", () => {
  const payload = (): ClipboardPayload => ({
    elements: [
      element({
        id: "a",
        type: "node.generic",
        index: "a1",
        semantic: { label: "A" },
        visual: { x: 10, y: 20 },
      }),
      element({
        id: "e",
        type: "edge.generic",
        index: "a2",
        semantic: { from: "a", to: "b", arrowheads: { end: "arrow" } },
      }),
      element({
        id: "b",
        type: "node.generic",
        index: "a3",
        semantic: { label: "B" },
        visual: { x: 100, y: 20 },
      }),
    ],
  });

  test("mints fresh ids and rewrites the endpoints to match", () => {
    const plan = planPaste(payload(), {
      page: "page-2",
      idSource: counterIds("p"),
      nextIndex: indexes(),
      offset: { x: 5, y: 7 },
    });
    expect(plan.ids).toEqual(["p-1", "p-2", "p-3"]);
    expect([...plan.mapping]).toEqual([
      ["a", "p-1"],
      ["e", "p-2"],
      ["b", "p-3"],
    ]);
    const created = plan.commands.map((command) =>
      command.type === "createElement" ? command.element : null,
    ) as Element[];
    expect(created[1]?.semantic).toEqual({
      from: "p-1",
      to: "p-3",
      arrowheads: { end: "arrow" },
    });
  });

  test("moves positioned elements and leaves the rest where they are", () => {
    const plan = planPaste(payload(), {
      page: "page-1",
      idSource: counterIds("p"),
      nextIndex: indexes(),
      offset: { x: 5, y: 7 },
    });
    const created = plan.commands.map((command) =>
      command.type === "createElement" ? command.element : null,
    ) as Element[];
    expect(created[0]?.visual).toEqual({ x: 15, y: 27 });
    expect(created[1]?.visual).toEqual({});
    expect(created[0]?.page).toBe("page-1");
    expect(created.map((entry) => entry.index)).toEqual(["z1", "z2", "z3"]);
  });

  test("puts every element on the requested page", () => {
    const plan = planPaste(payload(), {
      page: "page-2",
      idSource: counterIds("p"),
      nextIndex: indexes(),
      offset: { x: 0, y: 0 },
    });
    const created = plan.commands.map((command) =>
      command.type === "createElement" ? command.element : null,
    ) as Element[];
    expect(created.every((entry) => entry.page === "page-2")).toBe(true);
  });

  test("two plans off one payload share no structure", () => {
    const source = payload();
    const first = planPaste(source, {
      page: "page-1",
      idSource: counterIds("p"),
      nextIndex: indexes(),
      offset: { x: 0, y: 0 },
    });
    const second = planPaste(source, {
      page: "page-1",
      idSource: counterIds("q"),
      nextIndex: indexes(),
      offset: { x: 0, y: 0 },
    });
    const semanticOf = (plan: typeof first, at: number): unknown => {
      const command = plan.commands[at];
      return command?.type === "createElement"
        ? command.element.semantic
        : null;
    };
    expect(semanticOf(first, 0)).toEqual(semanticOf(second, 0));
    expect(semanticOf(first, 0)).not.toBe(semanticOf(second, 0));
    expect(semanticOf(first, 0)).not.toBe(
      (source.elements[0] as Element).semantic,
    );
  });

  test("rewrites a copied group's mask reference with its members", () => {
    const source = storeOf([
      element({ id: "mask", type: "shape.geo", semantic: { geo: "ellipse" } }),
      element({ id: "content", type: "shape.geo", semantic: { geo: "rect" } }),
      element({
        id: "group",
        type: "group",
        semantic: { memberIds: ["mask", "content"], maskId: "mask" },
      }),
    ]);
    const copied = copyElements(source, ["group", "mask", "content"]);
    const plan = planPaste(copied, {
      page: "page-1",
      idSource: counterIds("p"),
      nextIndex: indexes(),
      offset: { x: 0, y: 0 },
    });
    const pastedGroup = plan.commands
      .filter((command) => command.type === "createElement")
      .map((command) => command.element)
      .find((entry) => entry.type === "group");
    const pastedMask = plan.mapping.get("mask");
    const pastedContent = plan.mapping.get("content");
    if (!pastedMask || !pastedContent) throw new Error("missing pasted ids");
    expect(pastedGroup?.semantic as GroupSemantic).toEqual({
      memberIds: [pastedMask, pastedContent],
      maskId: pastedMask,
    });
  });
});

describe("Clipboard", () => {
  test("starts empty and reports a payload once set", () => {
    const clipboard = new Clipboard();
    expect(clipboard.isEmpty).toBe(true);
    expect(clipboard.get()).toBeNull();

    const payload: ClipboardPayload = {
      elements: [element({ id: "a", type: "node.generic", semantic: {} })],
    };
    clipboard.set(payload);
    expect(clipboard.isEmpty).toBe(false);
    expect(clipboard.get()).toBe(payload);
  });

  test("an empty payload counts as empty", () => {
    const clipboard = new Clipboard();
    clipboard.set({ elements: [] });
    expect(clipboard.isEmpty).toBe(true);
  });

  test("a new payload resets the paste generation", () => {
    const clipboard = new Clipboard();
    clipboard.set({ elements: [] });
    clipboard.pasteGeneration = 3;
    clipboard.set({ elements: [] });
    expect(clipboard.pasteGeneration).toBe(0);
  });
});

test("the paste offset is the one the design asks for", () => {
  expect(PASTE_OFFSET).toBe(16);
});
