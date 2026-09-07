import { beforeEach, describe, expect, test } from "bun:test";
import {
  Editor,
  measureTextNote,
  copySelectionStyle,
  pasteSelectionStyle,
  renameSelectedLayers,
  replaceSelectedNoteText,
  swapArtboardOrientation,
  addComponentVariantProperty,
  addLayoutGrid,
  addPageGuide,
  insertUiBlock,
  pageGuides,
  bindSelectionColor,
  createColorToken,
  createReviewComment,
  moveReviewComment,
  createSelectionResizeSnapshot,
  createTextStyle,
  setColorTokenAlias,
  setElementFillGradient,
  setElementStrokeGradient,
  setGroupMask,
  bindSelectionNumber,
  createNumberToken,
  replyToReviewComment,
  resizeSelection,
  rotateElement,
  rotateSelectionBy,
  setReviewCommentResolved,
  bindSelectionTextStyle,
  updateTextStyle,
  updateNumberToken,
  updateColorToken,
  updateLayoutGrid,
  updatePageGuide,
  updateComponentVariantProperty,
} from "@diagra/core";
import type {
  Document,
  Element,
  ErdTableSemantic,
  FrameSemantic,
  FillGradient,
  GenericEdgeSemantic,
  GroupSemantic,
  ImageSemantic,
  LayerEffect,
  Page,
  TypographyStyleValue,
} from "@diagra/ir";
import * as Y from "yjs";
import { parseDocument, serializeDocument } from "@diagra/io";
import { CollabBinding } from "./binding.ts";
import { erdDocument, freeformDocument } from "./test-fixtures.ts";
import { ELEMENTS_KEY, PAGES_KEY, applyIrToDoc, ydocToIr } from "./ydoc.ts";

/** Origin every relayed update carries; never any binding's local origin. */
const WIRE = Symbol("wire");

/**
 * Two docs joined by a hand-cranked wire.
 *
 * Updates queue instead of being delivered, so a test can hold both peers'
 * edits in flight at once — which is the only way to write down "concurrent"
 * without real sockets.
 */
class Wire {
  private readonly pending = new Map<Y.Doc, Uint8Array[]>();
  private readonly docs: Y.Doc[] = [];

  join(doc: Y.Doc): void {
    // The real provider opens with a state-vector handshake, so a peer that
    // joins late still receives everything written before it arrived.
    for (const existing of this.docs) {
      Y.applyUpdate(
        doc,
        Y.encodeStateAsUpdate(existing, Y.encodeStateVector(doc)),
        WIRE,
      );
      Y.applyUpdate(
        existing,
        Y.encodeStateAsUpdate(doc, Y.encodeStateVector(existing)),
        WIRE,
      );
    }
    this.docs.push(doc);
    this.pending.set(doc, []);
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === WIRE) {
        return;
      }
      for (const peer of this.docs) {
        if (peer !== doc) {
          this.pending.get(peer)?.push(update);
        }
      }
    });
  }

  /** Deliver everything, including whatever delivery itself produces. */
  flush(): void {
    for (let round = 0; round < 20; round += 1) {
      let delivered = false;
      for (const doc of this.docs) {
        const queue = this.pending.get(doc) ?? [];
        if (queue.length === 0) {
          continue;
        }
        this.pending.set(doc, []);
        delivered = true;
        for (const update of queue) {
          Y.applyUpdate(doc, update, WIRE);
        }
      }
      if (!delivered) {
        return;
      }
    }
    throw new Error("wire never settled");
  }

  get queued(): number {
    let total = 0;
    for (const queue of this.pending.values()) {
      total += queue.length;
    }
    return total;
  }
}

interface Peer {
  readonly editor: Editor;
  readonly doc: Y.Doc;
  readonly binding: CollabBinding;
}

function peer(wire: Wire, document?: Document, captureTimeout = 0): Peer {
  const editor = new Editor(document ? { document } : {});
  const doc = new Y.Doc();
  wire.join(doc);
  const binding = new CollabBinding({ editor, doc, captureTimeout });
  return { editor, doc, binding };
}

test("layer visibility and locks converge and a remote unlock restores editing", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const id = a.editor.getSnapshot().elements[0]?.id;
  if (!id) throw new Error("fixture requires an element");
  a.editor.apply([
    { type: "updateVisual", id, visual: { hidden: true, locked: true } },
  ]);
  wire.flush();
  expect(b.editor.store.get(id)?.visual.hidden).toBe(true);
  expect(b.editor.store.get(id)?.visual.locked).toBe(true);
  b.editor.apply([
    { type: "updateVisual", id, visual: { hidden: false, locked: false } },
  ]);
  wire.flush();
  a.editor.apply([{ type: "updateVisual", id, visual: { x: 250 } }]);
  wire.flush();
  expect(b.editor.store.get(id)?.visual.x).toBe(250);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("batch note replacement converges and undo preserves concurrent peer appearance", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  const one = a.editor.createElement("text.note", {
    semantic: {
      text: "Old title",
      marks: [{ kind: "bold", start: 4, end: 9 }],
    },
  });
  const two = a.editor.createElement("text.note", {
    semantic: { text: "Old subtitle" },
  });
  a.binding.attach();
  const b = peer(wire);
  b.binding.attach();
  wire.flush();
  try {
    a.editor.selection.set([one, two]);
    expect(replaceSelectedNoteText(a.editor, "Old", "New brand")).toBe(2);
    b.editor.apply([
      {
        type: "updateVisual",
        id: one,
        visual: { style: { color: "#123456" }, x: 250 },
      },
    ]);
    wire.flush();
    expectConverged(a, b, wire);
    expect(b.editor.getText(one)).toBe("New brand title");
    expect(b.editor.store.get(one)?.semantic).toMatchObject({
      marks: [{ kind: "bold", start: 10, end: 15 }],
    });
    const saved = a.editor.getSnapshot();
    expect(parseDocument(serializeDocument(saved))).toEqual(saved);
    expect(a.binding.undo()).toBe(true);
    wire.flush();
    expectConverged(a, b, wire);
    expect(a.editor.getText(one)).toBe("Old title");
    expect(a.editor.getText(two)).toBe("Old subtitle");
    expect(a.editor.store.get(one)?.visual.x).toBe(250);
    expect(a.editor.store.get(one)?.visual.style?.color).toBe("#123456");
    expect(a.binding.redo()).toBe(true);
    wire.flush();
    expectConverged(a, b, wire);
    expect(b.editor.getText(two)).toBe("New brand subtitle");
  } finally {
    a.binding.detach();
    b.binding.detach();
  }
});

test("batch layer naming converges and local undo preserves peer content", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  const one = a.editor.createElement("text.note", {
    semantic: { text: "One" },
  });
  const two = a.editor.createElement("text.note", {
    semantic: { text: "Two" },
  });
  a.binding.attach();
  const b = peer(wire);
  b.binding.attach();
  wire.flush();
  try {
    a.editor.selection.set([one, two]);
    expect(
      renameSelectedLayers(a.editor, { pattern: "Control {n}", digits: 2 }),
    ).toBe(2);
    b.editor.setText(one, "Peer text");
    wire.flush();
    expect(b.editor.store.get(one)?.visual.layerName).toBe("Control 02");
    expect(b.editor.store.get(two)?.visual.layerName).toBe("Control 01");
    expectConverged(a, b, wire);
    expect(a.binding.undo()).toBe(true);
    wire.flush();
    expect(a.editor.store.get(one)?.visual.layerName).toBeUndefined();
    expect(a.editor.store.get(two)?.visual.layerName).toBeUndefined();
    expect(a.editor.getText(one)).toBe("Peer text");
    expectConverged(a, b, wire);
  } finally {
    a.binding.detach();
    b.binding.detach();
  }
});

test("remote active-page deletion follows tab neighbors and restores the peer's local view", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  const first = a.editor.currentPageId;
  const middle = a.editor.createPage({ name: "Middle" });
  const last = a.editor.createPage({ name: "Last" });
  a.editor.setCurrentPage(first);
  a.binding.attach();
  const b = peer(wire);
  b.binding.attach();
  wire.flush();
  try {
    b.editor.setCurrentPage(last);
    const view = { x: 750, y: -300, z: 1.5 };
    b.editor.camera.set(view);
    b.editor.setCurrentPage(middle);
    a.editor.deletePage(middle);
    wire.flush();
    expect(b.editor.currentPageId).toBe(last);
    expect(b.editor.camera.get()).toEqual(view);
    expect(a.editor.currentPageId).toBe(first);
    expectConverged(a, b, wire);
    expect(a.binding.undo()).toBe(true);
    wire.flush();
    expect(b.editor.currentPageId).toBe(last);
    expect(b.editor.store.getPage(middle)).toBeDefined();
    expectConverged(a, b, wire);
  } finally {
    a.binding.detach();
    b.binding.detach();
  }
});

