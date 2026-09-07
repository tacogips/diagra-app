import { expect, test } from "bun:test";
import { CommandError } from "./commands.ts";
import { updateElementAccessibility } from "./accessibility.ts";
import { makeEditor } from "./test-helpers.ts";

test("authors, clears, undoes, and redoes accessibility metadata", () => {
  const editor = makeEditor();
  const id = editor.createElement("text.note", {
    semantic: { text: "Checkout" },
  });
  updateElementAccessibility(editor, id, {
    role: "heading",
    label: " Checkout summary ",
    headingLevel: 2,
    disabled: true,
  });
  expect(editor.store.get(id)?.accessibility).toEqual({
    role: "heading",
    label: "Checkout summary",
    disabled: true,
    headingLevel: 2,
  });

  updateElementAccessibility(editor, id, { role: "text", label: "" });
  expect(editor.store.get(id)?.accessibility).toEqual({
    role: "text",
    disabled: true,
  });
  expect(editor.undo()).toBe(true);
  expect(editor.store.get(id)?.accessibility?.headingLevel).toBe(2);
  expect(editor.redo()).toBe(true);
  expect(editor.store.get(id)?.accessibility?.role).toBe("text");

  updateElementAccessibility(editor, id, { role: null, disabled: false });
  expect(editor.store.get(id)?.accessibility).toBeUndefined();
});

test("rejects invalid accessibility commands atomically", () => {
  const editor = makeEditor();
  const id = editor.createElement("node.generic", {
    semantic: { label: "Node" },
  });
  expect(() =>
    editor.apply([
      {
        type: "replaceAccessibility",
        id,
        accessibility: { role: "button", headingLevel: 7 },
      },
    ]),
  ).toThrow(CommandError);
  expect(editor.store.get(id)?.accessibility).toBeUndefined();
});

test("choosing heading starts at level two and leaving clears the level", () => {
  const editor = makeEditor();
  const id = editor.createElement("text.note", { semantic: { text: "Title" } });
  updateElementAccessibility(editor, id, { role: "heading" });
  expect(editor.store.get(id)?.accessibility).toEqual({
    role: "heading",
    headingLevel: 2,
  });
  updateElementAccessibility(editor, id, { role: "text" });
  expect(editor.store.get(id)?.accessibility).toEqual({ role: "text" });
});
