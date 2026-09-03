// DOM-free unit tests for the interaction layer.
//
// The state machine needs no DOM: give `createInteraction` a container
// accessor that returns `undefined` and it reads client coordinates
// straight off the event, so plain objects shaped like a PointerEvent drive
// it end to end. Only what the browser actually has to supply — real hit
// areas, cursors, pointer capture, focus — is left to the manual canvas
// checklist in `apps/desktop/README.md`.

import { describe, expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import {
  createInteraction,
  type EditRegion,
  editRegionAt,
  type Interaction,
  type InteractionOptions,
  MIN_SHAPE_SIZE,
  NUDGE_GRID_STEP,
  resizeBox,
  resizeBoxConstrained,
  type Scheduler,
} from "./interaction.ts";
import { creationFor, GEO_TOOLS, TOOLS } from "./tools.ts";
import type { ToolKind } from "./tools.ts";

const START = { x: 100, y: 100, width: 200, height: 100 };

describe("resizeBox", () => {
  test("moves only the edges the handle owns", () => {
    expect(resizeBox(START, "e", 50, 999)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 100,
    });
    expect(resizeBox(START, "n", 999, -20)).toEqual({
      x: 100,
      y: 80,
      width: 200,
      height: 120,
    });
  });

  test("a corner handle moves both of its edges", () => {
    expect(resizeBox(START, "se", 20, 30)).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 130,
    });
    expect(resizeBox(START, "nw", 20, 30)).toEqual({
      x: 120,
      y: 130,
      width: 180,
      height: 70,
    });
  });

  test("normalizes a drag past the opposite edge", () => {
    const flipped = resizeBox(START, "e", -300, 0);
    expect(flipped.x).toBeLessThan(START.x);
    expect(flipped.width).toBeGreaterThan(0);
    expect(flipped.height).toBe(100);
  });

  test("never goes below the minimum size", () => {
    const tiny = resizeBox(START, "se", -1000, -1000);
    expect(tiny.width).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
    expect(tiny.height).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
  });
});

describe("creationFor", () => {
  test("gesture tools place nothing", () => {
    expect(creationFor("select")).toBeNull();
    expect(creationFor("hand")).toBeNull();
    expect(creationFor("edge")).toBeNull();
  });

  test("every geo tool maps onto shape.geo with its kind", () => {
    for (const tool of GEO_TOOLS) {
      const creation = creationFor(tool);
      expect(creation?.type).toBe("shape.geo");
      expect(creation?.semantic).toEqual({
        geo: tool.slice("geo:".length),
        label: "",
      });
    }
  });

  test("element tools place their own type with registry defaults", () => {
    expect(creationFor("erd.table")).toEqual({ type: "erd.table" });
    expect(creationFor("uml.class")).toEqual({ type: "uml.class" });
    expect(creationFor("node.generic")).toEqual({ type: "node.generic" });
  });

  test("every tool is either a gesture or a creation", () => {
    const gestures = new Set(["select", "hand", "edge"]);
    for (const tool of TOOLS) {
      expect(creationFor(tool) === null).toBe(gestures.has(tool));
    }
  });
});

interface Harness {
  readonly editor: Editor;
  readonly interaction: Interaction;
  readonly shape: ElementId;
  tool(): ToolKind;
  setTool(tool: ToolKind): void;
}

/** An interaction over `editor` whose tool signal the test can read and set. */
function interactionFor(
  editor: Editor,
  initial: ToolKind,
  extra: Partial<InteractionOptions> = {},
): Pick<Harness, "interaction" | "tool" | "setTool"> {
  let current: ToolKind = initial;
  const setTool = (next: ToolKind): void => {
    current = next;
  };
  const interaction = createInteraction(editor, {
    ...extra,
    tool: () => current,
    setTool,
    container: () => undefined,
  });
  return { interaction, tool: () => current, setTool };
}

/** A selected 100x100 shape at the origin, with the select tool active. */
function harness(): Harness {
  const editor = new Editor();
  const shape = editor.createElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  editor.selection.set([shape]);
  return { editor, shape, ...interactionFor(editor, "select") };
}

interface PointerInput {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly button?: number;
  readonly pointerId?: number;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: unknown;
}

