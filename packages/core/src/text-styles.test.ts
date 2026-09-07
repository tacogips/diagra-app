import { describe, expect, test } from "bun:test";
import type { FrameSemantic, TypographyStyleValue } from "@diagra/ir";
import { copyElements, planPaste } from "./clipboard.ts";
import { inspectDesign } from "./handoff.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { bindSelectionNumber, createNumberToken } from "./number-tokens.ts";
import { textStyleCssName } from "./token-handoff.ts";
import {
  bindSelectionTextStyle,
  createTextStyle,
  selectionTextStyleBinding,
  textStyles,
  updateTextStyle,
} from "./text-styles.ts";
import { document, makeEditor } from "./test-helpers.ts";

const HEADING: TypographyStyleValue = {
  fontFamily: "Inter, sans-serif",
  fontSize: 32,
  fontWeight: 700,
  fontStyle: "normal",
  lineHeight: 1.2,
  letterSpacing: -0.5,
  textAlign: "start",
  textDecoration: "none",
  verticalAlign: "top",
};

function setup() {
  let id = 0;
  const editor = makeEditor({
    document: document([]),
    idSource: () => `text-style-${++id}`,
  });
  const note = editor.createElement("text.note", {
    semantic: { text: "Title" },
    visual: { x: 10, y: 20, width: 200, height: 60 },
  });
  return { editor, note };
}