test("page ordering converges with a peer rename and local undo restores legacy order only", () => {
  const wire = new Wire();
  const initial = freeformDocument();
  const a = peer(wire, {
    ...initial,
    pages: [
      { id: "a", name: "One", kind: "freeform" },
      { id: "b", name: "Two", kind: "freeform" },
      { id: "c", name: "Three", kind: "freeform" },
    ],
    elements: [],
  });
  a.binding.attach();
  const b = peer(wire);
  b.binding.attach();
  wire.flush();
  try {
    expect(a.editor.reorderPage("c", -1)).toBe(true);
    b.editor.renamePage("c", "Peer name");
    wire.flush();
    expect(a.editor.store.listPages().map((page) => page.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expectConverged(a, b, wire);
    expect(a.binding.undo()).toBe(true);
    wire.flush();
    expect(a.editor.store.listPages().map((page) => page.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(a.editor.store.getPage("c")?.name).toBe("Peer name");
    expect(
      a.editor.store.listPages().every((page) => page.order === undefined),
    ).toBe(true);
    expectConverged(a, b, wire);
    expect(a.binding.redo()).toBe(true);
    wire.flush();
    expect(a.editor.store.listPages().map((page) => page.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expectConverged(a, b, wire);
    // Both peers insert into the same interval; ID tie-breaking remains total.
    a.editor.duplicatePage("a");
    b.editor.duplicatePage("a");
    wire.flush();
    expect(a.editor.store.listPages()).toHaveLength(5);
    expect(a.editor.store.listPages()[0]?.id).toBe("a");
    expect(
      a.editor.store
        .listPages()
        .slice(-2)
        .map((page) => page.id),
    ).toEqual(["c", "b"]);
    expectConverged(a, b, wire);
  } finally {
    a.binding.detach();
    b.binding.detach();
  }
});

test("a group mask and concurrent mask rotation converge with isolated undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const mask = a.editor.buildElement("shape.geo", {
    semantic: { geo: "ellipse" },
    visual: { x: 20, y: 20, width: 100, height: 100 },
  });
  const content = a.editor.buildElement("shape.geo", {
    semantic: { geo: "rect" },
    visual: { x: 0, y: 0, width: 160, height: 160 },
  });
  const group = a.editor.buildElement("group", {
    semantic: { memberIds: [mask.id, content.id] },
  });
  a.editor.apply(
    [mask, content, group].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(setGroupMask(a.editor, group.id, mask.id)).toBe(true);
  b.editor.apply([
    { type: "updateVisual", id: mask.id, visual: { rotation: 30 } },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(
      (client.editor.store.get(group.id)?.semantic as GroupSemantic).maskId,
    ).toBe(mask.id);
    expect(client.editor.store.get(mask.id)?.visual.rotation).toBe(30);
    expect(
      client.editor.createShapeContext().clipPolygonOf?.(content.id),
    ).toHaveLength(32);
  }

  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(
      (client.editor.store.get(group.id)?.semantic as GroupSemantic).maskId,
    ).toBe(mask.id);
    expect(client.editor.store.get(mask.id)?.visual.rotation).toBeUndefined();
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("concurrent layout-grid fields merge and undo remains peer-local", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const frame = a.editor.buildElement("frame", {
    semantic: { name: "Responsive web" },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  a.editor.apply([{ type: "createElement", element: frame }]);
  expect(
    addLayoutGrid(a.editor, frame.id, "columns", "responsive-columns"),
  ).toBe(true);
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(
    updateLayoutGrid(a.editor, frame.id, 0, {
      kind: "columns",
      id: "responsive-columns",
      count: 4,
      gutter: 16,
      margin: 16,
      color: "#ef4444",
      opacity: 0.3,
    }),
  ).toBe(true);
  expect(
    updateLayoutGrid(b.editor, frame.id, 0, {
      kind: "columns",
      id: "responsive-columns",
      count: 4,
      gutter: 24,
      margin: 16,
      color: "#ef4444",
      opacity: 0.12,
    }),
  ).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(
      (client.editor.store.get(frame.id)?.semantic as FrameSemantic)
        .layoutGrids?.[0],
    ).toMatchObject({ gutter: 24, opacity: 0.3 });

  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(
      (client.editor.store.get(frame.id)?.semantic as FrameSemantic)
        .layoutGrids?.[0],
    ).toMatchObject({ gutter: 16, opacity: 0.3 });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("device safe-area insets merge by side with peer-local undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const frame = a.editor.buildElement("frame", {
    semantic: {
      name: "iPhone",
      platform: "ios",
      safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
    },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  a.editor.apply([{ type: "createElement", element: frame }]);
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  for (const [client, patch] of [
    [a, { top: 59 }],
    [b, { bottom: 40 }],
  ] as const) {
    const semantic = client.editor.store.get(frame.id)
      ?.semantic as FrameSemantic;
    client.editor.apply([
      {
        type: "updateSemantic",
        id: frame.id,
        semantic: {
          ...semantic,
          safeArea: { ...semantic.safeArea!, ...patch },
        },
      },
    ]);
  }
  wire.flush();
  for (const client of [a, b])
    expect(
      (client.editor.store.get(frame.id)?.semantic as FrameSemantic).safeArea,
    ).toEqual({ top: 59, right: 0, bottom: 40, left: 0 });

  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(
      (client.editor.store.get(frame.id)?.semantic as FrameSemantic).safeArea,
    ).toEqual({ top: 59, right: 0, bottom: 34, left: 0 });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("style paste converges with remote content edits and undo preserves peer content", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const source = a.editor.createElement("node.generic", {
    visual: { style: { fill: "#123456", strokeWidth: 4 } },
  });
  const target = a.editor.createElement("node.generic", {
    semantic: { label: "Before" },
    visual: { style: { fill: "#abcdef" } },
  });
  const b = peer(wire);
  b.binding.attach();
  wire.flush();
  a.editor.selection.set([source]);
  copySelectionStyle(a.editor);
  a.editor.selection.set([target]);
  pasteSelectionStyle(a.editor);
  b.editor.apply([
    { type: "updateSemantic", id: target, semantic: { label: "Peer content" } },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(target)?.visual.style).toEqual({
      fill: "#123456",
      strokeWidth: 4,
    });
    expect(client.editor.store.get(target)?.semantic).toEqual({
      label: "Peer content",
    });
  }
  expectConverged(a, b, wire);
  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(target)?.visual.style).toEqual({
      fill: "#abcdef",
    });
    expect(client.editor.store.get(target)?.semantic).toEqual({
      label: "Peer content",
    });
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("orientation and peer content edits converge, and local undo preserves remote content", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const child = a.editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Before" },
    visual: {
      x: 20,
      y: 30,
      width: 350,
      height: 48,
      horizontalConstraint: "stretch",
    },
  });
  const frame = a.editor.buildElement("frame", {
    semantic: { name: "Phone", platform: "ios", memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 390, height: 844, aspectRatio: 390 / 844 },
  });
  a.editor.apply(
    [frame, child].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const b = peer(wire);
  b.binding.attach();
  wire.flush();
  expect(swapArtboardOrientation(a.editor, frame.id)).toBe(true);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: child.id,
      semantic: { geo: "rect", label: "Peer edit" },
    },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.getBounds(frame.id)).toMatchObject({
      width: 844,
      height: 390,
    });
    expect(client.editor.getBounds(child.id)?.width).toBe(804);
    expect(client.editor.store.get(child.id)?.semantic).toMatchObject({
      label: "Peer edit",
    });
  }
  expectConverged(a, b, wire);
  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.getBounds(frame.id)).toMatchObject({
      width: 390,
      height: 844,
    });
    expect(client.editor.getBounds(child.id)?.width).toBe(350);
    expect(client.editor.store.get(child.id)?.semantic).toMatchObject({
      label: "Peer edit",
    });
  }
  expectConverged(a, b, wire);
  expect(a.binding.redo()).toBe(true);
  wire.flush();
  expect(b.editor.getBounds(child.id)?.width).toBe(804);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("remote page renames preserve each collaborator's active page and remembered views", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const first = a.editor.currentPageId;
  const second = a.editor.createPage({ name: "Mobile" });
  const selectedLayer = a.editor.createElement("node.generic", {
    semantic: { label: "Checkout" },
  });
  const b = peer(wire);
  b.binding.attach();
  wire.flush();
  a.editor.setCurrentPage(first);
  b.editor.setCurrentPage(first);
  const firstView = { x: 60, y: 70, z: 0.5 };
  const secondView = { x: -800, y: -400, z: 2 };
  b.editor.camera.set(firstView);
  b.editor.setCurrentPage(second);
  b.editor.camera.set(secondView);
  b.editor.selection.set([selectedLayer]);
  a.editor.renamePage(second, "Mobile checkout");
  wire.flush();
  expect(a.editor.currentPageId).toBe(first);
  expect(b.editor.currentPageId).toBe(second);
  expect(b.editor.camera.get()).toEqual(secondView);
  expect([...b.editor.selection.ids()]).toEqual([selectedLayer]);
  b.editor.setCurrentPage(first);
  expect(b.editor.camera.get()).toEqual(firstView);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("a responsive artboard copy converges and undoes as one transaction", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const child = a.editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "CTA" },
    visual: {
      x: 20,
      y: 30,
      width: 1400,
      height: 48,
      horizontalConstraint: "stretch",
    },
  });
  const frame = a.editor.buildElement("frame", {
    semantic: { name: "Checkout", platform: "web", memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  a.editor.apply(
    [frame, child].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  const mobileId = a.editor.createResponsiveVariant(frame.id, "iphone");
  if (!mobileId) throw new Error("expected responsive variant");
  wire.flush();
  for (const client of [a, b]) {
    const mobile = client.editor.store.get(mobileId);
    expect(mobile?.visual).toMatchObject({ width: 390, height: 844 });
    expect(mobile?.semantic).toMatchObject({
      platform: "ios",
      safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
    });
    const memberId = (mobile?.semantic as FrameSemantic).memberIds?.[0];
    expect(client.editor.store.get(memberId ?? "")?.visual.width).toBe(350);
  }

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(mobileId)).toBeUndefined();
    expect(client.editor.store.get(frame.id)).toBeDefined();
    expect(client.editor.store.get(child.id)).toBeDefined();
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("responsive source refresh converges while preserving a mobile override", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const label = a.editor.buildElement("text.note", {
    semantic: { text: "Checkout" },
    visual: {
      x: 24,
      y: 80,
      width: 1392,
      height: 40,
      horizontalConstraint: "stretch",
      style: { color: "#111827" },
    },
  });
  const source = a.editor.buildElement("frame", {
    semantic: { name: "Flow", memberIds: [label.id] },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  a.editor.apply(
    [source, label].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const mobileId = a.editor.createResponsiveVariant(source.id, "android");
  if (!mobileId) throw new Error("expected responsive variant");
  const mobileLabelId = (
    a.editor.store.get(mobileId)?.semantic as FrameSemantic
  ).memberIds?.[0];
  if (!mobileLabelId) throw new Error("expected responsive label");
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  b.editor.apply([
    {
      type: "updateSemantic",
      id: mobileLabelId,
      semantic: { text: "Pay on Android" },
    },
  ]);
  a.editor.apply([
    {
      type: "updateSemantic",
      id: label.id,
      semantic: { text: "Review order" },
    },
    {
      type: "updateVisual",
      id: label.id,
      visual: { style: { color: "#7c3aed" } },
    },
  ]);
  wire.flush();
  expect(a.editor.refreshResponsiveVariant(mobileId)).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.getText(mobileLabelId)).toBe("Pay on Android");
    expect(client.editor.store.get(mobileLabelId)?.visual).toMatchObject({
      width: 312,
      style: { color: "#7c3aed" },
    });
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("responsive structure reconciliation converges and undoes atomically", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const label = a.editor.buildElement("text.note", {
    semantic: { text: "Checkout" },
    visual: {
      x: 24,
      y: 80,
      width: 1392,
      height: 40,
      horizontalConstraint: "stretch",
    },
  });
  const source = a.editor.buildElement("frame", {
    semantic: { name: "Flow", memberIds: [label.id] },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  a.editor.apply(
    [source, label].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const mobileId = a.editor.createResponsiveVariant(source.id, "android");
  if (!mobileId) throw new Error("expected responsive variant");
  const mobileLabel = (a.editor.store.get(mobileId)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!mobileLabel) throw new Error("expected mobile label");
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  b.editor.apply([
    {
      type: "updateSemantic",
      id: mobileLabel,
      semantic: { text: "Android checkout" },
    },
    {
      type: "updateVisual",
      id: mobileLabel,
      visual: { x: 1550, width: 300 },
    },
  ]);
  const action = a.editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Continue" },
    visual: {
      x: 24,
      y: 150,
      width: 1392,
      height: 48,
      horizontalConstraint: "stretch",
    },
  });
  a.editor.apply([
    { type: "createElement", element: action },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: {
        ...(source.semantic as object),
        memberIds: [label.id, action.id],
      },
    },
  ]);
  wire.flush();

  expect(a.editor.updateResponsiveStructure(mobileId)).toBe(true);
  const actionTarget = (
    a.editor.store.get(mobileId)?.semantic as FrameSemantic
  ).instanceBindings?.find((binding) => binding.source === action.id)?.target;
  if (!actionTarget) throw new Error("expected responsive action");
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.getText(mobileLabel)).toBe("Android checkout");
    expect(client.editor.store.get(mobileLabel)?.visual).toMatchObject({
      x: 1550,
      width: 300,
    });
    expect(client.editor.store.get(actionTarget)?.visual).toMatchObject({
      x: 1544,
      width: 312,
    });
  }
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.has(action.id)).toBe(true);
    expect(client.editor.store.has(actionTarget)).toBe(false);
    expect(client.editor.getText(mobileLabel)).toBe("Android checkout");
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("persistent page guides converge by field with peer-local undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  expect(
    addPageGuide(a.editor, a.editor.currentPageId, "x", 320, "shared-guide"),
  ).toBe("shared-guide");
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(updatePageGuide(a.editor, "shared-guide", { position: 360 })).toBe(
    true,
  );
  expect(updatePageGuide(b.editor, "shared-guide", { color: "#2563eb" })).toBe(
    true,
  );
  wire.flush();
  for (const client of [a, b])
    expect(
      pageGuides(client.editor, client.editor.currentPageId)[0],
    ).toMatchObject({ position: 360, color: "#2563eb" });

  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(
      pageGuides(client.editor, client.editor.currentPageId)[0],
    ).toMatchObject({ position: 360, color: "#ec4899" });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("concurrent component variant-property fields merge with isolated undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const definition = a.editor.buildElement("frame", {
    semantic: {
      name: "Button",
      component: true,
      variantSet: "Button",
      memberIds: [],
    },
  });
  a.editor.apply([{ type: "createElement", element: definition }]);
  expect(
    addComponentVariantProperty(
      a.editor,
      definition.id,
      "State",
      "Default",
      "state-property",
    ),
  ).toBe(true);
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(
    updateComponentVariantProperty(
      a.editor,
      definition.id,
      "state-property",
      "Interaction",
      "Default",
    ),
  ).toBe(true);
  expect(
    updateComponentVariantProperty(
      b.editor,
      definition.id,
      "state-property",
      "State",
      "Hover",
    ),
  ).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(
      (client.editor.store.get(definition.id)?.semantic as FrameSemantic)
        .variantProperties?.[0],
    ).toMatchObject({ name: "Interaction", value: "Hover" });

  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(
      (client.editor.store.get(definition.id)?.semantic as FrameSemantic)
        .variantProperties?.[0],
    ).toMatchObject({ name: "Interaction", value: "Default" });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("concurrent image crop fields merge with isolated undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const image = a.editor.buildElement("image.raster", {
    semantic: {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      alt: "",
      crop: { x: 0, y: 0, width: 0.8, height: 1 },
    },
  });
  a.editor.apply([{ type: "createElement", element: image }]);
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  for (const [client, crop] of [
    [a, { x: 0.1, y: 0, width: 0.8, height: 1 }],
    [b, { x: 0, y: 0, width: 0.7, height: 1 }],
  ] as const) {
    const semantic = client.editor.store.get(image.id)
      ?.semantic as ImageSemantic;
    client.editor.apply([
      { type: "updateSemantic", id: image.id, semantic: { ...semantic, crop } },
    ]);
  }
  wire.flush();
  for (const client of [a, b])
    expect(
      (client.editor.store.get(image.id)?.semantic as ImageSemantic).crop,
    ).toEqual({ x: 0.1, y: 0, width: 0.7, height: 1 });

  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(
      (client.editor.store.get(image.id)?.semantic as ImageSemantic).crop,
    ).toEqual({ x: 0.1, y: 0, width: 0.8, height: 1 });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

function elementIn(peer: Peer, id: string): Element {
  const element = peer.editor.store.get(id);
  if (!element) {
    throw new Error(`element ${id} missing from the store`);
  }
  return element;
}

test("prototype triggers and transitions converge with independent undo", () => {
  const wire = new Wire();
  const initial = erdDocument();
  const a = peer(wire, initial);
  a.binding.attach();
  const source = a.editor.buildElement("node.generic", {
    semantic: { label: "Continue" },
  });
  const start = a.editor.buildElement("frame", {
    semantic: { name: "Start", memberIds: [source.id] },
  });
  const target = a.editor.buildElement("frame", {
    semantic: { name: "Target", memberIds: [] },
    visual: { x: 500 },
  });
  const link = a.editor.buildElement("edge.generic", {
    semantic: { from: source.id, to: target.id, prototype: true },
  });
  a.editor.apply(
    [start, source, target, link].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  a.editor.apply([
    {
      type: "updateSemantic",
      id: link.id,
      semantic: {
        ...(elementIn(a, link.id).semantic as GenericEdgeSemantic),
        label: "Continue now",
      },
    },
    {
      type: "updateSemantic",
      id: start.id,
      semantic: {
        ...(elementIn(a, start.id).semantic as FrameSemantic),
        prototypeOverflow: "vertical",
      },
    },
    {
      type: "updateVisual",
      id: source.id,
      visual: { prototypeFixed: true },
    },
  ]);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: link.id,
      semantic: {
        ...(elementIn(b, link.id).semantic as GenericEdgeSemantic),
        prototypeAction: "open-overlay",
        prototypeTrigger: "after-delay",
        prototypeDelay: 750,
        prototypeTransition: "smart",
        prototypeDuration: 420,
        prototypeOverlayPosition: "manual",
        prototypeOverlayX: 32,
        prototypeOverlayY: 64,
        prototypeOverlayBackdrop: true,
        prototypeOverlayDismiss: true,
      },
    },
  ]);
  wire.flush();
  for (const client of [a, b])
    expect(elementIn(client, link.id).semantic).toMatchObject({
      label: "Continue now",
      prototypeAction: "open-overlay",
      prototypeTrigger: "after-delay",
      prototypeDelay: 750,
      prototypeTransition: "smart",
      prototypeDuration: 420,
      prototypeOverlayPosition: "manual",
      prototypeOverlayX: 32,
      prototypeOverlayY: 64,
      prototypeOverlayBackdrop: true,
      prototypeOverlayDismiss: true,
    });
  for (const client of [a, b]) {
    expect(elementIn(client, start.id).semantic).toMatchObject({
      prototypeOverflow: "vertical",
    });
    expect(elementIn(client, source.id).visual.prototypeFixed).toBe(true);
  }
  expectConverged(a, b, wire);
  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(elementIn(client, link.id).semantic).toEqual({
      from: source.id,
      to: target.id,
      prototype: true,
      label: "Continue now",
    });
    for (const element of initial.elements)
      expect(client.editor.store.get(element.id)?.semantic).toEqual(
        element.semantic,
      );
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("merges concurrent accessibility fields with peer-local undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const id = a.editor.createElement("text.note", {
    semantic: { text: "Continue" },
  });
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.apply([
    {
      type: "replaceAccessibility",
      id,
      accessibility: { role: "button", label: "Continue checkout" },
    },
  ]);
  b.editor.apply([
    {
      type: "replaceAccessibility",
      id,
      accessibility: { disabled: true },
    },
  ]);
  wire.flush();
  for (const client of [a, b])
    expect(elementIn(client, id).accessibility).toEqual({
      role: "button",
      label: "Continue checkout",
      disabled: true,
    });
  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(elementIn(client, id).accessibility).toEqual({ disabled: true });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("merges concurrent wrapping fields with peer-local undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const frame = a.editor.buildElement("frame", {
    semantic: {
      name: "Tags",
      memberIds: [],
      layout: {
        direction: "horizontal",
        gap: 8,
        padding: 12,
        sizing: "fixed",
        align: "start",
      },
    },
  });
  a.editor.apply([{ type: "createElement", element: frame }]);
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  const semanticIn = (client: ReturnType<typeof peer>) =>
    elementIn(client, frame.id).semantic as FrameSemantic;
  a.editor.apply([
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: {
        ...semanticIn(a),
        layout: { ...semanticIn(a).layout!, wrap: true },
      },
    },
  ]);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: {
        ...semanticIn(b),
        layout: { ...semanticIn(b).layout!, crossGap: 16 },
      },
    },
  ]);
  wire.flush();
  for (const client of [a, b])
    expect(semanticIn(client).layout).toMatchObject({
      wrap: true,
      crossGap: 16,
    });
  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(semanticIn(client).layout?.wrap).toBeUndefined();
    expect(semanticIn(client).layout?.crossGap).toBe(16);
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("wrapped per-line fill converges after concurrent resize and line-gap edits", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const fixedA = a.editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 120, height: 20 },
  });
  const fillA = a.editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 40, height: 20, layoutGrow: 1 },
  });
  const fixedB = a.editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 80, height: 30 },
  });
  const fillB = a.editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 40, height: 30, layoutGrow: 2 },
  });
  const frame = a.editor.buildElement("frame", {
    semantic: {
      name: "Responsive cards",
      memberIds: [fixedA.id, fillA.id, fixedB.id, fillB.id],
      layout: {
        direction: "horizontal",
        gap: 10,
        crossGap: 5,
        wrap: true,
        padding: 10,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 0, y: 0, width: 200, height: 200 },
  });
  a.editor.apply(
    [frame, fixedA, fillA, fixedB, fillB].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  expect(b.editor.getBounds(fillA.id)?.width).toBe(50);
  expect(b.editor.getBounds(fillB.id)?.width).toBe(90);

  a.editor.apply([
    { type: "updateVisual", id: frame.id, visual: { width: 250 } },
  ]);
  const semantic = b.editor.store.get(frame.id)?.semantic as FrameSemantic;
  b.editor.apply([
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: {
        ...semantic,
        layout: { ...semantic.layout!, crossGap: 9 },
      },
    },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.getBounds(fillA.id)?.width).toBe(10);
    expect(client.editor.getBounds(fillB.id)).toMatchObject({
      x: 10,
      y: 49,
      width: 230,
    });
  }
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.getBounds(fillA.id)?.width).toBe(50);
    expect(client.editor.getBounds(fillB.id)).toMatchObject({
      x: 100,
      y: 39,
      width: 90,
    });
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("absolute layout mode merges with a remote responsive constraint", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const child = a.editor.buildElement("shape.geo", {
    visual: { x: 20, y: 20, width: 40, height: 40 },
  });
  const frame = a.editor.buildElement("frame", {
    semantic: {
      name: "Overlay card",
      memberIds: [child.id],
      layout: {
        direction: "vertical",
        gap: 8,
        padding: 20,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 0, y: 0, width: 300, height: 200 },
  });
  a.editor.apply(
    [frame, child].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.apply([
    {
      type: "updateVisual",
      id: child.id,
      visual: { layoutPosition: "absolute" },
    },
  ]);
  b.editor.apply([
    {
      type: "updateVisual",
      id: child.id,
      visual: { horizontalConstraint: "end" },
    },
  ]);
  wire.flush();
  for (const client of [a, b])
    expect(client.editor.store.get(child.id)?.visual).toMatchObject({
      layoutPosition: "absolute",
      horizontalConstraint: "end",
    });
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(
      client.editor.store.get(child.id)?.visual.layoutPosition,
    ).toBeUndefined();
    expect(client.editor.store.get(child.id)?.visual.horizontalConstraint).toBe(
      "end",
    );
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("concurrent auto-layout size limits merge and retain bounded geometry", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const child = a.editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 40, height: 40, layoutGrow: 1 },
  });
  const frame = a.editor.buildElement("frame", {
    semantic: {
      name: "Bounded row",
      memberIds: [child.id],
      layout: {
        direction: "horizontal",
        gap: 0,
        padding: 0,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 0, y: 0, width: 300, height: 80 },
  });
  a.editor.apply(
    [frame, child].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.apply([
    { type: "updateVisual", id: child.id, visual: { minWidth: 100 } },
  ]);
  b.editor.apply([
    { type: "updateVisual", id: child.id, visual: { maxWidth: 240 } },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(child.id)?.visual).toMatchObject({
      minWidth: 100,
      maxWidth: 240,
      width: 240,
    });
  }
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(child.id)?.visual.minWidth).toBeUndefined();
    expect(client.editor.store.get(child.id)?.visual.maxWidth).toBe(240);
    expect(client.editor.getBounds(child.id)?.width).toBe(240);
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

for (const swapped of [false, true])
  test(`concurrent width and padding edits reconcile geometry without repair undo entries (${swapped})`, () => {
    const wire = new Wire();
    const a = peer(wire, freeformDocument());
    a.binding.attach();
    const frame = a.editor.buildElement("frame", {
      visual: { x: 0, y: 0, width: 500, height: 200 },
    });
    const child = a.editor.buildElement("shape.geo", {
      visual: { x: 0, y: 0, width: 50, height: 30, layoutGrow: 1 },
    });
    const semantic: FrameSemantic = {
      name: "Concurrent",
      memberIds: [child.id],
      layout: {
        direction: "horizontal",
        sizing: "fixed",
        align: "start",
        gap: 0,
        padding: 20,
      },
    };
    a.editor.apply([
      { type: "createElement", element: { ...frame, semantic } },
      { type: "createElement", element: child },
    ]);
    const b = peer(wire);
    wire.flush();
    b.binding.attach();
    wire.flush();
    const resize = swapped ? b : a;
    const padding = swapped ? a : b;
    resize.editor.apply([
      { type: "updateVisual", id: frame.id, visual: { width: 700 } },
    ]);
    padding.editor.apply([
      {
        type: "updateSemantic",
        id: frame.id,
        semantic: { ...semantic, layout: { ...semantic.layout, padding: 50 } },
      },
    ]);
    wire.flush();
    for (const client of [a, b]) {
      expect(client.editor.getBounds(frame.id)?.width).toBe(700);
      expect(client.editor.getBounds(child.id)).toMatchObject({
        x: 50,
        width: 600,
      });
    }
    expectConverged(a, b, wire);
    expect(resize.binding.undo()).toBe(true);
    wire.flush();
    expect(a.editor.getBounds(child.id)).toMatchObject({ x: 50, width: 400 });
    expectConverged(a, b, wire);
    expect(padding.binding.undo()).toBe(true);
    wire.flush();
    expect(a.editor.getBounds(child.id)).toMatchObject({ x: 20, width: 460 });
    expectConverged(a, b, wire);
    expect(b.binding.canUndo()).toBe(false);
  });

test("concurrent ratio and width edits converge with derived height", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const shape = a.editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  a.editor.apply([{ type: "createElement", element: shape }]);
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.apply([
    { type: "updateVisual", id: shape.id, visual: { aspectRatio: 2 } },
  ]);
  b.editor.resizeElement(shape.id, {
    x: 0,
    y: 0,
    width: 240,
    height: 100,
  });
  wire.flush();

  for (const client of [a, b]) {
    expect(client.editor.store.get(shape.id)?.visual.aspectRatio).toBe(2);
    expect(client.editor.getBounds(shape.id)).toMatchObject({
      width: 240,
      height: 120,
    });
  }
  expectConverged(a, b, wire);
  expect(b.binding.undo()).toBe(true);
  wire.flush();
  expect(a.editor.getBounds(shape.id)).toMatchObject({
    width: 100,
    height: 50,
  });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("mixed fill/stretch layouts converge across remote resizing, padding edits and undo", () => {
  const wire = new Wire();
  const initial = erdDocument();
  const a = peer(wire, initial);
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  a.editor.createPage({ name: "Responsive UI" });
  const frame = a.editor.buildElement("frame", {
    visual: { x: 0, y: 0, width: 500, height: 200 },
  });
  const first = a.editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 50, height: 30, layoutGrow: 1 },
  });
  const second = a.editor.buildElement("shape.geo", {
    visual: { x: 0, y: 0, width: 50, height: 30, layoutGrow: 3 },
  });
  const fixed = a.editor.buildElement("text.note", {
    semantic: { text: "Fixed label" },
    visual: { x: 0, y: 0, width: 100, height: 30 },
  });
  const semantic: FrameSemantic = {
    name: "Toolbar",
    memberIds: [first.id, second.id, fixed.id],
    layout: {
      direction: "horizontal",
      sizing: "fixed",
      align: "stretch",
      gap: 10,
      padding: 0,
      paddingTop: 5,
      paddingRight: 10,
      paddingBottom: 15,
      paddingLeft: 30,
    },
  };
  a.editor.apply([
    { type: "createElement", element: { ...frame, semantic } },
    ...[first, second, fixed].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  ]);
  wire.flush();
  expect(b.editor.getBounds(first.id)).toMatchObject({
    x: 30,
    y: 5,
    width: 85,
    height: 180,
  });
  expect(b.editor.getBounds(second.id)?.width).toBe(255);
  b.editor.apply([
    { type: "updateVisual", id: frame.id, visual: { width: 700 } },
  ]);
  wire.flush();
  expect(a.editor.getBounds(first.id)?.width).toBe(135);
  expect(a.editor.getBounds(second.id)?.width).toBe(405);
  a.editor.apply([
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: {
        ...semantic,
        layout: { ...semantic.layout, paddingLeft: 50 },
      },
    },
  ]);
  wire.flush();
  expect(b.editor.getBounds(first.id)).toMatchObject({ x: 50, width: 130 });
  expect(b.editor.getBounds(second.id)?.width).toBe(390);
  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(b.editor.getBounds(first.id)).toMatchObject({ x: 30, width: 135 });
  expectConverged(a, b, wire);
  for (const element of initial.elements) {
    expect(a.editor.store.get(element.id)?.semantic).toEqual(element.semantic);
    expect(b.editor.store.get(element.id)?.semantic).toEqual(element.semantic);
  }
});