function pointer(input: PointerInput = {}): PointerEvent {
  return {
    clientX: input.clientX ?? 50,
    clientY: input.clientY ?? 50,
    button: input.button ?? 0,
    pointerId: input.pointerId ?? 1,
    shiftKey: input.shiftKey ?? false,
    metaKey: input.metaKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    altKey: input.altKey ?? false,
    target: input.target,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as unknown as PointerEvent;
}

/** A mouse event (double-click, context menu) at a client point. */
function mouse(
  clientX: number,
  clientY: number,
): MouseEvent & { defaultPrevented: boolean } {
  const event = {
    clientX,
    clientY,
    button: 0,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event as unknown as MouseEvent & { defaultPrevented: boolean };
}

interface KeyInput {
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
  readonly code?: string;
  readonly target?: unknown;
}

function keyboard(
  key: string,
  input: KeyInput = {},
): KeyboardEvent & { defaultPrevented: boolean } {
  const event = {
    key,
    code: input.code ?? "",
    metaKey: input.metaKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    shiftKey: input.shiftKey ?? false,
    altKey: input.altKey ?? false,
    repeat: input.repeat ?? false,
    target: input.target,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event as unknown as KeyboardEvent & { defaultPrevented: boolean };
}

function visualOf(editor: Editor, id: ElementId): Record<string, unknown> {
  return editor.store.get(id)?.visual as Record<string, unknown>;
}

// Every one of these asserts `history.batching` is false at the end. An
// unbalanced beginBatch does not throw: history quietly folds every later
// edit into a batch nobody commits, so undo is dead until the app restarts.
describe("the gesture state machine keeps history batches balanced", () => {
  test("a drag closes its batch and costs exactly one undo step", () => {
    const { editor, interaction, shape } = harness();
    const before = editor.history.undoSize;

    interaction.onPointerDown(pointer());
    for (let step = 1; step <= 5; step += 1) {
      interaction.onPointerMove(
        pointer({ clientX: 50 + step * 10, clientY: 50 + step * 10 }),
      );
    }
    interaction.onPointerUp(pointer({ clientX: 100, clientY: 100 }));

    expect(editor.history.batching).toBe(false);
    expect(editor.history.undoSize).toBe(before + 1);
    expect(visualOf(editor, shape)).toMatchObject({ x: 50, y: 50 });
    editor.undo();
    expect(visualOf(editor, shape)).toMatchObject({ x: 0, y: 0 });
  });

  test("a middle click during a drag does not open a second batch", () => {
    const { editor, interaction } = harness();

    interaction.onPointerDown(pointer());
    interaction.onPointerMove(pointer({ clientX: 80, clientY: 80 }));
    interaction.onPointerDown(pointer({ button: 1 }));
    interaction.onPointerUp(pointer({ button: 1 }));
    interaction.onPointerUp(pointer());

    expect(editor.history.batching).toBe(false);
    // Undo still reaches the drag rather than a stale pre-drag entry.
    expect(editor.canUndo()).toBe(true);
  });

  test("a second pointer is ignored rather than starting a gesture", () => {
    const { editor, interaction, shape } = harness();

    interaction.onPointerDown(pointer({ pointerId: 1 }));
    interaction.onPointerDown(pointer({ pointerId: 2 }));
    // The intruding pointer must not drive the gesture the first one owns.
    interaction.onPointerMove(pointer({ pointerId: 2, clientX: 900 }));
    expect(visualOf(editor, shape)).toMatchObject({ x: 0, y: 0 });

    interaction.onPointerMove(pointer({ pointerId: 1, clientX: 70 }));
    interaction.onPointerUp(pointer({ pointerId: 2 }));
    interaction.onPointerUp(pointer({ pointerId: 1, clientX: 70 }));

    expect(editor.history.batching).toBe(false);
    expect(visualOf(editor, shape)).toMatchObject({ x: 20, y: 0 });
  });

  test("edits after a stray pointer still reach the undo stack", () => {
    const { editor, interaction } = harness();

    interaction.onPointerDown(pointer({ pointerId: 1 }));
    interaction.onPointerDown(pointer({ pointerId: 2 }));
    interaction.onPointerUp(pointer({ pointerId: 1 }));
    interaction.onPointerUp(pointer({ pointerId: 2 }));

    const before = editor.history.undoSize;
    editor.createElement("shape.geo", { visual: { x: 300, y: 300 } });
    expect(editor.history.undoSize).toBe(before + 1);
    expect(editor.canUndo()).toBe(true);
  });

  test("a resize closes its batch and costs exactly one undo step", () => {
    const { editor, interaction, shape } = harness();
    const before = editor.history.undoSize;

    interaction.startResize(shape, "se", pointer());
    interaction.onPointerMove(pointer({ clientX: 150, clientY: 150 }));
    interaction.onPointerMove(pointer({ clientX: 200, clientY: 200 }));
    interaction.onPointerUp(pointer({ clientX: 200, clientY: 200 }));

    expect(editor.history.batching).toBe(false);
    expect(editor.history.undoSize).toBe(before + 1);
    expect(visualOf(editor, shape)).toMatchObject({ width: 250, height: 250 });
  });

  test("a pointer down on a handle mid-drag does not stack batches", () => {
    const { editor, interaction, shape } = harness();

    interaction.onPointerDown(pointer());
    interaction.onPointerMove(pointer({ clientX: 80, clientY: 80 }));
    interaction.startResize(shape, "se", pointer({ clientX: 80, clientY: 80 }));
    interaction.onPointerUp(pointer({ clientX: 80, clientY: 80 }));

    expect(editor.history.batching).toBe(false);
  });
});

describe("abandoning a gesture leaves no trace", () => {
  test("escape mid-drag puts the shape back and records nothing", () => {
    const { editor, interaction, shape } = harness();
    const before = editor.history.undoSize;

    interaction.onPointerDown(pointer());
    interaction.onPointerMove(pointer({ clientX: 150, clientY: 150 }));
    expect(visualOf(editor, shape)).toMatchObject({ x: 100, y: 100 });

    interaction.onKeyDown(keyboard("Escape"));
    interaction.onPointerUp(pointer({ clientX: 150, clientY: 150 }));

    expect(editor.history.batching).toBe(false);
    expect(editor.history.undoSize).toBe(before);
    expect(editor.canRedo()).toBe(false);
    expect(visualOf(editor, shape)).toMatchObject({ x: 0, y: 0 });
  });

  test("escape mid-resize restores the original box", () => {
    const { editor, interaction, shape } = harness();
    const before = editor.history.undoSize;

    interaction.startResize(shape, "se", pointer());
    interaction.onPointerMove(pointer({ clientX: 200, clientY: 200 }));
    expect(visualOf(editor, shape)).toMatchObject({ width: 250 });

    interaction.onKeyDown(keyboard("Escape"));
    interaction.onPointerUp(pointer({ clientX: 200, clientY: 200 }));

    expect(editor.history.batching).toBe(false);
    expect(editor.history.undoSize).toBe(before);
    expect(visualOf(editor, shape)).toMatchObject({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  test("escape returns to the select tool and clears the selection", () => {
    const { editor, interaction, tool } = harness();
    interaction.onKeyDown(keyboard("Escape"));
    expect(editor.selection.size).toBe(0);
    expect(tool()).toBe("select");
  });

  test("a cancelled pointer reverts the drag it was in the middle of", () => {
    const { editor, interaction, shape } = harness();
    const before = editor.history.undoSize;

    interaction.onPointerDown(pointer());
    interaction.onPointerMove(pointer({ clientX: 150, clientY: 150 }));
    interaction.onPointerCancel(pointer({ clientX: 150, clientY: 150 }));

    expect(editor.history.batching).toBe(false);
    expect(editor.history.undoSize).toBe(before);
    expect(visualOf(editor, shape)).toMatchObject({ x: 0, y: 0 });
  });
});

function wheel(input: {
  deltaY?: number;
  deltaX?: number;
  ctrlKey?: boolean;
  clientX?: number;
  clientY?: number;
}): WheelEvent {
  return {
    deltaX: input.deltaX ?? 0,
    deltaY: input.deltaY ?? 0,
    deltaMode: 0,
    ctrlKey: input.ctrlKey ?? false,
    metaKey: false,
    clientX: input.clientX ?? 0,
    clientY: input.clientY ?? 0,
    preventDefault: () => {},
  } as unknown as WheelEvent;
}

function shortcut(key: string, shiftKey = false): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: true,
    shiftKey,
    preventDefault: () => {},
  } as unknown as KeyboardEvent;
}

// The steps of the manual checklist in `apps/desktop/README.md` that need no
// browser. What is left there is what only a browser can supply: real hit
// areas, cursors, pointer capture and focus.
describe("checklist behaviour, driven headlessly", () => {
  test("step 2/5: empty-canvas drags brush; the hand tool pans", () => {
    const empty = new Editor();
    const { interaction } = interactionFor(empty, "select");

    // With the select tool, dragging empty canvas is a marquee, not a pan.
    interaction.onPointerDown(pointer({ clientX: 0, clientY: 0 }));
    interaction.onPointerMove(pointer({ clientX: 40, clientY: 25 }));
    expect(interaction.marquee()).toEqual({
      x: 0,
      y: 0,
      width: 40,
      height: 25,
    });
    interaction.onPointerUp(pointer({ clientX: 40, clientY: 25 }));
    expect(empty.camera.get()).toMatchObject({ x: 0, y: 0 });

    // The hand tool pans even when the drag starts over a shape.
    const held = harness();
    const hand = interactionFor(held.editor, "hand");
    hand.interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    hand.interaction.onPointerMove(pointer({ clientX: 60, clientY: 50 }));
    hand.interaction.onPointerUp(pointer({ clientX: 60, clientY: 50 }));
    expect(held.editor.camera.get().x).toBe(10);
    expect(visualOf(held.editor, held.shape)).toMatchObject({ x: 0, y: 0 });
  });

  test("step 3: ctrl + wheel zooms about the pointer and clamps", () => {
    const { editor, interaction } = harness();
    const anchor = { clientX: 200, clientY: 120 };
    const before = editor.camera.screenToPage({ x: 200, y: 120 });

    interaction.onWheel(wheel({ deltaY: -200, ctrlKey: true, ...anchor }));
    expect(editor.camera.get().z).toBeGreaterThan(1);
    const after = editor.camera.screenToPage({ x: 200, y: 120 });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);

    for (let i = 0; i < 40; i += 1) {
      interaction.onWheel(wheel({ deltaY: -400, ctrlKey: true, ...anchor }));
    }
    expect(editor.camera.get().z).toBe(8);
    for (let i = 0; i < 80; i += 1) {
      interaction.onWheel(wheel({ deltaY: 400, ctrlKey: true, ...anchor }));
    }
    expect(editor.camera.get().z).toBeCloseTo(0.1, 10);
  });

  test("step 4: a plain wheel pans without zooming", () => {
    const { editor, interaction } = harness();
    interaction.onWheel(wheel({ deltaY: 30, deltaX: 10 }));
    expect(editor.camera.get()).toMatchObject({ x: -10, y: -30, z: 1 });
  });

  test("step 6/7: click selects, shift-click extends", () => {
    const { editor, interaction, shape } = harness();
    const other = editor.createElement("shape.geo", {
      visual: { x: 400, y: 0, width: 100, height: 100 },
    });
    editor.selection.clear();

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 50, clientY: 50 }));
    expect([...editor.selection.ids()]).toEqual([shape]);

    interaction.onPointerDown(
      pointer({ clientX: 450, clientY: 50, shiftKey: true }),
    );
    interaction.onPointerUp(pointer({ clientX: 450, clientY: 50 }));
    expect(editor.selection.size).toBe(2);
    expect(editor.selection.has(other)).toBe(true);

    // Clicking empty canvas drops the selection.
    interaction.onPointerDown(pointer({ clientX: 900, clientY: 900 }));
    interaction.onPointerUp(pointer({ clientX: 900, clientY: 900 }));
    expect(editor.selection.size).toBe(0);
  });

  test("step 11/12: a creation tool places centred, selects, and resets", () => {
    const empty = new Editor();
    const { interaction, tool, setTool } = interactionFor(empty, "geo:ellipse");

    interaction.onPointerDown(pointer({ clientX: 300, clientY: 200 }));
    interaction.onPointerUp(pointer({ clientX: 300, clientY: 200 }));

    expect(empty.store.size).toBe(1);
    const [placed] = empty.store.listElements();
    if (!placed) {
      throw new Error("expected a placed element");
    }
    const box = empty.getBounds(placed.id);
    if (!box) {
      throw new Error("expected the placed element to have bounds");
    }
    expect(box.x + box.width / 2).toBeCloseTo(300, 6);
    expect(box.y + box.height / 2).toBeCloseTo(200, 6);
    expect(placed.semantic).toMatchObject({ geo: "ellipse" });
    expect([...empty.selection.ids()]).toEqual([placed.id]);
    expect(tool()).toBe("select");

    // The registry's default payload is used for the semantic element tools.
    setTool("erd.table");
    interaction.onPointerDown(pointer({ clientX: 700, clientY: 400 }));
    interaction.onPointerUp(pointer({ clientX: 700, clientY: 400 }));
    const table = empty.store
      .listElements()
      .find((element) => element.type === "erd.table");
    expect(table?.semantic).toMatchObject({ tableName: "table" });
  });

  test("step 13/14: the edge tool connects two shapes, and only two", () => {
    const { editor, shape } = harness();
    const other = editor.createElement("shape.geo", {
      visual: { x: 400, y: 0, width: 100, height: 100 },
    });
    const { interaction } = interactionFor(editor, "edge");

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    expect(interaction.pending()).not.toBeNull();
    interaction.onPointerMove(pointer({ clientX: 450, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 450, clientY: 50 }));

    const edges = editor.store
      .listElements()
      .filter((element) => element.type === "edge.generic");
    expect(edges).toHaveLength(1);
    expect(edges[0]?.semantic).toMatchObject({ from: shape, to: other });
    expect(interaction.pending()).toBeNull();

    // Releasing over empty canvas, or back over the source, creates nothing.
    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 900, clientY: 900 }));
    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 60, clientY: 60 }));
    expect(
      editor.store.listElements().filter((el) => el.type === "edge.generic"),
    ).toHaveLength(1);
  });

  test("step 16: delete takes the connectors with the shape", () => {
    const { editor, interaction, shape } = harness();
    const other = editor.createElement("shape.geo", {
      visual: { x: 400, y: 0, width: 100, height: 100 },
    });
    const edge = editor.connect(shape, other);
    expect(edge).not.toBeNull();

    editor.selection.set([shape]);
    interaction.onKeyDown(keyboard("Delete"));

    expect(editor.store.has(shape)).toBe(false);
    expect(editor.store.has(edge as ElementId)).toBe(false);
    expect(editor.store.has(other)).toBe(true);
    expect(editor.selection.size).toBe(0);

    // Step 17: one undo brings both back.
    interaction.onKeyDown(shortcut("z"));
    expect(editor.store.has(shape)).toBe(true);
    expect(editor.store.has(edge as ElementId)).toBe(true);
  });

  test("step 17/18: the undo and redo shortcuts both work", () => {
    const { editor, interaction, shape } = harness();
    interaction.onPointerDown(pointer());
    interaction.onPointerMove(pointer({ clientX: 90, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 90, clientY: 50 }));
    expect(visualOf(editor, shape)).toMatchObject({ x: 40 });

    interaction.onKeyDown(shortcut("z"));
    expect(visualOf(editor, shape)).toMatchObject({ x: 0 });
    interaction.onKeyDown(shortcut("z", true));
    expect(visualOf(editor, shape)).toMatchObject({ x: 40 });
    interaction.onKeyDown(shortcut("z"));
    interaction.onKeyDown(shortcut("y"));
    expect(visualOf(editor, shape)).toMatchObject({ x: 40 });
  });
});

