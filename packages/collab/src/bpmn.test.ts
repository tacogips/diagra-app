import { describe, expect, test } from "bun:test";
import { Editor } from "@diagra/core";
import type { BpmnEventSemantic, BpmnTaskSemantic, Document } from "@diagra/ir";
import * as Y from "yjs";
import { CollabBinding } from "./binding.ts";
import { bpmnDocument } from "./test-fixtures.ts";
import { irToYDoc, ydocToIr } from "./ydoc.ts";

const WIRE = Symbol("wire");

class Wire {
  private readonly pending = new Map<Y.Doc, Uint8Array[]>();
  private readonly docs: Y.Doc[] = [];

  join(doc: Y.Doc): void {
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
      if (origin === WIRE) return;
      for (const peer of this.docs) {
        if (peer !== doc) this.pending.get(peer)?.push(update);
      }
    });
  }

  flush(): void {
    for (let round = 0; round < 20; round += 1) {
      let delivered = false;
      for (const doc of this.docs) {
        const queue = this.pending.get(doc) ?? [];
        if (queue.length === 0) continue;
        this.pending.set(doc, []);
        delivered = true;
        for (const update of queue) Y.applyUpdate(doc, update, WIRE);
      }
      if (!delivered) return;
    }
    throw new Error("wire never settled");
  }

  get queued(): number {
    let total = 0;
    for (const queue of this.pending.values()) total += queue.length;
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
  const binding = new CollabBinding({ editor, doc });
  return { editor, doc, binding };
}

function startPeers(document: Document): { wire: Wire; a: Peer; b: Peer } {
  const wire = new Wire();
  const a = peer(wire, document);
  a.binding.attach();
  const b = peer(wire);
  wire.flush();
  b.binding.attach();
  wire.flush();
  return { wire, a, b };
}

function element(peer: Peer, id: string) {
  const found = peer.editor.store.get(id);
  if (!found) throw new Error(`missing BPMN fixture element ${id}`);
  return found;
}

function expectConverged(a: Peer, b: Peer, wire: Wire): void {
  expect(wire.queued).toBe(0);
  expect(a.editor.getSnapshot()).toEqual(b.editor.getSnapshot());
  expect(ydocToIr(a.doc).pages).toEqual(ydocToIr(b.doc).pages);
  expect(ydocToIr(a.doc).elements).toEqual(ydocToIr(b.doc).elements);
  expect(a.editor.getSnapshot().elements).toEqual(
    ydocToIr(a.doc).elements as never,
  );
}

function finishPeers(...peers: Peer[]): void {
  for (const item of peers) {
    item.binding.detach();
    item.doc.destroy();
  }
}

function sortedById(document: Document): Document {
  return {
    ...document,
    pages: [...document.pages].sort((a, b) => a.id.localeCompare(b.id)),
    elements: [...document.elements].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

describe("BPMN collaboration", () => {
  test("round-trips the BPMN page, label bounds, and event definitions", () => {
    const source = bpmnDocument();
    const doc = irToYDoc(source);
    try {
      const actual = ydocToIr(doc);
      expect(actual).toEqual(sortedById(source));
      expect(actual.pages[0]?.kind).toBe("bpmn");
      expect(
        actual.elements.find((item) => item.id === "event-end")?.visual
          .labelBounds,
      ).toEqual({ x: 620, y: 270, width: 100, height: 24 });
      expect(
        (
          actual.elements.find((item) => item.id === "event-message")
            ?.semantic as BpmnEventSemantic
        ).definitions,
      ).toEqual([{ id: "d-msg", kind: "message", ref: "purchase" }]);
    } finally {
      doc.destroy();
    }
  });

  test("merges a task parent move with a concurrent rename", () => {
    const { wire, a, b } = startPeers(bpmnDocument());
    try {
      const taskA = element(a, "task-request");
      const taskASemantic = taskA.semantic as BpmnTaskSemantic;
      a.editor.apply([
        {
          type: "updateSemantic",
          id: taskA.id,
          semantic: { ...taskASemantic, parent: "lane-purchasing" },
        },
      ]);

      const taskB = element(b, "task-request");
      const taskBSemantic = taskB.semantic as BpmnTaskSemantic;
      b.editor.apply([
        {
          type: "updateSemantic",
          id: taskB.id,
          semantic: { ...taskBSemantic, name: "Review request" },
        },
      ]);
      wire.flush();

      for (const side of [a, b]) {
        expect(element(side, "task-request").semantic).toMatchObject({
          parent: "lane-purchasing",
          name: "Review request",
        });
        expect(side.editor.getSnapshot().pages[0]?.kind).toBe("bpmn");
      }
      expectConverged(a, b, wire);
    } finally {
      finishPeers(a, b);
    }
  });

  test("merges event definition edits by id", () => {
    const { wire, a, b } = startPeers(bpmnDocument());
    try {
      const eventA = element(a, "event-message");
      const eventASemantic = eventA.semantic as BpmnEventSemantic;
      a.editor.apply([
        {
          type: "updateSemantic",
          id: eventA.id,
          semantic: {
            ...eventASemantic,
            definitions: eventASemantic.definitions.map((definition) =>
              definition.id === "d-msg"
                ? { ...definition, ref: "purchase-notice" }
                : definition,
            ),
          },
        },
      ]);

      const eventB = element(b, "event-message");
      const eventBSemantic = eventB.semantic as BpmnEventSemantic;
      b.editor.apply([
        {
          type: "updateSemantic",
          id: eventB.id,
          semantic: {
            ...eventBSemantic,
            definitions: [
              ...eventBSemantic.definitions,
              {
                id: "d-timer",
                kind: "timer",
                timer: { type: "duration", value: "PT1H" },
              },
            ],
          },
        },
      ]);
      wire.flush();

      for (const side of [a, b]) {
        expect(
          (element(side, "event-message").semantic as BpmnEventSemantic)
            .definitions,
        ).toEqual([
          { id: "d-msg", kind: "message", ref: "purchase-notice" },
          {
            id: "d-timer",
            kind: "timer",
            timer: { type: "duration", value: "PT1H" },
          },
        ]);
      }
      expectConverged(a, b, wire);
    } finally {
      finishPeers(a, b);
    }
  });
});