test("concurrent token edits and new bindings resolve the merged token value", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const token = createColorToken(a.editor, "Brand", "#123456");
  const layer = a.editor
    .getSnapshot()
    .elements.find((element) => element.type !== "design.token")?.id;
  if (!token || !layer) throw new Error("missing fixture");
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  updateColorToken(a.editor, token, "Brand", "#abcdef");
  b.editor.selection.set([layer]);
  bindSelectionColor(b.editor, "fill", token);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(layer)?.visual.colorTokens?.fill).toBe(
      token,
    );
    expect(client.editor.store.get(layer)?.visual.style?.fill).toBe("#abcdef");
  }
  expectConverged(a, b, wire);
  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(b.editor.store.get(layer)?.visual.style?.fill).toBe("#123456");
  expect(b.editor.store.get(layer)?.visual.colorTokens?.fill).toBe(token);
  expectConverged(a, b, wire);
});

test("page token modes and aliases converge with independent undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const primitive = createColorToken(a.editor, "Blue", "#2563eb");
  const semantic = createColorToken(a.editor, "Action", "#64748b");
  const layer = "n-idea";
  if (!primitive || !semantic) throw new Error("missing tokens");
  setColorTokenAlias(a.editor, semantic, primitive);
  a.editor.selection.set([layer]);
  bindSelectionColor(a.editor, "fill", semantic);
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  b.editor.setPageTokenMode("p1", "Dark");
  updateColorToken(a.editor, primitive, "Blue", "#1d4ed8");
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.getPage("p1")?.tokenMode).toBe("Dark");
    expect(client.editor.store.get(layer)?.visual.style?.fill).toBe("#1d4ed8");
  }

  updateColorToken(a.editor, primitive, "Blue", "#60a5fa");
  wire.flush();
  expect(b.editor.store.get(layer)?.visual.style?.fill).toBe("#60a5fa");
  expectConverged(a, b, wire);
  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.getPage("p1")?.tokenMode).toBe("Dark");
    expect(client.editor.store.get(layer)?.visual.style?.fill).toBe("#1d4ed8");
  }
  expectConverged(a, b, wire);
});