describe("pointer ownership is released with the gesture, not the button", () => {
  test("a fresh pointer can act after Escape ended the previous gesture", () => {
    const { editor, interaction, shape } = harness();

    // Pointer 1 starts a drag and abandons it, but never lifts.
    interaction.onPointerDown(pointer({ pointerId: 1 }));
    interaction.onPointerMove(pointer({ pointerId: 1, clientX: 150 }));
    interaction.onKeyDown(keyboard("Escape"));

    // A touch device's next contact always brings a new id; the canvas must
    // not be wedged waiting for a finger that already lifted unnoticed.
    editor.selection.set([shape]);
    interaction.onPointerDown(pointer({ pointerId: 7 }));
    interaction.onPointerMove(pointer({ pointerId: 7, clientX: 80 }));
    interaction.onPointerUp(pointer({ pointerId: 7, clientX: 80 }));

    expect(editor.history.batching).toBe(false);
    expect(visualOf(editor, shape)).toMatchObject({ x: 30, y: 0 });
  });

  test("a fresh pointer still cannot interrupt a gesture in flight", () => {
    const { editor, interaction, shape } = harness();

    interaction.onPointerDown(pointer({ pointerId: 1 }));
    interaction.onPointerMove(pointer({ pointerId: 1, clientX: 90 }));
    // Mid-drag, so the batch is open: this contact must be refused.
    interaction.onPointerDown(pointer({ pointerId: 7, clientX: 400 }));
    interaction.onPointerMove(pointer({ pointerId: 7, clientX: 400 }));
    interaction.onPointerUp(pointer({ pointerId: 1, clientX: 90 }));

    expect(editor.history.batching).toBe(false);
    expect(visualOf(editor, shape)).toMatchObject({ x: 40, y: 0 });
  });
});

