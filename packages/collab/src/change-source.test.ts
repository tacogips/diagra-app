import { expect, test } from "bun:test";
import {
  Editor,
  DocumentChangeMonitor,
  type DocumentChange,
} from "@nodetto/core";
import * as Y from "yjs";
import { createYjsDocumentChangeSource } from "./change-source.ts";
import { applyIrToDoc, ELEMENTS_KEY, PAGES_KEY } from "./ydoc.ts";

test("cloud notifications coalesce a transaction and preserve nested element identities and origin", async () => {
  const doc = new Y.Doc();
  const editor = new Editor();
  const id = editor.createElement("node.generic");
  applyIrToDoc(doc, editor.getSnapshot());
  const changes: DocumentChange[] = [];
  const monitor = new DocumentChangeMonitor();
  await monitor.watch(createYjsDocumentChangeSource(doc), "room", (change) =>
    changes.push(change),
  );
  const elements = doc.getMap<Y.Map<unknown>>(ELEMENTS_KEY);
  const element = elements.get(id);
  const origin = Symbol("remote-client");
  doc.transact(() => {
    (element?.get("visual") as Y.Map<unknown>).set("x", 80);
    (element?.get("semantic") as Y.Map<unknown>).set("label", "Peer edited");
  }, origin);
  expect(changes).toEqual([{ documentId: "room", elementIds: [id], origin }]);
  changes.length = 0;
  doc.transact(() => {
    (element?.get("visual") as Y.Map<unknown>).set("x", 120);
    const page = doc
      .getMap<Y.Map<unknown>>(PAGES_KEY)
      .get(editor.currentPageId);
    page?.set("name", "Peer renamed page");
  }, origin);
  expect(changes).toEqual([{ documentId: "room", origin }]);
  await monitor.close();
  elements.delete(id);
  expect(changes).toHaveLength(1);
  doc.destroy();
});