test("measurement bindings and token edits converge with derived geometry", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const token = createNumberToken(a.editor, "Card width", 180);
  const layer = a.editor
    .getSnapshot()
    .elements.find((element) => element.type !== "design.token")?.id;
  if (!token || !layer) throw new Error("missing fixture");
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  updateNumberToken(a.editor, token, "Card width", 240);
  b.editor.selection.set([layer]);
  bindSelectionNumber(b.editor, "width", token);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(layer)?.visual.numberTokens?.width).toBe(
      token,
    );
    expect(client.editor.getBounds(layer)?.width).toBe(240);
  }
  expectConverged(a, b, wire);
});

test("gradient fills converge alongside semantic engineering edits", () => {
  const wire = new Wire();
  const a = peer(wire, erdDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const gradient: FillGradient = {
    type: "angular",
    centerX: 0.4,
    centerY: 0.3,
    angle: 25,
    stops: [
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: "#2563eb", opacity: 0.75 },
    ],
  };
  a.editor.selection.set(["t-users"]);
  a.editor.setSelectionStyle({ fillGradient: gradient });
  const orders = b.editor.store.get("t-orders");
  b.editor.apply([
    {
      type: "updateSemantic",
      id: "t-orders",
      semantic: {
        ...(orders?.semantic as object),
        tableName: "purchases",
      },
    },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(
      client.editor.store.get("t-users")?.visual.style?.fillGradient,
    ).toEqual(gradient);
    expect(
      (client.editor.store.get("t-orders")?.semantic as { tableName: string })
        .tableName,
    ).toBe("purchases");
  }
  expectConverged(a, b, wire);
});

test("concurrent gradient geometry fields merge with isolated undo", () => {
  const wire = new Wire();
  const a = peer(wire, erdDocument());
  a.binding.attach();
  const original: FillGradient = {
    type: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "#ffffff" },
      { offset: 0.5, color: "#7c3aed" },
      { offset: 1, color: "#2563eb" },
    ],
  };
  a.editor.selection.set(["t-users"]);
  a.editor.setSelectionStyle({ fillGradient: original });
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(
    setElementFillGradient(a.editor, "t-users", { ...original, angle: 0 }),
  ).toBe(true);
  expect(
    setElementFillGradient(b.editor, "t-users", {
      ...original,
      stops: original.stops.map((stop, index) =>
        index === 1 ? { ...stop, offset: 0.7 } : stop,
      ),
    }),
  ).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    const gradient =
      client.editor.store.get("t-users")?.visual.style?.fillGradient;
    expect(gradient).toMatchObject({ angle: 0 });
    expect(gradient?.stops[1]?.offset).toBe(0.7);
  }

  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    const gradient =
      client.editor.store.get("t-users")?.visual.style?.fillGradient;
    expect(gradient).toMatchObject({ angle: 0 });
    expect(gradient?.stops[1]?.offset).toBe(0.5);
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("concurrent stroke-gradient angle and stop edits merge", () => {
  const wire = new Wire();
  const a = peer(wire, erdDocument());
  a.binding.attach();
  const original: FillGradient = {
    type: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "#ffffff" },
      { offset: 0.5, color: "#7c3aed" },
      { offset: 1, color: "#2563eb" },
    ],
  };
  a.editor.selection.set(["t-users"]);
  a.editor.setSelectionStyle({ strokeGradient: original });
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  setElementStrokeGradient(a.editor, "t-users", { ...original, angle: 180 });
  setElementStrokeGradient(b.editor, "t-users", {
    ...original,
    stops: original.stops.map((stop, index) =>
      index === 1 ? { ...stop, offset: 0.75 } : stop,
    ),
  });
  wire.flush();
  for (const client of [a, b]) {
    const gradient =
      client.editor.store.get("t-users")?.visual.style?.strokeGradient;
    expect(gradient).toMatchObject({ angle: 180 });
    expect(gradient?.stops[1]?.offset).toBe(0.75);
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("effect stacks converge alongside semantic engineering edits", () => {
  const wire = new Wire();
  const a = peer(wire, erdDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const effects = [
    {
      type: "drop-shadow",
      x: 2,
      y: 6,
      blur: 4,
      color: "#123456",
      opacity: 0.4,
    },
    { type: "layer-blur", blur: 1, enabled: false },
  ] satisfies readonly LayerEffect[];
  a.editor.selection.set(["t-users"]);
  a.editor.setSelectionStyle({ effects });
  const orders = b.editor.store.get("t-orders");
  b.editor.apply([
    {
      type: "updateSemantic",
      id: "t-orders",
      semantic: {
        ...(orders?.semantic as object),
        tableName: "archived_orders",
      },
    },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get("t-users")?.visual.style?.effects).toEqual(
      effects,
    );
    expect(
      (client.editor.store.get("t-orders")?.semantic as { tableName: string })
        .tableName,
    ).toBe("archived_orders");
  }
  expectConverged(a, b, wire);
});

test("concurrent compositing and stroke geometry merge with peer-local undo", () => {
  const wire = new Wire();
  const a = peer(wire, erdDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  a.editor.selection.set(["t-users"]);
  b.editor.selection.set(["t-users"]);
  a.editor.setSelectionStyle({ blendMode: "multiply", strokeCap: "round" });
  b.editor.setSelectionStyle({
    opacity: 0.45,
    strokeJoin: "bevel",
    strokeMiterLimit: 6,
  });
  wire.flush();
  for (const client of [a, b])
    expect(client.editor.store.get("t-users")?.visual.style).toMatchObject({
      blendMode: "multiply",
      opacity: 0.45,
      strokeCap: "round",
      strokeJoin: "bevel",
      strokeMiterLimit: 6,
    });
  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get("t-users")?.visual.style?.blendMode).toBe(
      "multiply",
    );
    expect(
      client.editor.store.get("t-users")?.visual.style?.opacity,
    ).toBeUndefined();
    expect(client.editor.store.get("t-users")?.visual.style?.strokeCap).toBe(
      "round",
    );
    expect(
      client.editor.store.get("t-users")?.visual.style?.strokeJoin,
    ).toBeUndefined();
    expect(
      client.editor.store.get("t-users")?.visual.style?.strokeMiterLimit,
    ).toBeUndefined();
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("concurrent independent corner edits merge by corner with local undo", () => {
  const wire = new Wire();
  const a = peer(wire, erdDocument());
  a.binding.attach();
  a.editor.selection.set(["t-users"]);
  a.editor.setSelectionStyle({
    cornerRadii: {
      topLeft: 8,
      topRight: 8,
      bottomRight: 8,
      bottomLeft: 8,
    },
  });
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  a.editor.setSelectionStyle({
    cornerRadii: {
      topLeft: 24,
      topRight: 8,
      bottomRight: 8,
      bottomLeft: 8,
    },
  });
  b.editor.selection.set(["t-users"]);
  b.editor.setSelectionStyle({
    cornerRadii: {
      topLeft: 8,
      topRight: 16,
      bottomRight: 8,
      bottomLeft: 8,
    },
  });
  wire.flush();
  for (const client of [a, b])
    expect(
      client.editor.store.get("t-users")?.visual.style?.cornerRadii,
    ).toEqual({
      topLeft: 24,
      topRight: 16,
      bottomRight: 8,
      bottomLeft: 8,
    });
  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b])
    expect(
      client.editor.store.get("t-users")?.visual.style?.cornerRadii,
    ).toEqual({
      topLeft: 24,
      topRight: 8,
      bottomRight: 8,
      bottomLeft: 8,
    });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("multilingual auto-sized text converges with concurrent typography and preserves peer edits on undo", () => {
  for (const textResize of ["auto-width", "auto-height"] as const) {
    const wire = new Wire();
    const a = peer(wire, freeformDocument());
    const note = a.editor.createElement("text.note", {
      semantic: { text: "Original" },
      visual: {
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        textResize,
        style: { fontSize: 10 },
      },
    });
    a.binding.attach();
    const b = peer(wire);
    b.binding.attach();
    wire.flush();
    const text =
      "  e\u0301  \u{1f469}\u200d\u{1f4bb}\n\u304b\u3099  \u{1f1ef}\u{1f1f5}  ";
    try {
      a.editor.setText(note, text);
      b.editor.apply([
        {
          type: "updateVisual",
          id: note,
          visual: { style: { fontSize: 20, color: "#123456" } },
        },
      ]);
      wire.flush();
      expectConverged(a, b, wire);
      for (const client of [a, b]) {
        expect(client.editor.getText(note)).toBe(text);
        expect(client.editor.store.get(note)?.visual.style?.fontSize).toBe(20);
        const current = client.editor.store.get(note);
        if (!current) throw new Error("missing text note");
        const measured = measureTextNote(current, textResize);
        expect(current.visual.width).toBe(measured.width);
        expect(current.visual.height).toBe(measured.height);
        const saved = client.editor.getSnapshot();
        expect(parseDocument(serializeDocument(saved))).toEqual(saved);
      }
      expect(a.editor.exportPageSvg()).toBe(b.editor.exportPageSvg());
      expect(a.binding.undo()).toBe(true);
      wire.flush();
      expectConverged(a, b, wire);
      expect(a.editor.getText(note)).toBe("Original");
      expect(a.editor.store.get(note)?.visual.style?.fontSize).toBe(20);
      expect(a.editor.store.get(note)?.visual.style?.color).toBe("#123456");
      expect(a.binding.redo()).toBe(true);
      wire.flush();
      expectConverged(a, b, wire);
      expect(a.editor.getText(note)).toBe(text);
    } finally {
      a.binding.detach();
      b.binding.detach();
    }
  }
});

test("automatic text geometry converges alongside database edits", () => {
  const wire = new Wire();
  const a = peer(wire, erdDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const note = a.editor.buildElement("text.note", {
    semantic: { text: "Short" },
    visual: {
      x: 100,
      y: 300,
      width: 90,
      height: 80,
      textResize: "auto-height",
      style: { fontSize: 10 },
    },
  });
  a.editor.apply([{ type: "createElement", element: note }]);
  wire.flush();

  a.editor.setText(note.id, "one two three four five six seven eight nine");
  const orders = b.editor.store.get("t-orders");
  b.editor.apply([
    {
      type: "updateSemantic",
      id: "t-orders",
      semantic: {
        ...(orders?.semantic as object),
        tableName: "mobile_orders",
      },
    },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.getText(note.id)).toBe(
      "one two three four five six seven eight nine",
    );
    expect(client.editor.getBounds(note.id)?.height).toBe(60);
    expect(
      (client.editor.store.get("t-orders")?.semantic as { tableName: string })
        .tableName,
    ).toBe("mobile_orders");
  }
  expectConverged(a, b, wire);
});

test("rich-text marks converge with remote geometry and undo stays isolated", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const note = a.editor.buildElement("text.note", {
    semantic: { text: "Shared rich label" },
    visual: { x: 20, y: 30, width: 180, height: 40 },
  });
  a.editor.apply([{ type: "createElement", element: note }]);
  wire.flush();

  a.editor.toggleTextMark(note.id, 0, 6, "bold");
  b.editor.apply([
    { type: "updateVisual", id: note.id, visual: { x: 120, y: 140 } },
  ]);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(note.id)?.semantic).toEqual({
      text: "Shared rich label",
      marks: [{ start: 0, end: 6, kind: "bold" }],
    });
    expect(client.editor.getBounds(note.id)?.x).toBe(120);
  }

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(client.editor.store.get(note.id)?.semantic).toEqual({
      text: "Shared rich label",
    });
    expect(client.editor.getBounds(note.id)?.x).toBe(120);
  }
  expectConverged(a, b, wire);
});

test("review threads, replies and resolution converge with isolated undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const target = a.editor.getSnapshot().elements[0]?.id;
  const id = createReviewComment(
    a.editor,
    { x: 80, y: 90 },
    {
      author: "Ada",
      body: "Does this meet contrast requirements?",
      createdAt: "2026-09-07T00:00:00.000Z",
      id: "message-a",
    },
    target,
  );
  if (!id) throw new Error("comment was not created");
  wire.flush();

  expect(
    replyToReviewComment(b.editor, id, {
      author: "Grace",
      body: "Yes, it passes AA.",
      createdAt: "2026-09-07T00:01:00.000Z",
      id: "message-b",
    }),
  ).toBe(true);
  expect(moveReviewComment(a.editor, id, { x: 100, y: 110 })).toBe(true);
  wire.flush();
  expect(elementIn(a, id).semantic).toEqual(elementIn(b, id).semantic);
  expect(elementIn(b, id).visual).toMatchObject({ x: 100, y: 110 });

  expect(setReviewCommentResolved(b.editor, id, true)).toBe(true);
  wire.flush();
  expect((elementIn(a, id).semantic as { resolved?: boolean }).resolved).toBe(
    true,
  );
  expect(b.binding.undo()).toBe(true);
  wire.flush();
  expect(
    (elementIn(a, id).semantic as { resolved?: boolean }).resolved,
  ).toBeUndefined();
  expect(elementIn(a, id).visual).toMatchObject({ x: 100, y: 110 });
  expectConverged(a, b, wire);
});