describe("marquee selection", () => {
  test("dragging on empty canvas brushes over elements and selects them", () => {
    const { editor, shape, interaction } = harness();
    editor.selection.clear();

    // Down well away from the shape, drag until the rect covers it.
    interaction.onPointerDown(pointer({ clientX: 300, clientY: 300 }));
    expect(interaction.marquee()).toEqual({
      x: 300,
      y: 300,
      width: 0,
      height: 0,
    });
    interaction.onPointerMove(pointer({ clientX: 320, clientY: 320 }));
    expect(editor.selection.has(shape)).toBe(false);

    interaction.onPointerMove(pointer({ clientX: 50, clientY: 50 }));
    // Live selection: the shape is picked up before the pointer lifts.
    expect(editor.selection.has(shape)).toBe(true);
    expect(interaction.marquee()).toEqual({
      x: 50,
      y: 50,
      width: 250,
      height: 250,
    });

    interaction.onPointerUp(pointer({ clientX: 50, clientY: 50 }));
    expect(editor.selection.has(shape)).toBe(true);
    expect(interaction.marquee()).toBeNull();
  });

  test("shift keeps the existing selection as the base", () => {
    const { editor, shape, interaction } = harness();
    const other = editor.createElement("shape.geo", {
      visual: { x: 500, y: 500, width: 40, height: 40 },
    });
    editor.selection.set([shape]);

    interaction.onPointerDown(
      pointer({ clientX: 480, clientY: 480, shiftKey: true }),
    );
    interaction.onPointerMove(pointer({ clientX: 560, clientY: 560 }));
    interaction.onPointerUp(pointer({ clientX: 560, clientY: 560 }));

    expect(editor.selection.has(shape)).toBe(true);
    expect(editor.selection.has(other)).toBe(true);
  });

  test("escape cancels the brush and restores the base selection", () => {
    const { editor, shape, interaction } = harness();
    editor.selection.clear();

    interaction.onPointerDown(pointer({ clientX: 300, clientY: 300 }));
    interaction.onPointerMove(pointer({ clientX: 50, clientY: 50 }));
    expect(editor.selection.has(shape)).toBe(true);

    interaction.onKeyDown(keyboard("Escape"));
    expect(interaction.marquee()).toBeNull();
    expect(editor.selection.size).toBe(0);
  });

  test("escape on a shift-marquee keeps the base selection alive", () => {
    const { editor, shape, interaction } = harness();
    editor.selection.set([shape]);

    interaction.onPointerDown(
      pointer({ clientX: 300, clientY: 300, shiftKey: true }),
    );
    interaction.onPointerMove(pointer({ clientX: 350, clientY: 350 }));
    interaction.onKeyDown(keyboard("Escape"));

    expect(interaction.marquee()).toBeNull();
    expect(editor.selection.has(shape)).toBe(true);
  });

  test("live selection notifies only when membership changes", () => {
    const { editor, shape, interaction } = harness();
    editor.selection.clear();
    let notifications = 0;
    const unsubscribe = editor.selection.subscribe(() => {
      notifications += 1;
    });

    interaction.onPointerDown(pointer({ clientX: 300, clientY: 300 }));
    // Many moves inside empty space: membership never changes, so the
    // selection must stay quiet — in cloud mode every notification becomes
    // an awareness publish.
    for (let i = 0; i < 10; i += 1) {
      interaction.onPointerMove(
        pointer({ clientX: 300 - i, clientY: 300 - i }),
      );
    }
    expect(notifications).toBe(0);

    interaction.onPointerMove(pointer({ clientX: 50, clientY: 50 }));
    expect(editor.selection.has(shape)).toBe(true);
    expect(notifications).toBe(1);

    interaction.onPointerUp(pointer({ clientX: 50, clientY: 50 }));
    unsubscribe();
  });

  test("reports the rectangle through onMarquee, ending with null", () => {
    const editor = new Editor();
    const seen: (unknown | null)[] = [];
    const interaction = createInteraction(editor, {
      tool: () => "select",
      setTool: () => {},
      container: () => undefined,
      onMarquee: (rect) => {
        seen.push(rect);
      },
    });
    interaction.onPointerDown(pointer({ clientX: 10, clientY: 10 }));
    interaction.onPointerMove(pointer({ clientX: 30, clientY: 40 }));
    interaction.onPointerUp(pointer({ clientX: 30, clientY: 40 }));
    expect(seen[0]).toEqual({ x: 10, y: 10, width: 0, height: 0 });
    expect(seen[1]).toEqual({ x: 10, y: 10, width: 20, height: 30 });
    expect(seen.at(-1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Editor UX wave 1 (design-docs/specs/editor-ux.md)

interface GroupedHarness extends Pick<Harness, "interaction" | "tool"> {
  readonly editor: Editor;
  readonly a: ElementId;
  readonly b: ElementId;
  readonly loose: ElementId;
  readonly group: ElementId;
}

/** Two grouped 100x100 shapes (at x=0 and x=200) plus a loose one far away. */
function grouped(): GroupedHarness {
  const editor = new Editor();
  const a = editor.createElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const b = editor.createElement("shape.geo", {
    visual: { x: 200, y: 0, width: 100, height: 100 },
  });
  const loose = editor.createElement("shape.geo", {
    visual: { x: 600, y: 600, width: 50, height: 50 },
  });
  editor.selection.set([a, b]);
  const group = editor.groupSelection();
  if (!group) {
    throw new Error("expected a group");
  }
  editor.selection.clear();
  return { editor, a, b, loose, group, ...interactionFor(editor, "select") };
}

describe("group-aware selection (design 3.1)", () => {
  test("clicking a member selects its group; the next click drills in", () => {
    const { editor, interaction, a, group } = grouped();

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 50, clientY: 50 }));
    expect([...editor.selection.ids()]).toEqual([group]);

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 50, clientY: 50 }));
    expect([...editor.selection.ids()]).toEqual([a]);
    expect(editor.history.batching).toBe(false);
  });

  test("dragging a selected group by a member moves every member", () => {
    const { editor, interaction, a, b, group } = grouped();
    editor.selection.set([group]);
    const before = editor.history.undoSize;

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerMove(pointer({ clientX: 80, clientY: 90 }));
    interaction.onPointerUp(pointer({ clientX: 80, clientY: 90 }));

    // A drag does not drill in: the group stays selected and moves whole.
    expect([...editor.selection.ids()]).toEqual([group]);
    expect(visualOf(editor, a)).toMatchObject({ x: 30, y: 40 });
    expect(visualOf(editor, b)).toMatchObject({ x: 230, y: 40 });
    expect(editor.history.undoSize).toBe(before + 1);
    expect(editor.history.batching).toBe(false);
  });

  test("escape drills back out to the group, then deselects", () => {
    const { editor, interaction, a, group } = grouped();
    editor.selection.set([a]);

    interaction.onKeyDown(keyboard("Escape"));
    expect([...editor.selection.ids()]).toEqual([group]);
    interaction.onKeyDown(keyboard("Escape"));
    expect(editor.selection.size).toBe(0);
  });

  test("a marquee picks up groups rather than their members", () => {
    const { editor, interaction, group } = grouped();

    interaction.onPointerDown(pointer({ clientX: -20, clientY: -20 }));
    interaction.onPointerMove(pointer({ clientX: 120, clientY: 120 }));
    expect([...editor.selection.ids()]).toEqual([group]);
    interaction.onPointerUp(pointer({ clientX: 120, clientY: 120 }));
    expect([...editor.selection.ids()]).toEqual([group]);
  });

  test("cmd+a selects the page's top-level elements", () => {
    const { editor, interaction, group, loose } = grouped();
    interaction.onKeyDown(keyboard("a", { metaKey: true }));
    expect(new Set(editor.selection.ids())).toEqual(new Set([group, loose]));
  });

  test("a plain click on one of several selected shapes narrows to it", () => {
    const { editor, interaction, loose, group } = grouped();
    editor.selection.set([group, loose]);

    interaction.onPointerDown(pointer({ clientX: 610, clientY: 610 }));
    interaction.onPointerUp(pointer({ clientX: 610, clientY: 610 }));
    expect([...editor.selection.ids()]).toEqual([loose]);
  });
});