describe("reusable text styles", () => {
  test("applies a complete style and propagates resource edits atomically", () => {
    const { editor, note } = setup();
    const style = createTextStyle(editor, "Heading", HEADING) as string;
    editor.selection.set([note]);
    expect(bindSelectionTextStyle(editor, style)).toBe(true);
    expect(editor.store.get(note)?.visual).toMatchObject({
      textStyle: style,
      style: HEADING,
    });
    expect(selectionTextStyleBinding(editor)).toMatchObject({
      count: 1,
      id: style,
      name: "Heading",
      deferred: 0,
    });

    expect(
      updateTextStyle(editor, style, "Display", {
        ...HEADING,
        fontSize: 40,
        lineHeight: 1.1,
      }),
    ).toBe(true);
    expect(editor.store.get(note)?.visual.style).toMatchObject({
      fontSize: 40,
      lineHeight: 1.1,
    });
    expect(textStyles(editor)[0]?.name).toBe("Display");
    editor.undo();
    expect(editor.store.get(note)?.visual.style?.fontSize).toBe(32);
    expect(textStyles(editor)[0]?.name).toBe("Heading");
  });

  test("direct typography edits detach while unrelated paint edits stay linked", () => {
    const { editor, note } = setup();
    const style = createTextStyle(editor, "Heading", HEADING) as string;
    editor.selection.set([note]);
    bindSelectionTextStyle(editor, style);
    editor.setSelectionStyle({ fill: "#ffffff" });
    expect(editor.store.get(note)?.visual.textStyle).toBe(style);
    editor.setSelectionStyle({ fontWeight: 500 });
    expect(editor.store.get(note)?.visual.textStyle).toBeUndefined();
    expect(editor.store.get(note)?.visual.style?.fontWeight).toBe(500);
  });

  test("individual typography measurement bindings replace the composite link", () => {
    const { editor, note } = setup();
    const style = createTextStyle(editor, "Heading", HEADING) as string;
    const size = createNumberToken(editor, "Type large", 36) as string;
    editor.selection.set([note]);
    bindSelectionTextStyle(editor, style);
    expect(bindSelectionNumber(editor, "fontSize", size)).toBe(true);
    expect(editor.store.get(note)?.visual.textStyle).toBeUndefined();
    expect(editor.store.get(note)?.visual.numberTokens?.fontSize).toBe(size);
    expect(editor.store.get(note)?.visual.style?.fontSize).toBe(36);
  });

  test("deleting a resource detaches without changing materialized typography", () => {
    const { editor, note } = setup();
    const style = createTextStyle(editor, "Heading", HEADING) as string;
    editor.selection.set([note]);
    bindSelectionTextStyle(editor, style);
    editor.deleteElements([style]);
    expect(editor.store.get(note)?.visual.textStyle).toBeUndefined();
    expect(editor.store.get(note)?.visual.style).toMatchObject(HEADING);
  });

  test("locked consumers defer updates and reconcile when unlocked", () => {
    const { editor, note } = setup();
    const style = createTextStyle(editor, "Heading", HEADING) as string;
    editor.selection.set([note]);
    bindSelectionTextStyle(editor, style);
    editor.apply([
      { type: "updateVisual", id: note, visual: { locked: true } },
    ]);
    updateTextStyle(editor, style, "Heading", { ...HEADING, fontSize: 48 });
    expect(editor.store.get(note)?.visual.style?.fontSize).toBe(32);
    expect(selectionTextStyleBinding(editor).deferred).toBe(1);
    editor.apply([
      { type: "updateVisual", id: note, visual: { locked: false } },
    ]);
    expect(editor.store.get(note)?.visual.style?.fontSize).toBe(48);
  });

  test("clipboard detaches external styles and remaps included resources", () => {
    const { editor, note } = setup();
    const style = createTextStyle(editor, "Heading", HEADING) as string;
    editor.selection.set([note]);
    bindSelectionTextStyle(editor, style);
    expect(
      copyElements(editor.store, [note]).elements[0]?.visual.textStyle,
    ).toBeUndefined();
    const payload = copyElements(editor.store, [note, style]);
    expect(
      payload.elements.find((element) => element.id === note)?.visual.textStyle,
    ).toBe(style);
    let copy = 0;
    const plan = planPaste(payload, {
      page: editor.currentPageId,
      idSource: () => `copy-${++copy}`,
      nextIndex: () => `z${copy}`,
      offset: { x: 16, y: 16 },
    });
    const pastedNote = plan.commands.find(
      (command) =>
        command.type === "createElement" &&
        command.element.type === "text.note",
    );
    expect(
      pastedNote?.type === "createElement"
        ? pastedNote.element.visual.textStyle
        : undefined,
    ).toBe(plan.mapping.get(style));
  });

  test("component instances preserve shared typography resources", () => {
    const { editor, note } = setup();
    const style = createTextStyle(editor, "Heading", HEADING) as string;
    editor.selection.set([note]);
    bindSelectionTextStyle(editor, style);
    const definition = editor.createElement("frame", {
      semantic: { name: "Title block", memberIds: [note] },
      visual: { x: 0, y: 0, width: 300, height: 100 },
    });
    expect(editor.makeComponent(definition)).toBe(true);
    const instance = editor.createComponentInstance(definition);
    expect(instance).not.toBeNull();
    const child = (
      editor.store.get(instance as string)?.semantic as FrameSemantic
    ).memberIds?.[0];
    expect(editor.store.get(child as string)?.visual.textStyle).toBe(style);
  });

  test("developer handoff preserves stable linked typography variables", () => {
    const { editor, note } = setup();
    const style = createTextStyle(editor, "Heading", HEADING) as string;
    editor.selection.set([note]);
    bindSelectionTextStyle(editor, style);
    const frame = editor.createElement("frame", {
      semantic: { name: "Screen", memberIds: [note] },
      visual: { x: 0, y: 0, width: 390, height: 844 },
    });
    const report = inspectDesign(editor, note);
    expect(report?.linkedCss).toContain(
      `font-size: var(${textStyleCssName(style, "fontSize")}, 32px);`,
    );
    expect(report?.typography.styles[0]).toMatchObject({
      id: style,
      name: "Heading",
      value: HEADING,
    });
    const generated = generateInterfaceCode(editor, frame);
    expect(generated?.linkedCss).toContain(
      textStyleCssName(style, "fontFamily"),
    );
    expect(generated?.linkedCss).toContain(
      textStyleCssName(style, "lineHeight"),
    );
  });

  test("rejects invalid resource values without mutating the document", () => {
    const { editor } = setup();
    expect(
      createTextStyle(editor, "Broken", {
        ...HEADING,
        fontSize: Number.NaN,
      }),
    ).toBeNull();
    expect(textStyles(editor)).toHaveLength(0);
  });
});