test("reusable typography propagates and converges with peer-local undo", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const note = a.editor.createElement("text.note", {
    semantic: { text: "Shared title" },
    visual: { x: 10, y: 20, width: 180, height: 50 },
  });
  const style = createTextStyle(a.editor, "Heading", {
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: 700,
    fontStyle: "normal",
    lineHeight: 1.2,
    letterSpacing: -0.5,
    textAlign: "start",
    textDecoration: "none",
    verticalAlign: "top",
  });
  if (!style) throw new Error("text style was not created");
  a.editor.selection.set([note]);
  bindSelectionTextStyle(a.editor, style);
  wire.flush();

  const semantic = elementIn(b, style).semantic as {
    name: string;
    value: TypographyStyleValue;
  };
  updateTextStyle(b.editor, style, semantic.name, {
    ...semantic.value,
    fontSize: 40,
  });
  a.editor.apply([{ type: "updateVisual", id: note, visual: { x: 100 } }]);
  wire.flush();
  for (const client of [a, b]) {
    expect(elementIn(client, note).visual.textStyle).toBe(style);
    expect(elementIn(client, note).visual.style?.fontSize).toBe(40);
    expect(elementIn(client, note).visual.x).toBe(100);
  }
  expect(b.binding.undo()).toBe(true);
  wire.flush();
  for (const client of [a, b]) {
    expect(elementIn(client, note).visual.style?.fontSize).toBe(32);
    expect(elementIn(client, note).visual.x).toBe(100);
  }
  expectConverged(a, b, wire);
});

test("linked palette edits and undo converge in one collaborative transaction", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const id = a.editor.getSnapshot().elements[0]?.id;
  const token = createColorToken(a.editor, "Brand", "#123456");
  if (!id || !token) throw new Error("missing fixture");
  a.editor.selection.set([id]);
  bindSelectionColor(a.editor, "fill", token);
  wire.flush();
  updateColorToken(b.editor, token, "Brand", "#abcdef");
  wire.flush();
  expect(elementIn(a, id).visual.style?.fill).toBe("#abcdef");
  expectConverged(a, b, wire);
  expect(b.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, id).visual.style?.fill).toBe("#123456");
  expect(elementIn(a, id).visual.colorTokens?.fill).toBe(token);
  expectConverged(a, b, wire);
});

test("undoing a new binding restores its prior literal after concurrent palette repair", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const token = createColorToken(a.editor, "Brand", "#123456");
  const id = a.editor
    .getSnapshot()
    .elements.find((item) => item.type !== "design.token")?.id;
  if (!id || !token) throw new Error("missing fixture");
  a.editor.selection.set([id]);
  a.editor.setSelectionStyle({ fill: "#fedcba" });
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  updateColorToken(a.editor, token, "Brand", "#abcdef");
  b.editor.selection.set([id]);
  bindSelectionColor(b.editor, "fill", token);
  wire.flush();
  expect(elementIn(b, id).visual.style?.fill).toBe("#abcdef");
  expect(b.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(b, id).visual.colorTokens?.fill).toBeUndefined();
  expect(elementIn(b, id).visual.style?.fill).toBe("#fedcba");
  expectConverged(a, b, wire);
  for (let round = 0; round < 2; round++) {
    expect(b.binding.redo()).toBe(true);
    wire.flush();
    expect(elementIn(b, id).visual.colorTokens?.fill).toBe(token);
    expect(elementIn(b, id).visual.style?.fill).toBe("#abcdef");
    expect(b.binding.undo()).toBe(true);
    wire.flush();
    expect(elementIn(b, id).visual.style?.fill).toBe("#fedcba");
    expectConverged(a, b, wire);
  }
  b.binding.redo();
  wire.flush();
  a.editor.setSelectionStyle({ fill: "#001122" });
  wire.flush();
  b.binding.undo();
  wire.flush();
  expect(elementIn(b, id).visual.style?.fill).toBe("#001122");
  expect(elementIn(b, id).visual.colorTokens?.fill).toBeUndefined();
  expectConverged(a, b, wire);
});

for (const field of ["fill", "stroke", "color"] as const) {
  for (const initial of [undefined, "#fedcba"]) {
    test(`captured ${field} edits undo to ${initial ?? "no literal"} after palette repair`, () => {
      const wire = new Wire();
      const a = peer(wire, freeformDocument());
      a.binding.attach();
      const id = a.editor.getSnapshot().elements[0]?.id;
      const token = createColorToken(a.editor, "Brand", "#123456");
      if (!id || !token) throw new Error("missing fixture");
      a.editor.selection.set([id]);
      a.editor.setSelectionStyle({ [field]: initial ?? null });
      const b = peer(wire, undefined, 60_000);
      wire.flush();
      b.binding.attach();
      wire.flush();
      b.editor.selection.set([id]);
      // Both operations should be captured in one real Yjs undo entry.
      b.editor.setSelectionStyle({ [field]: "#334455" });
      bindSelectionColor(b.editor, field, token);
      updateColorToken(a.editor, token, "Brand", "#abcdef");
      wire.flush();
      expect(elementIn(b, id).visual.style?.[field]).toBe("#abcdef");
      expect(b.binding.undo()).toBe(true);
      wire.flush();
      expect(elementIn(b, id).visual.style?.[field]).toBe(initial);
      expect(elementIn(b, id).visual.colorTokens?.[field]).toBeUndefined();
      expect(b.binding.canUndo()).toBe(false);
      expectConverged(a, b, wire);
      expect(b.binding.redo()).toBe(true);
      wire.flush();
      expect(elementIn(b, id).visual.style?.[field]).toBe("#abcdef");
      expect(elementIn(b, id).visual.colorTokens?.[field]).toBe(token);
      expectConverged(a, b, wire);
    });
  }
}