describe("snapping (design 6)", () => {
  const OBJECTS = () => ({ grid: false, objects: true });
  const GRID = () => ({ grid: true, objects: false });

  /** A selected box at the origin and a neighbour whose left edge is x=300. */
  function neighbours(snap: () => { grid: boolean; objects: boolean }) {
    const editor = new Editor();
    const moving = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    // Vertically far away so only the x lines can match.
    const other = editor.createElement("shape.geo", {
      visual: { x: 300, y: 400, width: 100, height: 100 },
    });
    editor.selection.set([moving]);
    return {
      editor,
      moving,
      other,
      ...interactionFor(editor, "select", { snap }),
    };
  }

  test("a translate lands flush with a neighbour and reports one guide", () => {
    const { editor, interaction, moving } = neighbours(OBJECTS);

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    // Right edge would be at 295: five units short of the neighbour's 300.
    interaction.onPointerMove(pointer({ clientX: 245, clientY: 50 }));
    expect(visualOf(editor, moving)).toMatchObject({ x: 200, y: 0 });
    expect(interaction.guides()).toHaveLength(1);
    expect(interaction.guides()[0]).toMatchObject({ axis: "x", at: 300 });

    interaction.onPointerUp(pointer({ clientX: 245, clientY: 50 }));
    expect(interaction.guides()).toHaveLength(0);
    expect(visualOf(editor, moving)).toMatchObject({ x: 200 });
    expect(editor.history.batching).toBe(false);
  });

  test("holding cmd/ctrl during the drag disables snapping", () => {
    const { editor, interaction, moving } = neighbours(OBJECTS);

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerMove(
      pointer({ clientX: 245, clientY: 50, metaKey: true }),
    );
    expect(visualOf(editor, moving)).toMatchObject({ x: 195 });
    expect(interaction.guides()).toHaveLength(0);
    interaction.onPointerUp(pointer({ clientX: 245, clientY: 50 }));
  });

  test("beyond the threshold nothing snaps", () => {
    const { editor, interaction, moving } = neighbours(OBJECTS);

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerMove(pointer({ clientX: 230, clientY: 50 }));
    expect(visualOf(editor, moving)).toMatchObject({ x: 180 });
    expect(interaction.guides()).toHaveLength(0);
    interaction.onPointerUp(pointer({ clientX: 230, clientY: 50 }));
  });

  test("grid snapping rounds the top-left corner onto the 24 grid", () => {
    const { editor, interaction, moving } = neighbours(GRID);

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerMove(pointer({ clientX: 80, clientY: 90 }));
    expect(visualOf(editor, moving)).toMatchObject({ x: 24, y: 48 });
    // Grid snaps draw no guide: there is no neighbour to point at.
    expect(interaction.guides()).toHaveLength(0);
    interaction.onPointerUp(pointer({ clientX: 80, clientY: 90 }));
  });

  test("a group drags as one box: the union snaps, every member moves", () => {
    const { editor, a, b, group } = grouped();
    const wall = editor.createElement("shape.geo", {
      visual: { x: 500, y: 400, width: 40, height: 40 },
    });
    editor.selection.set([group]);
    const { interaction } = interactionFor(editor, "select", { snap: OBJECTS });

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    // The union's right edge (300) moves to 495, five short of the wall.
    interaction.onPointerMove(pointer({ clientX: 245, clientY: 50 }));
    expect(visualOf(editor, a)).toMatchObject({ x: 200 });
    expect(visualOf(editor, b)).toMatchObject({ x: 400 });
    expect(visualOf(editor, wall)).toMatchObject({ x: 500 });
    interaction.onPointerUp(pointer({ clientX: 245, clientY: 50 }));
  });

  test("a resize snaps only the edge the handle owns", () => {
    const { editor, interaction, moving } = neighbours(OBJECTS);

    interaction.startResize(
      moving,
      "e",
      pointer({ clientX: 100, clientY: 50 }),
    );
    interaction.onPointerMove(pointer({ clientX: 295, clientY: 50 }));
    expect(visualOf(editor, moving)).toMatchObject({ x: 0, width: 300 });
    expect(interaction.guides()).toHaveLength(1);
    interaction.onPointerUp(pointer({ clientX: 295, clientY: 50 }));
    expect(interaction.guides()).toHaveLength(0);
    expect(editor.history.batching).toBe(false);
  });

  test("shift keeps the aspect ratio while resizing", () => {
    const { editor, interaction, moving } = neighbours(() => ({
      grid: false,
      objects: false,
    }));

    interaction.startResize(
      moving,
      "e",
      pointer({ clientX: 100, clientY: 50 }),
    );
    interaction.onPointerMove(
      pointer({ clientX: 200, clientY: 50, shiftKey: true }),
    );
    expect(visualOf(editor, moving)).toMatchObject({
      width: 200,
      height: 200,
      y: -50,
    });
    interaction.onPointerUp(pointer({ clientX: 200, clientY: 50 }));
  });
});

describe("resizeBoxConstrained", () => {
  test("without modifiers it is resizeBox", () => {
    expect(resizeBoxConstrained(START, "se", 20, 30)).toEqual(
      resizeBox(START, "se", 20, 30),
    );
    expect(resizeBoxConstrained(START, "nw", 20, 30)).toEqual(
      resizeBox(START, "nw", 20, 30),
    );
  });

  test("keepAspect follows the dominant axis and pins the opposite side", () => {
    // START is 200x100 at (100,100): aspect 2.
    expect(
      resizeBoxConstrained(START, "e", 100, 0, { keepAspect: true }),
    ).toEqual({ x: 100, y: 75, width: 300, height: 150 });
    expect(
      resizeBoxConstrained(START, "se", 100, 0, { keepAspect: true }),
    ).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    expect(
      resizeBoxConstrained(START, "nw", 0, -100, { keepAspect: true }),
    ).toEqual({ x: -100, y: 0, width: 400, height: 200 });
  });

  test("fromCenter mirrors the owned edge onto its opposite", () => {
    expect(
      resizeBoxConstrained(START, "e", 50, 0, { fromCenter: true }),
    ).toEqual({ x: 50, y: 100, width: 300, height: 100 });
    expect(
      resizeBoxConstrained(START, "n", 0, -10, { fromCenter: true }),
    ).toEqual({ x: 100, y: 90, width: 200, height: 120 });
  });

  test("both together scale about the centre", () => {
    expect(
      resizeBoxConstrained(START, "se", 100, 0, {
        keepAspect: true,
        fromCenter: true,
      }),
    ).toEqual({ x: 0, y: 50, width: 400, height: 200 });
  });

  test("still respects the minimum size", () => {
    const tiny = resizeBoxConstrained(START, "se", -1000, -1000, {
      keepAspect: true,
      fromCenter: true,
    });
    expect(tiny.width).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
    expect(tiny.height).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
  });
});

/** A scheduler the test fires by hand, standing in for setTimeout. */
function manualScheduler(): { schedule: Scheduler; fire: () => void } {
  const pending: (() => void)[] = [];
  const schedule: Scheduler = (callback) => {
    pending.push(callback);
    return () => {
      const at = pending.indexOf(callback);
      if (at >= 0) {
        pending.splice(at, 1);
      }
    };
  };
  return {
    schedule,
    fire: () => {
      for (const callback of pending.splice(0)) {
        callback();
      }
    },
  };
}

