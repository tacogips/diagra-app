import { expect, test } from "bun:test";
import {
  Editor,
  generateInterfaceCode,
  generateMobileInterfaceCode,
} from "@nodetto/core";
import { validateDocument } from "@nodetto/ir";
import { parseDocument, serializeDocument } from "@nodetto/io";
import { Tool, creationFor } from "./tools.ts";
import { shapePaletteGroups } from "./shape-palette.ts";
import { createInteraction } from "./interaction.ts";

function pointer(x: number, y: number): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    stopPropagation() {},
    preventDefault() {},
  } as PointerEvent;
}

test("Web and App palettes expose screen types, transitions and interface controls", () => {
  for (const mode of ["web", "app"] as const) {
    const tools = shapePaletteGroups(mode).flatMap((group) =>
      group.items.map((item) => item.tool),
    );
    for (const tool of [
      Tool.ScreenTransition,
      Tool.PopupFrame,
      Tool.BottomSheetFrame,
      Tool.PopoverFrame,
      Tool.Tabs,
      Tool.Progress,
      Tool.Radio,
    ])
      expect(tools).toContain(tool);
    expect(new Set(tools).size).toBe(tools.length);
  }
});

test("dragging the transition tool creates an overlay interaction instead of a generic arrow", () => {
  const editor = new Editor();
  const screen = editor.createElement("frame", {
    semantic: { name: "Screen", screenKind: "screen" },
    visual: { x: 0, y: 0, width: 400, height: 600 },
  });
  const button = editor.createElement("ui.control", {
    semantic: { control: "button", label: "Open" },
    visual: { x: 20, y: 60, width: 180, height: 44 },
  });
  const popup = editor.createElement("frame", {
    ...creationFor(Tool.PopupFrame)!,
    visual: { x: 600, y: 0, width: 320, height: 300 },
  });
  const interaction = createInteraction(editor, {
    tool: () => Tool.ScreenTransition,
    setTool() {},
    container: () => undefined,
  });
  interaction.onPointerDown(pointer(80, 80));
  interaction.onPointerMove(pointer(700, 100));
  interaction.onPointerUp(pointer(700, 100));
  const edge = editor
    .getSnapshot()
    .elements.find((element) => element.type === "edge.generic");
  expect(edge?.semantic).toMatchObject({
    from: button,
    to: popup,
    prototype: true,
    prototypeAction: "open-overlay",
  });
  expect(editor.store.has(screen)).toBe(true);
  interaction.dispose();
});

test("new controls preserve states in JSONL and render in HTML, SVG and native handoff", () => {
  const editor = new Editor();
  const root = editor.createElement("frame", {
    semantic: { name: "Controls", screenKind: "screen" },
    visual: { width: 600, height: 600 },
  });
  for (const [index, tool] of [
    Tool.Radio,
    Tool.Tabs,
    Tool.Progress,
  ].entries()) {
    const creation = creationFor(tool)!;
    editor.createElement(creation.type, {
      ...creation,
      visual: { ...creation.visual, x: 20, y: 40 + index * 80 },
    });
  }
  const document = editor.getSnapshot();
  expect(
    validateDocument(document).filter((issue) => issue.severity === "error"),
  ).toEqual([]);
  expect(parseDocument(serializeDocument(document))).toEqual(document);
  const html = generateInterfaceCode(editor, root)!;
  expect(html.html).toContain('type="radio"');
  expect(html.html).toContain('role="tablist"');
  expect(html.html).toContain('aria-selected="true"');
  expect(html.html).toContain('max="100" value="60"');
  expect(html.css).toContain('[data-control="tabs"]');
  const svg = editor.exportPageSvg();
  expect(svg).toContain("Option 1");
  expect(svg).not.toContain("Unsupported");
  const native = generateMobileInterfaceCode(editor, root)!;
  expect(native.swiftUi).toContain("ProgressView(value: 60");
  expect(native.swiftUi).toContain(".pickerStyle(.segmented)");
  expect(native.jetpackCompose).toContain("LinearProgressIndicator");
  expect(native.jetpackCompose).toContain("RadioButton(selected");
  expect(native.jetpackCompose).toContain("Tab(selected");
  expect(() =>
    editor.createElement("ui.control", {
      semantic: { control: "progress", label: "Invalid", progress: 101 },
    }),
  ).toThrow();
});