test("mixed engineering and UI component edits converge without flattening database references", () => {
  const wire = new Wire();
  const initial = erdDocument();
  const a = peer(wire, initial);
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const designPage = a.editor.createPage({ name: "Mobile UI" });
  const component = insertUiBlock(a.editor, "button", { x: 20, y: 20 });
  const instance = a.editor.createComponentInstance(component, {
    x: 20,
    y: 100,
  });
  if (!instance) throw new Error("missing UI instance");
  const semantic = a.editor.store.get(instance)?.semantic as FrameSemantic;
  a.editor.apply([
    {
      type: "updateSemantic",
      id: instance,
      semantic: { ...semantic, autoRefresh: true },
    },
  ]);
  wire.flush();
  b.editor.setCurrentPage(designPage);
  const target = semantic.memberIds?.[0];
  const source = (b.editor.store.get(component)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target || !source) throw new Error("missing component labels");
  b.editor.setText(target, "Local mobile label");
  wire.flush();
  a.editor.setText(source, "Shared label");
  a.editor.selection.set([source]);
  a.editor.setSelectionStyle({ color: "#abcdef" });
  wire.flush();
  expect(b.editor.getText(target)).toBe("Local mobile label");
  expect(b.editor.store.get(target)?.visual.style?.color).toBe("#abcdef");
  for (const element of initial.elements) {
    expect(a.editor.store.get(element.id)?.semantic).toEqual(element.semantic);
    expect(b.editor.store.get(element.id)?.semantic).toEqual(element.semantic);
  }
  b.editor.setText("t-users", "customers");
  wire.flush();
  expect(a.editor.getText("t-users")).toBe("customers");
  expect(a.editor.store.get("e-rel-1")?.semantic).toEqual(
    initial.elements.find((element) => element.id === "e-rel-1")?.semantic,
  );
  expect(a.editor.getText(target)).toBe("Local mobile label");
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("automatic component refresh preserves remote overrides and synchronizes inherited styles", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const child = a.editor.buildElement("text.note", {
    semantic: { text: "Default" },
  });
  const source = a.editor.buildElement("frame", {
    semantic: { name: "Button", component: true, memberIds: [child.id] },
  });
  a.editor.apply([
    { type: "createElement", element: source },
    { type: "createElement", element: child },
  ]);
  const id = a.editor.createComponentInstance(source.id);
  if (!id) throw new Error("missing instance");
  wire.flush();
  const target = (b.editor.store.get(id)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target) throw new Error("missing target");
  b.editor.setText(target, "Remote override");
  wire.flush();
  a.editor.setText(child.id, "New default");
  a.editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(a.editor.store.get(id)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);
  a.editor.selection.set([child.id]);
  a.editor.setSelectionStyle({ fontSize: 32 });
  expect(a.editor.store.get(target)?.visual.style?.fontSize).toBe(32);
  wire.flush();
  expect(b.editor.getText(target)).toBe("Remote override");
  expect(b.editor.store.get(target)?.visual.style?.fontSize).toBe(32);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("frame clipping converges and remote toggles change picking", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const node = a.editor.buildElement("node.generic", {
    visual: { x: 1080, y: 1020, width: 60, height: 40 },
  });
  const frame = a.editor.buildElement("frame", {
    semantic: { name: "Screen", clipContent: true, memberIds: [node.id] },
    visual: { x: 1000, y: 1000, width: 100, height: 100 },
  });
  a.editor.apply([
    { type: "createElement", element: frame },
    { type: "createElement", element: node },
  ]);
  wire.flush();
  expect(b.editor.hitTest({ x: 1120, y: 1040 })).toBeNull();
  b.editor.apply([
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: { ...(frame.semantic as object), clipContent: false },
    },
  ]);
  wire.flush();
  expect(a.editor.hitTest({ x: 1120, y: 1040 })).toBe(node.id);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("auto layout membership and derived geometry converge between editors", () => {
  const wire = new Wire();
  const a = peer(wire, freeformDocument());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  const child = a.editor.buildElement("node.generic", {
    visual: { x: 50, y: 50, width: 100, height: 40 },
  });
  const frame = a.editor.buildElement("frame", {
    semantic: {
      name: "Layout",
      memberIds: [child.id],
      layout: {
        direction: "vertical",
        gap: 10,
        padding: 20,
        sizing: "hug",
        align: "start",
      },
    },
    visual: { x: 500, y: 500 },
  });
  a.editor.apply([
    { type: "createElement", element: child },
    { type: "createElement", element: frame },
  ]);
  wire.flush();
  expect(b.editor.getBounds(child.id)?.x).toBe(520);
  b.editor.resizeElement(child.id, { x: 520, y: 520, width: 200, height: 70 });
  wire.flush();
  expect(a.editor.getBounds(frame.id)?.width).toBe(240);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("rotated auto layout converges after concurrent rotation and gap edits", () => {
  const seed = new Editor();
  const first = seed.buildElement("node.generic", {
    semantic: { label: "First" },
    visual: { x: 0, y: 0, width: 100, height: 40 },
  });
  const second = seed.buildElement("node.generic", {
    semantic: { label: "Second" },
    visual: { x: 0, y: 0, width: 100, height: 40 },
  });
  const frame = seed.buildElement("frame", {
    semantic: {
      name: "Row",
      memberIds: [first.id, second.id],
      layout: {
        direction: "horizontal",
        gap: 10,
        padding: 20,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 0, y: 0, width: 400, height: 200 },
  });
  seed.apply(
    [frame, first, second].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(rotateElement(a.editor, frame.id, 90)).toBe(true);
  const remote = elementIn(b, frame.id).semantic as FrameSemantic;
  b.editor.apply([
    {
      type: "updateSemantic",
      id: frame.id,
      semantic: { ...remote, layout: { ...remote.layout, gap: 30 } },
    },
  ]);
  wire.flush();

  for (const client of [a, b]) {
    expect(elementIn(client, frame.id).visual.rotation).toBe(90);
    expect(elementIn(client, first.id).visual).toMatchObject({
      x: 210,
      y: -50,
      rotation: 90,
    });
    expect(elementIn(client, second.id).visual).toMatchObject({
      x: 210,
      y: 80,
      rotation: 90,
    });
  }
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("sequence reorder converges and peer-local undo preserves a remote rename", () => {
  const seed = new Editor();
  const actor = seed.createSequenceParticipant("actor", { x: 100, y: 80 });
  const service = seed.createSequenceParticipant("service", { x: 340, y: 80 });
  const initial = seed.getSnapshot();
  const wire = new Wire();
  const a = peer(wire, initial);
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(a.editor.moveSequenceElement(service, -1)).toBe(true);
  const remoteActor = elementIn(b, actor);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: actor,
      semantic: { ...(remoteActor.semantic as object), name: "Customer" },
    },
  ]);
  wire.flush();

  expect(elementIn(a, actor).semantic).toMatchObject({ name: "Customer" });
  expect(elementIn(b, service).visual.x).toBe(20);
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, actor).semantic).toMatchObject({ name: "Customer" });
  expect(elementIn(a, actor).visual.x).toBe(20);
  expect(elementIn(a, service).visual.x).toBe(260);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("group rotation converges and local undo preserves a remote member edit", () => {
  const seed = new Editor();
  const left = seed.buildElement("node.generic", {
    semantic: { label: "Left" },
    visual: { x: 0, y: 0, width: 100, height: 50 },
  });
  const right = seed.buildElement("node.generic", {
    semantic: { label: "Right" },
    visual: { x: 200, y: 0, width: 100, height: 50 },
  });
  const group = seed.buildElement("group", {
    semantic: { memberIds: [left.id, right.id] },
  });
  seed.apply(
    [left, right, group].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(rotateElement(a.editor, group.id, 90)).toBe(true);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: left.id,
      semantic: { label: "Remote label" },
    },
  ]);
  wire.flush();
  expect(elementIn(b, group.id).visual.rotation).toBe(90);
  expect(elementIn(b, left.id).visual).toMatchObject({
    x: 100,
    y: -100,
    rotation: 90,
  });
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, left.id).semantic).toEqual({ label: "Remote label" });
  expect(elementIn(a, left.id).visual).toEqual(left.visual);
  expect(elementIn(a, right.id).visual).toEqual(right.visual);
  expect(elementIn(a, group.id).visual.rotation).toBeUndefined();
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("multi-selection rotation converges and local undo preserves a remote edit", () => {
  const seed = new Editor();
  const left = seed.buildElement("node.generic", {
    semantic: { label: "Left" },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const right = seed.buildElement("node.generic", {
    semantic: { label: "Right" },
    visual: { x: 200, y: 0, width: 100, height: 100 },
  });
  seed.apply(
    [left, right].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.selection.set([left.id, right.id]);
  expect(rotateSelectionBy(a.editor, 90)).toBe(true);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: left.id,
      semantic: { label: "Remote label" },
    },
  ]);
  wire.flush();
  expect(elementIn(b, left.id).visual).toMatchObject({
    x: 100,
    y: -100,
    rotation: 90,
  });
  expect(elementIn(b, right.id).visual).toMatchObject({
    x: 100,
    y: 100,
    rotation: 90,
  });
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, left.id).semantic).toEqual({ label: "Remote label" });
  expect(elementIn(a, left.id).visual).toEqual(left.visual);
  expect(elementIn(a, right.id).visual).toEqual(right.visual);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("multi-selection resize converges and local undo preserves a remote edit", () => {
  const seed = new Editor();
  const left = seed.buildElement("node.generic", {
    semantic: { label: "Left" },
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const right = seed.buildElement("node.generic", {
    semantic: { label: "Right" },
    visual: { x: 200, y: 0, width: 100, height: 100 },
  });
  seed.apply(
    [left, right].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.selection.set([left.id, right.id]);
  const snapshot = createSelectionResizeSnapshot(a.editor);
  if (!snapshot) throw new Error("expected resize snapshot");
  expect(
    resizeSelection(a.editor, snapshot, {
      x: 0,
      y: 0,
      width: 600,
      height: 200,
    }),
  ).toBe(true);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: left.id,
      semantic: { label: "Remote label" },
    },
  ]);
  wire.flush();
  expect(elementIn(b, left.id).visual).toMatchObject({
    width: 200,
    height: 200,
  });
  expect(elementIn(b, right.id).visual).toMatchObject({
    x: 400,
    width: 200,
    height: 200,
  });
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, left.id).semantic).toEqual({ label: "Remote label" });
  expect(elementIn(a, left.id).visual).toEqual(left.visual);
  expect(elementIn(a, right.id).visual).toEqual(right.visual);
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("orthogonal connector routing converges with peer-local undo", () => {
  const seed = new Editor();
  const from = seed.buildElement("node.generic", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const to = seed.buildElement("node.generic", {
    visual: { x: 300, y: 200, width: 100, height: 100 },
  });
  const edge = seed.buildElement("edge.generic", {
    semantic: { from: from.id, to: to.id },
  });
  seed.apply(
    [from, to, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.apply([
    {
      type: "updateSemantic",
      id: edge.id,
      semantic: {
        from: from.id,
        to: to.id,
        routing: "orthogonal",
        routingAxis: "vertical",
        routingBend: 0.3,
        routingAvoidObstacles: false,
      },
    },
  ]);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: edge.id,
      semantic: { from: from.id, to: to.id, label: "Remote flow" },
    },
  ]);
  wire.flush();
  expect(elementIn(a, edge.id).semantic).toMatchObject({
    label: "Remote flow",
    routing: "orthogonal",
    routingAxis: "vertical",
    routingBend: 0.3,
    routingAvoidObstacles: false,
  });
  expect(elementIn(b, edge.id).semantic).toEqual(
    elementIn(a, edge.id).semantic,
  );
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, edge.id).semantic).toEqual({
    from: from.id,
    to: to.id,
    label: "Remote flow",
  });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("manual connector waypoints converge with peer-local undo", () => {
  const seed = new Editor();
  const from = seed.buildElement("node.generic", {
    visual: { x: 0, y: 0, width: 100, height: 100 },
  });
  const to = seed.buildElement("node.generic", {
    visual: { x: 300, y: 200, width: 100, height: 100 },
  });
  const edge = seed.buildElement("edge.generic", {
    semantic: { from: from.id, to: to.id },
  });
  seed.apply(
    [from, to, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.apply([
    {
      type: "updateSemantic",
      id: edge.id,
      semantic: {
        from: from.id,
        to: to.id,
        routing: "manual",
        routingWaypoints: [
          { u: 0.3, v: 60 },
          { u: 0.7, v: -30 },
        ],
      },
    },
  ]);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: edge.id,
      semantic: { from: from.id, to: to.id, label: "Remote manual flow" },
    },
  ]);
  wire.flush();
  expect(elementIn(a, edge.id).semantic).toMatchObject({
    label: "Remote manual flow",
    routing: "manual",
    routingWaypoints: [
      { u: 0.3, v: 60 },
      { u: 0.7, v: -30 },
    ],
  });
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, edge.id).semantic).toEqual({
    from: from.id,
    to: to.id,
    label: "Remote manual flow",
  });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("frame hierarchy rotation and membership freezing converge with isolated undo", () => {
  const seed = new Editor();
  const frame = seed.buildElement("frame", {
    semantic: { name: "Screen", clipContent: true },
    visual: { x: 0, y: 0, width: 200, height: 100 },
  });
  const child = seed.buildElement("node.generic", {
    semantic: { label: "Local label" },
    visual: { x: 20, y: 20, width: 40, height: 20 },
  });
  seed.apply(
    [frame, child].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(rotateElement(a.editor, frame.id, 90)).toBe(true);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: child.id,
      semantic: { label: "Remote label" },
    },
  ]);
  wire.flush();
  expect(elementIn(b, frame.id).visual.rotation).toBe(90);
  expect(elementIn(b, frame.id).semantic).toMatchObject({
    memberIds: [child.id],
  });
  expect(elementIn(b, child.id).visual).toMatchObject({
    x: 100,
    y: -20,
    rotation: 90,
  });
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, child.id).semantic).toEqual({ label: "Remote label" });
  expect(elementIn(a, child.id).visual).toEqual(child.visual);
  expect(elementIn(a, frame.id).visual.rotation).toBeUndefined();
  expect(
    (elementIn(a, frame.id).semantic as FrameSemantic).memberIds,
  ).toBeUndefined();
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("frame selection converges and local undo preserves a remote layer edit", () => {
  const seed = new Editor();
  const left = seed.buildElement("node.generic", {
    semantic: { label: "Left" },
    visual: { x: 0, y: 0, width: 100, height: 50 },
  });
  const right = seed.buildElement("node.generic", {
    semantic: { label: "Right" },
    visual: { x: 200, y: 0, width: 100, height: 50 },
  });
  seed.apply(
    [left, right].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  a.editor.selection.set([left.id, right.id]);
  const frame = a.editor.frameSelection();
  expect(frame).not.toBeNull();
  b.editor.apply([
    {
      type: "updateSemantic",
      id: left.id,
      semantic: { label: "Remote label" },
    },
  ]);
  wire.flush();
  if (!frame) throw new Error("expected frame");
  expect(elementIn(b, frame).semantic).toMatchObject({
    memberIds: [left.id, right.id],
  });
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(a.editor.store.has(frame)).toBe(false);
  expect(elementIn(a, left.id).semantic).toEqual({ label: "Remote label" });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("component geometry reset converges and local undo preserves a remote label", () => {
  const seed = new Editor();
  const child = seed.buildElement("node.generic", {
    semantic: { label: "Source" },
    visual: { x: 10, y: 10, width: 80, height: 30 },
  });
  const source = seed.buildElement("frame", {
    semantic: { name: "Card", component: true, memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 100, height: 60 },
  });
  seed.apply([
    { type: "createElement", element: source },
    { type: "createElement", element: child },
  ]);
  const instance = seed.createComponentInstance(source.id);
  if (!instance) throw new Error("missing component instance");
  const target = (seed.store.get(instance)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target) throw new Error("missing instance child");
  seed.apply([{ type: "updateVisual", id: target, visual: { width: 160 } }]);

  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  expect(
    a.editor.resetComponentOverride(instance, target, "geometry.width"),
  ).toBe(true);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: target,
      semantic: { label: "Remote label" },
    },
  ]);
  wire.flush();
  expect(elementIn(b, target).visual.width).toBe(80);
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(elementIn(a, target).visual.width).toBe(160);
  expect(elementIn(a, target).semantic).toEqual({ label: "Remote label" });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

test("automatic component structure converges and undoes independently", () => {
  const seed = new Editor();
  const child = seed.buildElement("node.generic", {
    semantic: { label: "Existing" },
    visual: { x: 10, y: 10, width: 80, height: 30 },
  });
  const source = seed.buildElement("frame", {
    semantic: { name: "Card", component: true, memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 100, height: 60 },
  });
  seed.apply([
    { type: "createElement", element: source },
    { type: "createElement", element: child },
  ]);
  const instance = seed.createComponentInstance(source.id);
  if (!instance) throw new Error("missing component instance");
  const target = (seed.store.get(instance)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target) throw new Error("missing instance child");
  seed.apply([
    {
      type: "updateSemantic",
      id: instance,
      semantic: {
        ...(seed.store.get(instance)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);

  const wire = new Wire();
  const a = peer(wire, seed.getSnapshot());
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();

  const added = a.editor.buildElement("node.generic", {
    semantic: { label: "Added" },
    visual: { x: 20, y: 35, width: 60, height: 20 },
  });
  a.editor.apply([
    { type: "createElement", element: added },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: {
        ...(elementIn(a, source.id).semantic as object),
        memberIds: [child.id, added.id],
      },
    },
  ]);
  b.editor.apply([
    {
      type: "updateSemantic",
      id: target,
      semantic: { label: "Remote override" },
    },
  ]);
  wire.flush();
  const addedTarget = (
    elementIn(a, instance).semantic as FrameSemantic
  ).instanceBindings?.find((binding) => binding.source === added.id)?.target;
  expect(addedTarget).toBeDefined();
  expect(elementIn(b, addedTarget ?? "").semantic).toEqual({ label: "Added" });
  expectConverged(a, b, wire);

  expect(a.binding.undo()).toBe(true);
  wire.flush();
  expect(a.editor.store.has(added.id)).toBe(false);
  expect(a.editor.store.has(addedTarget ?? "")).toBe(false);
  expect(elementIn(a, target).semantic).toEqual({ label: "Remote override" });
  expectConverged(a, b, wire);
  a.binding.detach();
  b.binding.detach();
});

function pageIn(peer: Peer, id: string): Page | undefined {
  return peer.editor.store.getPage(id);
}

/**
 * Transactions `doc` ran that did not come off the wire. A receiving peer
 * that echoes a remote change shows up here, whatever origin it used.
 */
function countOwnTransactions(doc: Y.Doc): () => number {
  let count = 0;
  doc.on("afterTransaction", (transaction: Y.Transaction) => {
    if (transaction.origin !== WIRE) {
      count += 1;
    }
  });
  return () => count;
}

/** How much of the doc's history this client itself wrote. */
function ownClock(doc: Y.Doc): number {
  return Y.decodeStateVector(Y.encodeStateVector(doc)).get(doc.clientID) ?? 0;
}

function columnNames(peer: Peer, id: string): string[] {
  const semantic = elementIn(peer, id).semantic as {
    readonly columns: readonly { readonly name: string }[];
  };
  return semantic.columns.map((column) => column.name);
}

function renameColumn(peer: Peer, id: string, at: number, name: string): void {
  const semantic = elementIn(peer, id).semantic as {
    readonly columns: readonly Record<string, unknown>[];
  };
  peer.editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...semantic,
        columns: semantic.columns.map((column, index) =>
          index === at ? { ...column, name } : column,
        ),
      },
    },
  ]);
}

/** Both editors and both docs agree, and nothing is left on the wire. */
function expectConverged(a: Peer, b: Peer, wire: Wire): void {
  expect(wire.queued).toBe(0);
  expect(a.editor.getSnapshot()).toEqual(b.editor.getSnapshot());
  expect(ydocToIr(a.doc).elements).toEqual(ydocToIr(b.doc).elements);
  // The stores are what the users see; the docs are what the peers exchange.
  // A binding that lost track of one direction shows up as a mismatch here.
  expect(a.editor.getSnapshot().elements).toEqual(
    ydocToIr(a.doc).elements as never,
  );
}

describe("CollabBinding", () => {
  let wire: Wire;
  let a: Peer;
  let b: Peer;

  beforeEach(() => {
    wire = new Wire();
    // A opens a document into an empty room: the defensive seed of design
    // 4.4. B then joins the room it published.
    a = peer(wire, erdDocument());
    a.binding.attach();
    b = peer(wire);
    wire.flush();
    b.binding.attach();
    wire.flush();
  });

  test("shares the seeded document with a joining peer", () => {
    expect(b.editor.getSnapshot().title).toBe("Shop domain");
    expect(b.editor.currentPageId).toBe("p1");
    expectConverged(a, b, wire);
  });

  test("keeps a concurrent move and column rename (design 7.1)", () => {
    a.editor.moveElements([{ id: "t-users", x: 640, y: 220 }]);
    renameColumn(b, "t-users", 1, "email_address");
    wire.flush();

    for (const side of [a, b]) {
      expect(elementIn(side, "t-users").visual).toEqual({
        x: 640,
        y: 220,
        width: 280,
      });
      expect(columnNames(side, "t-users")).toEqual(["id", "email_address"]);
    }
    expectConverged(a, b, wire);
  });

  test("keeps concurrent renames of two columns of one table", () => {
    renameColumn(a, "t-users", 0, "uuid");
    renameColumn(b, "t-users", 1, "email_address");
    wire.flush();

    expect(columnNames(a, "t-users")).toEqual(["uuid", "email_address"]);
    expectConverged(a, b, wire);
  });

  test("merges database defaults, generated columns and indexes with peer-local undo", () => {
    const aSemantic = elementIn(a, "t-users").semantic as ErdTableSemantic;
    const bSemantic = elementIn(b, "t-users").semantic as ErdTableSemantic;
    a.editor.apply([
      {
        type: "updateSemantic",
        id: "t-users",
        semantic: {
          ...aSemantic,
          columns: aSemantic.columns.map((column) =>
            column.id === "c-id"
              ? { ...column, defaultExpression: "gen_random_uuid()" }
              : column,
          ),
        },
      },
    ]);
    b.editor.apply([
      {
        type: "updateSemantic",
        id: "t-users",
        semantic: {
          ...bSemantic,
          columns: bSemantic.columns.map((column) =>
            column.id === "c-email"
              ? { ...column, generatedExpression: "lower(email)" }
              : column,
          ),
          indexes: [
            {
              id: "i-users-email",
              columns: ["c-email", "c-id"],
              unique: true,
            },
          ],
        },
      },
    ]);
    wire.flush();

    for (const side of [a, b]) {
      const semantic = elementIn(side, "t-users").semantic as ErdTableSemantic;
      expect(semantic.columns[0]?.defaultExpression).toBe("gen_random_uuid()");
      expect(semantic.columns[1]?.generatedExpression).toBe("lower(email)");
      expect(semantic.indexes).toEqual([
        {
          id: "i-users-email",
          columns: ["c-email", "c-id"],
          unique: true,
        },
      ]);
    }
    expect(b.binding.undo()).toBe(true);
    wire.flush();
    for (const side of [a, b]) {
      const semantic = elementIn(side, "t-users").semantic as ErdTableSemantic;
      expect(semantic.columns[0]?.defaultExpression).toBe("gen_random_uuid()");
      expect(semantic.columns[1]?.generatedExpression).toBeUndefined();
      expect(semantic.indexes).toBeUndefined();
    }
    expectConverged(a, b, wire);
  });

  test("merges a check expression with an unrelated table edit and local undo", () => {
    const aSemantic = elementIn(a, "t-users").semantic as ErdTableSemantic;
    a.editor.apply([
      {
        type: "updateSemantic",
        id: "t-users",
        semantic: {
          ...aSemantic,
          checks: [{ id: "ck-email", expression: "length(email) > 0" }],
        },
      },
    ]);
    wire.flush();

    const currentA = elementIn(a, "t-users").semantic as ErdTableSemantic;
    const currentB = elementIn(b, "t-users").semantic as ErdTableSemantic;
    a.editor.apply([
      {
        type: "updateSemantic",
        id: "t-users",
        semantic: {
          ...currentA,
          checks: currentA.checks?.map((check) => ({
            ...check,
            expression: "length(email) >= 3",
          })),
        },
      },
    ]);
    b.editor.apply([
      {
        type: "updateSemantic",
        id: "t-users",
        semantic: { ...currentB, tableName: "customer_accounts" },
      },
    ]);
    wire.flush();

    for (const side of [a, b]) {
      const semantic = elementIn(side, "t-users").semantic as ErdTableSemantic;
      expect(semantic.tableName).toBe("customer_accounts");
      expect(semantic.checks?.[0]?.expression).toBe("length(email) >= 3");
    }
    expect(a.binding.undo()).toBe(true);
    wire.flush();
    for (const side of [a, b]) {
      const semantic = elementIn(side, "t-users").semantic as ErdTableSemantic;
      expect(semantic.tableName).toBe("customer_accounts");
      expect(semantic.checks?.[0]?.expression).toBe("length(email) > 0");
    }
    expectConverged(a, b, wire);
  });

  test("does not echo a remote change back onto the wire", () => {
    let localTransactions = 0;
    b.doc.on("afterTransaction", (transaction: Y.Transaction) => {
      if (transaction.origin === b.binding.origin) {
        localTransactions += 1;
      }
    });

    a.editor.moveElements([{ id: "t-orders", x: 900, y: 40 }]);
    wire.flush();

    expect(elementIn(b, "t-orders").visual.x).toBe(900);
    expect(localTransactions).toBe(0);
    expectConverged(a, b, wire);
  });

  test("ignores page switches and history-only notifications", () => {
    let transactions = 0;
    a.doc.on("afterTransaction", () => {
      transactions += 1;
    });

    a.editor.setCurrentPage("p1");
    a.editor.beginBatch();
    a.editor.endBatch();

    expect(transactions).toBe(0);
  });

  test("propagates creates and deletes", () => {
    const id = a.editor.createElement("node.generic", {
      page: "p1",
      semantic: { label: "New" },
      visual: { x: 5, y: 5 },
    });
    wire.flush();
    expect(elementIn(b, id).semantic).toEqual({ label: "New" });

    b.editor.deleteElements([id]);
    wire.flush();
    expect(a.editor.store.has(id)).toBe(false);
    expectConverged(a, b, wire);
  });

  test("re-inserts an element the local user is still editing", () => {
    // The add-wins branch of design 4.1: the Y entry is gone while the store
    // still holds the element. Deleting it under the binding's own origin
    // reproduces that state exactly — the observers skip local origins, so
    // the store is left believing the element is still there.
    Y.transact(
      a.doc,
      () => {
        a.doc.getMap<unknown>(ELEMENTS_KEY).delete("t-users");
      },
      a.binding.origin,
    );
    wire.flush();
    expect(b.editor.store.has("t-users")).toBe(false);

    a.editor.moveElements([{ id: "t-users", x: 1, y: 2 }]);
    wire.flush();

    expect(elementIn(b, "t-users").visual).toEqual({
      x: 1,
      y: 2,
      width: 280,
    });
    expect(columnNames(b, "t-users")).toEqual(["id", "email"]);
    expectConverged(a, b, wire);
  });

  test("undo reverts only the local user's work", () => {
    a.editor.moveElements([{ id: "t-users", x: 640, y: 220 }]);
    wire.flush();
    renameColumn(b, "t-users", 1, "email_address");
    wire.flush();

    expect(a.binding.canUndo()).toBe(true);
    expect(a.binding.undo()).toBe(true);
    wire.flush();

    // A's move is gone; B's rename — which arrived in between — is untouched.
    expect(elementIn(a, "t-users").visual).toEqual({
      x: 100,
      y: 100,
      width: 280,
    });
    expect(columnNames(a, "t-users")).toEqual(["id", "email_address"]);
    expectConverged(a, b, wire);

    expect(a.binding.canRedo()).toBe(true);
    expect(a.binding.redo()).toBe(true);
    wire.flush();
    expect(elementIn(a, "t-users").visual.x).toBe(640);
    expectConverged(a, b, wire);
  });

  test("has nothing to undo before the local user edits", () => {
    expect(a.binding.canUndo()).toBe(false);
    expect(a.binding.undo()).toBe(false);

    renameColumn(b, "t-users", 0, "identifier");
    wire.flush();

    // B's edit reached A's store but not A's undo stack.
    expect(columnNames(a, "t-users")).toEqual(["identifier", "email"]);
    expect(a.binding.canUndo()).toBe(false);
  });

  test("announces undo availability", () => {
    const seen: boolean[] = [];
    const stop = a.binding.onUndoState(() => {
      seen.push(a.binding.canUndo());
    });
    a.editor.moveElements([{ id: "t-users", x: 3, y: 3 }]);
    expect(seen).toEqual([true]);
    stop();
    a.binding.undo();
    expect(seen).toEqual([true]);
  });

  test("reloads the document when a peer replaces it wholesale", () => {
    applyIrToDoc(b.doc, freeformDocument());
    wire.flush();

    expect(a.editor.getSnapshot().title).toBe("Whiteboard");
    expect(a.editor.currentPageId).toBe("p1");
    expect(a.editor.store.has("s-maybe")).toBe(true);
    expect(a.editor.store.has("t-users")).toBe(false);
    expectConverged(a, b, wire);

    // The shadow was rebuilt, so the next local edit still diffs correctly.
    a.editor.moveElements([{ id: "n-idea", x: 11, y: 12 }]);
    wire.flush();
    expect(elementIn(b, "n-idea").visual.x).toBe(11);
    expectConverged(a, b, wire);
  });

  test("propagates a created page with its name and kind", () => {
    const id = a.editor.createPage({
      id: "p2",
      name: "Flows",
      kind: "sequence",
    });
    expect(a.editor.currentPageId).toBe(id);
    wire.flush();

    expect(pageIn(b, id)).toEqual({
      id,
      name: "Flows",
      kind: "sequence",
      order: a.editor.store.getPage(id)?.order,
    });
    expect(b.editor.store.listPages().map((page) => page.id)).toEqual([
      "p1",
      "p2",
    ]);
    expectConverged(a, b, wire);
  });

  test("propagates renames and kind changes as single-key writes", () => {
    const keys: string[] = [];
    b.doc.getMap<unknown>(PAGES_KEY).observeDeep((events) => {
      for (const event of events) {
        for (const key of event.changes.keys.keys()) {
          keys.push(`${event.path.join(".")}:${key}`);
        }
      }
    });

    expect(a.editor.renamePage("p1", "Entities")).toBe(true);
    wire.flush();
    expect(pageIn(b, "p1")?.name).toBe("Entities");

    expect(b.editor.setPageKind("p1", "freeform")).toBe(true);
    wire.flush();
    expect(pageIn(a, "p1")).toEqual({
      id: "p1",
      name: "Entities",
      kind: "freeform",
    });

    // One key per command, on both the receiving and the writing side.
    expect(keys).toEqual(["p1:name", "p1:kind"]);
    expectConverged(a, b, wire);
  });

  test("deletes a page together with its elements on the peer", () => {
    a.editor.createPage({ id: "p2", name: "Scratch" });
    const id = a.editor.createElement("node.generic", {
      page: "p2",
      semantic: { label: "Draft" },
      visual: { x: 1, y: 1 },
    });
    wire.flush();
    expect(pageIn(b, "p2")?.name).toBe("Scratch");
    expect(elementIn(b, id).page).toBe("p2");

    const ownTransactions = countOwnTransactions(b.doc);
    expect(a.editor.deletePage("p2")).toBe(true);
    wire.flush();

    expect(pageIn(b, "p2")).toBeUndefined();
    expect(b.editor.store.has(id)).toBe(false);
    expect(b.editor.currentPageId).toBe("p1");
    // The page and element removals arrive as one transaction, and the
    // receiving side writes nothing back for either half.
    expect(ownTransactions()).toBe(0);
    expectConverged(a, b, wire);
  });

  test("undoing a page create removes it from the peer", () => {
    a.editor.createPage({ id: "p2", name: "Scratch" });
    wire.flush();
    expect(pageIn(b, "p2")).toBeDefined();

    expect(a.binding.undo()).toBe(true);
    wire.flush();
    expect(pageIn(a, "p2")).toBeUndefined();
    expect(pageIn(b, "p2")).toBeUndefined();
    expect(a.editor.currentPageId).toBe("p1");
    expectConverged(a, b, wire);

    expect(a.binding.redo()).toBe(true);
    wire.flush();
    expect(pageIn(b, "p2")?.name).toBe("Scratch");
    expectConverged(a, b, wire);
  });

  test("undoes a duplicated page and its copies as one step", () => {
    const copy = a.editor.duplicatePage("p1");
    if (copy === null) {
      throw new Error("duplicatePage returned null");
    }
    wire.flush();
    expect(pageIn(b, copy)?.name).toBe("Domain model copy");
    expect(b.editor.store.getPageElements(copy)).toHaveLength(3);
    expect(b.editor.store.size).toBe(6);

    expect(a.binding.undo()).toBe(true);
    wire.flush();
    expect(pageIn(b, copy)).toBeUndefined();
    expect(b.editor.store.size).toBe(3);
    expectConverged(a, b, wire);
  });

  test("does not echo a remote page change back onto the wire", () => {
    const clockBefore = ownClock(b.doc);
    const ownTransactions = countOwnTransactions(b.doc);

    a.editor.createPage({ id: "p2", name: "Scratch" });
    wire.flush();
    expect(a.editor.renamePage("p2", "Notes")).toBe(true);
    wire.flush();
    expect(a.editor.deletePage("p2")).toBe(true);
    wire.flush();

    expect(pageIn(b, "p2")).toBeUndefined();
    expect(ownTransactions()).toBe(0);
    expect(ownClock(b.doc)).toBe(clockBefore);
    expectConverged(a, b, wire);
  });

  test("re-inserts a page the local user is still editing", () => {
    // The page-level twin of the element add-wins case: the Y entry is gone
    // while the store still holds the page.
    Y.transact(
      a.doc,
      () => {
        a.doc.getMap<unknown>(PAGES_KEY).delete("p1");
      },
      a.binding.origin,
    );
    wire.flush();
    expect(pageIn(b, "p1")).toBeUndefined();

    expect(a.editor.renamePage("p1", "Back")).toBe(true);
    wire.flush();

    expect(pageIn(b, "p1")).toEqual({ id: "p1", name: "Back", kind: "erd" });
    expectConverged(a, b, wire);
  });

  test("stops syncing after detach and is safe to detach twice", () => {
    a.binding.detach();
    a.binding.detach();

    a.editor.moveElements([{ id: "t-orders", x: 12, y: 12 }]);
    wire.flush();

    expect(elementIn(b, "t-orders").visual.x).toBe(460);
    expect(a.binding.canUndo()).toBe(false);
  });
});
