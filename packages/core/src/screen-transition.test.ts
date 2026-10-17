import { expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@nodetto/io";
import {
  type FrameSemantic,
  type GenericEdgeSemantic,
  SCREEN_KINDS,
} from "@nodetto/ir";
import { Editor } from "./editor.ts";
import { connectScreenTransition, screenFrame } from "./screen-transition.ts";
import { prototypeScreen } from "./prototype.ts";
import { connectorDecoration } from "./shapes/connector.ts";
import { generateInterfaceCode } from "./interface-code.ts";

function setup() {
  const editor = new Editor();
  const home = editor.createElement("frame", {
    semantic: { name: "Home", screenKind: "screen", platform: "web" },
    visual: { x: 0, y: 0, width: 400, height: 800 },
  });
  const button = editor.createElement("ui.control", {
    semantic: { control: "button", label: "Continue" },
    visual: { x: 20, y: 60, width: 180, height: 44 },
  });
  return { editor, home, button };
}

test("screen kinds round-trip and infer navigation or overlay behavior without flattening parts", () => {
  for (const kind of SCREEN_KINDS) {
    const { editor, home, button } = setup();
    const target = editor.createElement("frame", {
      semantic: { name: "Destination", screenKind: kind },
      visual: { x: 600, y: 0, width: 300, height: 300 },
    });
    const part = editor.createElement("text.note", {
      semantic: { text: "Editable content" },
      visual: { x: 620, y: 40, width: 200, height: 40 },
    });
    const id = connectScreenTransition(editor, button, part);
    expect(id).not.toBeNull();
    const edge = editor.store.get(id ?? "");
    expect(edge?.semantic).toMatchObject({
      from: button,
      to: target,
      prototype: true,
      prototypeAction: kind === "screen" ? "navigate" : "open-overlay",
      prototypeTransition: kind === "bottom-sheet" ? "slide-up" : "fade",
    });
    if (kind === "bottom-sheet")
      expect(edge?.semantic).toMatchObject({
        prototypeOverlayPosition: "bottom-center",
      });
    const preview = prototypeScreen(editor, home);
    expect(preview?.links[0]?.to).toBe(target);
    expect(preview?.elements.some((element) => element.id === id)).toBe(false);
    expect(connectorDecoration(edge!).label).toContain(
      kind === "screen" ? "navigate" : "open-overlay",
    );
    expect(generateInterfaceCode(editor, target)?.html).toContain(
      `data-screen-kind="${kind}"`,
    );
    const before = editor.getSnapshot();
    expect(parseDocument(serializeDocument(before))).toEqual(before);
    editor.undo();
    expect(editor.store.has(id ?? "")).toBe(false);
    editor.redo();
    expect(editor.store.has(id ?? "")).toBe(true);
  }
});

test("layout frames resolve to their screen and explicit popups retain their identity", () => {
  const { editor, home } = setup();
  const card = editor.createElement("frame", {
    semantic: { name: "Card" },
    visual: { x: 10, y: 10, width: 350, height: 200 },
  });
  const content = editor.createElement("text.note", {
    visual: { x: 30, y: 30, width: 100, height: 40 },
  });
  expect(screenFrame(editor, content)).toBe(home);
  editor.apply([
    {
      type: "updateSemantic",
      id: card,
      semantic: { name: "Card", screenKind: "popup" },
    },
  ]);
  expect(screenFrame(editor, content)).toBe(card);
});

test("transition creation rejects invalid endpoints, locks, self links and other pages", () => {
  const { editor, home, button } = setup();
  const orphan = editor.createElement("shape.geo", {
    visual: { x: 1000, y: 1000 },
  });
  expect(connectScreenTransition(editor, home, orphan)).toBeNull();
  expect(connectScreenTransition(editor, orphan, home)).toBeNull();
  expect(connectScreenTransition(editor, home, home)).toBeNull();
  editor.apply([{ type: "updateVisual", id: home, visual: { locked: true } }]);
  expect(connectScreenTransition(editor, button, home)).toBeNull();
  editor.undo();
  const other = editor.createPage({ name: "Other" });
  const screen = editor.createElement("frame", { page: other });
  expect(connectScreenTransition(editor, home, screen)).toBeNull();
  expect(() =>
    editor.createElement("edge.generic", {
      page: editor.store.get(home)!.page,
      semantic: { from: button, to: orphan, prototype: true },
    }),
  ).toThrow();
});

test("changing screen kind and transition settings preserves geometry, children and behavior", () => {
  const { editor, home, button } = setup();
  const popup = editor.createElement("frame", {
    semantic: { name: "Popup", screenKind: "popup" },
    visual: { x: 600, y: 0 },
  });
  const id = connectScreenTransition(editor, button, popup)!;
  const original = editor.store.get(home)!;
  editor.apply([
    {
      type: "updateSemantic",
      id: home,
      semantic: {
        ...(original.semantic as FrameSemantic),
        screenKind: "bottom-sheet",
      },
    },
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)!.semantic as GenericEdgeSemantic),
        prototypeAction: "close-overlay",
        prototypeTrigger: "hover",
        prototypeTransition: "slide-down",
        prototypeDuration: 500,
      },
    },
  ]);
  expect(editor.store.get(home)?.visual).toEqual(original.visual);
  expect(editor.store.has(button)).toBe(true);
  expect(prototypeScreen(editor, home)?.links[0]).toMatchObject({
    action: "close-overlay",
    trigger: "hover",
    transition: "slide-down",
    duration: 500,
  });
});
