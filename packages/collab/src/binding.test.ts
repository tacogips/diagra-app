import { beforeEach, describe, expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import type { Document, Element } from "@diagra/ir";
import * as Y from "yjs";
import { CollabBinding } from "./binding.ts";
import { erdDocument, freeformDocument } from "./test-fixtures.ts";
import { ELEMENTS_KEY, applyIrToDoc, ydocToIr } from "./ydoc.ts";

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

function peer(wire: Wire, document?: Document): Peer {
  const editor = new Editor(document ? { document } : {});
  const doc = new Y.Doc();
  wire.join(doc);
  const binding = new CollabBinding({ editor, doc, captureTimeout: 0 });
  return { editor, doc, binding };
}

function elementIn(peer: Peer, id: string): Element {
  const element = peer.editor.store.get(id);
  if (!element) {
    throw new Error(`element ${id} missing from the store`);
  }
  return element;
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

  test("stops syncing after detach and is safe to detach twice", () => {
    a.binding.detach();
    a.binding.detach();

    a.editor.moveElements([{ id: "t-orders", x: 12, y: 12 }]);
    wire.flush();

    expect(elementIn(b, "t-orders").visual.x).toBe(460);
    expect(a.binding.canUndo()).toBe(false);
  });
});