describe("arrow-key nudges coalesce (design 3.2)", () => {
  test("presses within the window collapse into one undo step", () => {
    const editor = new Editor();
    const shape = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    editor.selection.set([shape]);
    const timer = manualScheduler();
    const { interaction } = interactionFor(editor, "select", {
      schedule: timer.schedule,
    });
    const before = editor.history.undoSize;

    interaction.onKeyDown(keyboard("ArrowRight"));
    interaction.onKeyDown(keyboard("ArrowRight"));
    interaction.onKeyDown(keyboard("ArrowRight"));
    interaction.onKeyDown(keyboard("ArrowDown", { shiftKey: true }));
    expect(visualOf(editor, shape)).toMatchObject({ x: 3, y: NUDGE_GRID_STEP });
    expect(editor.history.batching).toBe(true);

    timer.fire();
    expect(editor.history.batching).toBe(false);
    expect(editor.history.undoSize).toBe(before + 1);
    editor.undo();
    expect(visualOf(editor, shape)).toMatchObject({ x: 0, y: 0 });
  });

  test("any other edit closes the nudge batch before it runs", () => {
    const editor = new Editor();
    const shape = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    editor.selection.set([shape]);
    const timer = manualScheduler();
    const { interaction } = interactionFor(editor, "select", {
      schedule: timer.schedule,
    });
    const before = editor.history.undoSize;

    interaction.onKeyDown(keyboard("ArrowLeft"));
    interaction.onKeyDown(keyboard("Delete"));
    expect(editor.history.batching).toBe(false);
    // Two steps: the nudge, then the delete.
    expect(editor.history.undoSize).toBe(before + 2);
    // The timer, if it still fired, must not touch history.
    timer.fire();
    expect(editor.history.batching).toBe(false);
    editor.undo();
    expect(editor.store.has(shape)).toBe(true);
    expect(visualOf(editor, shape)).toMatchObject({ x: -1 });
  });

  test("a pointer gesture after a nudge gets its own batch", () => {
    const editor = new Editor();
    const shape = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    editor.selection.set([shape]);
    const timer = manualScheduler();
    const { interaction } = interactionFor(editor, "select", {
      schedule: timer.schedule,
    });
    const before = editor.history.undoSize;

    interaction.onKeyDown(keyboard("ArrowRight"));
    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerMove(pointer({ clientX: 90, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 90, clientY: 50 }));
    expect(editor.history.batching).toBe(false);
    expect(editor.history.undoSize).toBe(before + 2);
    expect(visualOf(editor, shape)).toMatchObject({ x: 41 });
  });

  test("with nothing selected the arrows are left to the browser", () => {
    const editor = new Editor();
    const { interaction } = interactionFor(editor, "select");
    const event = keyboard("ArrowUp");
    interaction.onKeyDown(event);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.history.batching).toBe(false);
  });
});

describe("keyboard map (design 5)", () => {
  test("tool letters switch tools, but not while typing in a field", () => {
    const { interaction, tool } = harness();
    const expected: readonly (readonly [string, ToolKind])[] = [
      ["r", "geo:rect"],
      ["o", "geo:ellipse"],
      ["d", "geo:diamond"],
      ["n", "node.generic"],
      ["t", "text.note"],
      ["l", "edge"],
      ["h", "hand"],
      ["v", "select"],
    ];
    for (const [key, kind] of expected) {
      interaction.onKeyDown(keyboard(key));
      expect(tool()).toBe(kind);
    }

    interaction.onKeyDown(keyboard("r", { target: { tagName: "INPUT" } }));
    expect(tool()).toBe("select");
    interaction.onKeyDown(
      keyboard("r", { target: { tagName: "DIV", isContentEditable: true } }),
    );
    expect(tool()).toBe("select");
    // Shifted letters are not tool keys.
    interaction.onKeyDown(keyboard("R", { shiftKey: true }));
    expect(tool()).toBe("select");
  });

  test("holding space pans with the select tool and lets go on keyup", () => {
    const { editor, interaction, shape, tool } = harness();

    const down = keyboard(" ", { code: "Space" });
    interaction.onKeyDown(down);
    expect(down.defaultPrevented).toBe(true);
    expect(tool()).toBe("hand");
    expect(interaction.temporaryHand()).toBe(true);
    // Key repeat must not re-capture the "previous" tool as hand.
    interaction.onKeyDown(keyboard(" ", { code: "Space", repeat: true }));

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 50 }));
    interaction.onPointerMove(pointer({ clientX: 60, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 60, clientY: 50 }));
    expect(editor.camera.get().x).toBe(10);
    expect(visualOf(editor, shape)).toMatchObject({ x: 0 });

    interaction.onKeyUp(keyboard(" ", { code: "Space" }));
    expect(tool()).toBe("select");
    expect(interaction.temporaryHand()).toBe(false);
  });

  test("the select tool comes back even if space was held from another tool", () => {
    const { interaction, tool, setTool } = harness();
    setTool("geo:rect");
    interaction.onKeyDown(keyboard(" "));
    expect(tool()).toBe("hand");
    interaction.onKeyUp(keyboard(" "));
    expect(tool()).toBe("geo:rect");
  });

  test("clipboard, duplicate and group chords reach the editor", () => {
    const { editor, interaction, shape } = harness();
    const other = editor.createElement("shape.geo", {
      visual: { x: 300, y: 0, width: 100, height: 100 },
    });
    editor.selection.set([shape, other]);

    interaction.onKeyDown(keyboard("d", { metaKey: true }));
    expect(editor.store.size).toBe(4);

    interaction.onKeyDown(keyboard("g", { metaKey: true }));
    const group = [...editor.selection.ids()];
    expect(group).toHaveLength(1);
    expect(editor.store.get(group[0] as ElementId)?.type).toBe("group");
    interaction.onKeyDown(keyboard("g", { metaKey: true, shiftKey: true }));
    expect(editor.selection.size).toBe(2);

    editor.selection.set([shape]);
    interaction.onKeyDown(keyboard("c", { ctrlKey: true }));
    expect(editor.canPaste()).toBe(true);
    interaction.onKeyDown(keyboard("v", { ctrlKey: true }));
    expect(editor.store.size).toBe(5);
    interaction.onKeyDown(keyboard("x", { ctrlKey: true }));
    expect(editor.store.size).toBe(4);
  });

  test("z-order keys with and without the modifier", () => {
    const { editor, interaction, shape } = harness();
    const above = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const top = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const order = () =>
      editor.store
        .getPageElements(editor.currentPageId)
        .map((element) => element.id);
    editor.selection.set([shape]);

    interaction.onKeyDown(keyboard("]"));
    expect(order()).toEqual([above, shape, top]);
    interaction.onKeyDown(keyboard("]", { metaKey: true }));
    expect(order()).toEqual([above, top, shape]);
    interaction.onKeyDown(keyboard("["));
    expect(order()).toEqual([above, shape, top]);
    interaction.onKeyDown(keyboard("[", { metaKey: true }));
    expect(order()).toEqual([shape, above, top]);
  });

  test("zoom chords step about the viewport centre; shift+1 fits", () => {
    const { editor, interaction } = harness();
    const viewport = { width: 800, height: 600 };
    const zoomed = interactionFor(editor, "select", {
      viewport: () => viewport,
    });

    zoomed.interaction.onKeyDown(keyboard("=", { metaKey: true }));
    expect(editor.camera.get().z).toBe(1.25);
    const centre = editor.camera.screenToPage({ x: 400, y: 300 });
    zoomed.interaction.onKeyDown(keyboard("=", { metaKey: true }));
    expect(editor.camera.get().z).toBe(1.5);
    const after = editor.camera.screenToPage({ x: 400, y: 300 });
    expect(after.x).toBeCloseTo(centre.x, 6);
    expect(after.y).toBeCloseTo(centre.y, 6);
    zoomed.interaction.onKeyDown(keyboard("-", { metaKey: true }));
    expect(editor.camera.get().z).toBe(1.25);
    zoomed.interaction.onKeyDown(keyboard("0", { metaKey: true }));
    expect(editor.camera.get().z).toBe(1);

    editor.camera.set({ x: 900, y: 900, z: 3 });
    zoomed.interaction.onKeyDown(
      keyboard("!", { shiftKey: true, code: "Digit1" }),
    );
    // Fit never zooms past 100 % and centres the content.
    expect(editor.camera.get().z).toBe(1);
    const shown = editor.camera.pageToScreen({ x: 50, y: 50 });
    expect(shown.x).toBeCloseTo(400, 6);
    expect(shown.y).toBeCloseTo(300, 6);

    zoomed.interaction.onKeyDown(
      keyboard("@", { shiftKey: true, code: "Digit2" }),
    );
    expect(editor.camera.get().z).toBe(4);
    // The plain interaction (no viewport, no container) leaves the camera be.
    interaction.onKeyDown(keyboard("0", { metaKey: true }));
    expect(editor.camera.get().z).toBe(1);
  });

  test("cmd+shift+e is left for the shell", () => {
    const { interaction } = harness();
    const event = keyboard("e", { metaKey: true, shiftKey: true });
    interaction.onKeyDown(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("edit requests (design 3.3)", () => {
  function editing(editor: Editor, tool: ToolKind = "select") {
    const requests: (readonly [ElementId, EditRegion])[] = [];
    const bound = interactionFor(editor, tool, {
      onEditRequest: (id, region) => {
        requests.push([id, region]);
      },
    });
    return { requests, ...bound };
  }

  test("double-click on an erd.table reports the title or the row", () => {
    const editor = new Editor();
    const table = editor.createElement("erd.table", {
      visual: { x: 0, y: 0, width: 240 },
      semantic: {
        tableName: "users",
        columns: [
          { id: "id", name: "id", dataType: "uuid", pk: true },
          { id: "name", name: "name", dataType: "text" },
          { id: "email", name: "email", dataType: "text" },
        ],
      },
    });
    const { interaction, requests } = editing(editor);

    interaction.onDoubleClick(mouse(20, 10));
    interaction.onDoubleClick(mouse(20, 32 + 24 * 1 + 5));
    interaction.onDoubleClick(mouse(20, 32 + 24 * 2 + 23));
    expect(requests).toEqual([
      [table, "title"],
      [table, { row: 1 }],
      [table, { row: 2 }],
    ]);
    // Empty canvas asks for nothing.
    interaction.onDoubleClick(mouse(900, 900));
    expect(requests).toHaveLength(3);
  });

  test("uml.class rows count attributes then methods", () => {
    const editor = new Editor();
    const id = editor.createElement("uml.class", {
      visual: { x: 0, y: 0, width: 200 },
      semantic: {
        name: "Account",
        attributes: [
          { id: "a1", name: "id" },
          { id: "a2", name: "owner" },
        ],
        methods: [{ id: "m1", name: "close" }],
      },
    });
    const element = editor.store.get(id);
    const box = editor.getBounds(id);
    if (!element || !box) {
      throw new Error("expected the class to have bounds");
    }
    const at = (y: number) => editRegionAt(element, box, { x: 10, y });
    expect(at(10)).toBe("title");
    expect(at(32 + 5)).toEqual({ row: 0 });
    expect(at(32 + 22 + 5)).toEqual({ row: 1 });
    expect(at(32 + 44 + 5)).toEqual({ row: 2 });

    const bare = editor.createElement("uml.class", {
      semantic: { name: "Empty", attributes: [], methods: [] },
    });
    const bareElement = editor.store.get(bare);
    const bareBox = editor.getBounds(bare);
    if (!bareElement || !bareBox) {
      throw new Error("expected the class to have bounds");
    }
    // The reserved blank compartments are body, not a row that does not exist.
    expect(editRegionAt(bareElement, bareBox, { x: 10, y: 40 })).toBe("body");
    expect(editRegionAt(bareElement, bareBox, { x: 10, y: 60 })).toBe("body");
  });

  test("shapes and connectors report the body", () => {
    const editor = new Editor();
    const a = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const b = editor.createElement("shape.geo", {
      visual: { x: 400, y: 0, width: 100, height: 100 },
    });
    const edge = editor.connect(a, b) as ElementId;
    const { interaction, requests } = editing(editor);

    interaction.onDoubleClick(mouse(50, 50));
    interaction.onDoubleClick(mouse(250, 50));
    expect(requests).toEqual([
      [a, "body"],
      [edge, "body"],
    ]);
  });

  test("enter and F2 edit the single selected editable element", () => {
    const { editor, shape } = harness();
    const other = editor.createElement("shape.geo", {
      visual: { x: 300, y: 0, width: 100, height: 100 },
    });
    const { interaction, requests } = editing(editor);

    interaction.onKeyDown(keyboard("Enter"));
    interaction.onKeyDown(keyboard("F2"));
    expect(requests).toEqual([
      [shape, "body"],
      [shape, "body"],
    ]);

    editor.selection.set([shape, other]);
    interaction.onKeyDown(keyboard("Enter"));
    expect(requests).toHaveLength(2);
  });

  test("placing a text note or node opens the editor immediately", () => {
    const editor = new Editor();
    const { interaction, requests, tool, setTool } = editing(
      editor,
      "text.note",
    );

    interaction.onPointerDown(pointer({ clientX: 300, clientY: 200 }));
    interaction.onPointerUp(pointer({ clientX: 300, clientY: 200 }));
    const [note] = editor.store.listElements();
    expect(note?.type).toBe("text.note");
    expect(note?.semantic).toEqual({ text: "" });
    expect(requests).toEqual([[note?.id as ElementId, "body"]]);
    expect(tool()).toBe("select");

    setTool("node.generic");
    interaction.onPointerDown(pointer({ clientX: 700, clientY: 200 }));
    interaction.onPointerUp(pointer({ clientX: 700, clientY: 200 }));
    expect(requests).toHaveLength(2);

    setTool("erd.table");
    interaction.onPointerDown(pointer({ clientX: 700, clientY: 600 }));
    interaction.onPointerUp(pointer({ clientX: 700, clientY: 600 }));
    expect(requests).toHaveLength(2);
  });

  test("a pointer down inside the slot layer starts nothing", () => {
    const { editor, interaction, shape } = harness();
    editor.selection.clear();
    const inSlot = {
      closest: (selector: string) =>
        selector === ".diagra-slot-layer" ? {} : null,
    };
    interaction.onPointerDown(
      pointer({ clientX: 50, clientY: 50, target: inSlot }),
    );
    interaction.onPointerMove(pointer({ clientX: 90, clientY: 50 }));
    interaction.onPointerUp(pointer({ clientX: 90, clientY: 50 }));
    expect(editor.selection.size).toBe(0);
    expect(visualOf(editor, shape)).toMatchObject({ x: 0 });
  });
});

describe("context menu (design 3.6)", () => {
  function withMenu(editor: Editor) {
    const calls: {
      readonly at: { readonly screen: unknown; readonly page: unknown };
      readonly hit: ElementId | null;
    }[] = [];
    const bound = interactionFor(editor, "select", {
      onContextMenu: (at, hit) => {
        calls.push({ at, hit });
      },
    });
    return { calls, ...bound };
  }

  test("right-click selects the hit and suppresses the browser menu", () => {
    const { editor, shape } = harness();
    editor.selection.clear();
    const { interaction, calls } = withMenu(editor);

    const event = mouse(50, 50);
    interaction.onContextMenu(event);
    expect(event.defaultPrevented).toBe(true);
    expect([...editor.selection.ids()]).toEqual([shape]);
    expect(calls[0]).toEqual({
      at: { screen: { x: 50, y: 50 }, page: { x: 50, y: 50 } },
      hit: shape,
    });

    // Empty canvas reports no hit and leaves the selection alone.
    interaction.onContextMenu(mouse(900, 900));
    expect(calls[1]?.hit).toBeNull();
    expect([...editor.selection.ids()]).toEqual([shape]);
  });

  test("right-click on a member of a selected group keeps the group", () => {
    const { editor, group } = grouped();
    editor.selection.set([group]);
    const { interaction, calls } = withMenu(editor);

    interaction.onContextMenu(mouse(50, 50));
    expect(calls[0]?.hit).toBe(group);
    expect([...editor.selection.ids()]).toEqual([group]);
  });

  test("shift+F10 opens on the selection's centre", () => {
    const { editor, shape } = harness();
    const { interaction, calls } = withMenu(editor);

    interaction.onKeyDown(keyboard("F10", { shiftKey: true }));
    expect(calls[0]).toEqual({
      at: { screen: { x: 50, y: 50 }, page: { x: 50, y: 50 } },
      hit: shape,
    });
  });
});

describe("connector handles (design 3.4)", () => {
  /** a at the origin, b to the right, c below a; an edge from a to b. */
  function wired() {
    const editor = new Editor();
    const a = editor.createElement("shape.geo", {
      visual: { x: 0, y: 0, width: 100, height: 100 },
    });
    const b = editor.createElement("shape.geo", {
      visual: { x: 400, y: 0, width: 100, height: 100 },
    });
    const c = editor.createElement("shape.geo", {
      visual: { x: 0, y: 400, width: 100, height: 100 },
    });
    const edge = editor.connect(a, b);
    if (!edge) {
      throw new Error("expected an edge");
    }
    editor.selection.set([edge]);
    return { editor, a, b, c, edge, ...interactionFor(editor, "select") };
  }

  test("dragging an end onto another shape rewrites that end in one step", () => {
    const { editor, interaction, a, b, c, edge } = wired();
    const before = editor.history.undoSize;

    interaction.startReconnect(
      edge,
      "to",
      pointer({ clientX: 400, clientY: 50 }),
    );
    expect(interaction.pending()).not.toBeNull();
    interaction.onPointerMove(pointer({ clientX: 50, clientY: 450 }));
    expect(interaction.hoverTarget()).toBe(c);
    interaction.onPointerUp(pointer({ clientX: 50, clientY: 450 }));

    expect(editor.store.get(edge)?.semantic).toMatchObject({ from: a, to: c });
    expect(editor.history.undoSize).toBe(before + 1);
    expect(editor.history.batching).toBe(false);
    expect(interaction.hoverTarget()).toBeNull();
    expect(interaction.pending()).toBeNull();

    editor.undo();
    expect(editor.store.get(edge)?.semantic).toMatchObject({ from: a, to: b });
  });

  test("dropping on nothing, or on the other end, changes nothing", () => {
    const { editor, interaction, a, b, edge } = wired();
    const before = editor.history.undoSize;

    interaction.startReconnect(
      edge,
      "from",
      pointer({ clientX: 100, clientY: 50 }),
    );
    interaction.onPointerUp(pointer({ clientX: 900, clientY: 900 }));
    expect(editor.store.get(edge)?.semantic).toMatchObject({ from: a, to: b });

    // The fixed end is never a target: a and b must stay distinct.
    interaction.startReconnect(
      edge,
      "from",
      pointer({ clientX: 100, clientY: 50 }),
    );
    interaction.onPointerMove(pointer({ clientX: 450, clientY: 50 }));
    expect(interaction.hoverTarget()).toBeNull();
    interaction.onPointerUp(pointer({ clientX: 450, clientY: 50 }));
    expect(editor.store.get(edge)?.semantic).toMatchObject({ from: a, to: b });

    expect(editor.history.undoSize).toBe(before);
    expect(editor.history.batching).toBe(false);
  });

  test("escape mid-drag cancels the reconnect", () => {
    const { editor, interaction, a, b, edge } = wired();
    interaction.startReconnect(
      edge,
      "to",
      pointer({ clientX: 400, clientY: 50 }),
    );
    interaction.onPointerMove(pointer({ clientX: 50, clientY: 450 }));
    interaction.onKeyDown(keyboard("Escape"));
    expect(interaction.pending()).toBeNull();
    interaction.onPointerUp(pointer({ clientX: 50, clientY: 450 }));
    expect(editor.store.get(edge)?.semantic).toMatchObject({ from: a, to: b });
  });

  test("an erd.relation end becomes a table endpoint with no column", () => {
    const editor = new Editor();
    const t1 = editor.createElement("erd.table", { visual: { x: 0, y: 0 } });
    const t2 = editor.createElement("erd.table", { visual: { x: 600, y: 0 } });
    const t3 = editor.createElement("erd.table", { visual: { x: 0, y: 400 } });
    const relation = editor.connectSmart(t1, t2);
    if (!relation) {
      throw new Error("expected a relation");
    }
    editor.apply([
      {
        type: "updateSemantic",
        id: relation,
        semantic: {
          from: { table: t1, column: "id" },
          to: { table: t2 },
          cardinality: "1:*",
        },
      },
    ]);
    const { interaction } = interactionFor(editor, "select");

    interaction.startReconnect(
      relation,
      "from",
      pointer({ clientX: 240, clientY: 28 }),
    );
    interaction.onPointerMove(pointer({ clientX: 100, clientY: 420 }));
    expect(interaction.hoverTarget()).toBe(t3);
    interaction.onPointerUp(pointer({ clientX: 100, clientY: 420 }));

    expect(editor.store.get(relation)?.semantic).toEqual({
      from: { table: t3 },
      to: { table: t2 },
      cardinality: "1:*",
    });
  });

  test("a connect handle drag creates an erd.relation between two tables", () => {
    const editor = new Editor();
    const t1 = editor.createElement("erd.table", { visual: { x: 0, y: 0 } });
    const t2 = editor.createElement("erd.table", { visual: { x: 600, y: 0 } });
    editor.selection.set([t1]);
    const { interaction, tool } = interactionFor(editor, "select");

    // From the handle just above t1's top edge.
    interaction.startConnect(t1, pointer({ clientX: 120, clientY: -14 }));
    expect(interaction.pending()).not.toBeNull();
    interaction.onPointerMove(pointer({ clientX: 700, clientY: 20 }));
    expect(interaction.hoverTarget()).toBe(t2);
    interaction.onPointerUp(pointer({ clientX: 700, clientY: 20 }));

    const relations = editor.store
      .listElements()
      .filter((element) => element.type === "erd.relation");
    expect(relations).toHaveLength(1);
    expect(relations[0]?.semantic).toMatchObject({
      from: { table: t1 },
      to: { table: t2 },
    });
    expect([...editor.selection.ids()]).toEqual([relations[0]?.id]);
    expect(tool()).toBe("select");
    expect(interaction.hoverTarget()).toBeNull();
    expect(editor.history.batching).toBe(false);

    // Letting go over empty canvas creates nothing.
    interaction.startConnect(t1, pointer({ clientX: 120, clientY: -14 }));
    interaction.onPointerUp(pointer({ clientX: 900, clientY: 900 }));
    expect(editor.store.size).toBe(3);
  });

  test("the edge tool also picks the connector type from the endpoints", () => {
    const editor = new Editor();
    const c1 = editor.createElement("uml.class", { visual: { x: 0, y: 0 } });
    const c2 = editor.createElement("uml.class", { visual: { x: 600, y: 0 } });
    const { interaction } = interactionFor(editor, "edge");

    interaction.onPointerDown(pointer({ clientX: 50, clientY: 20 }));
    interaction.onPointerMove(pointer({ clientX: 650, clientY: 20 }));
    interaction.onPointerUp(pointer({ clientX: 650, clientY: 20 }));

    const created = editor.store
      .listElements()
      .find((element) => element.type === "uml.association");
    expect(created?.semantic).toMatchObject({
      from: c1,
      to: c2,
      kind: "assoc",
    });
  });
});
