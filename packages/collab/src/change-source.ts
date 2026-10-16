import type { DocumentChangeSource } from "@nodetto/core";
import type * as Y from "yjs";
import { ELEMENTS_KEY, META_KEY, PAGES_KEY } from "./ydoc.ts";

type Events = readonly Y.YEvent<Y.AbstractType<unknown>>[];

/** The cloud API's synchronized Y.Doc is a push change source. No REST polling. */
export function createYjsDocumentChangeSource(
  doc: Y.Doc,
): DocumentChangeSource {
  const elements = doc.getMap<unknown>(ELEMENTS_KEY);
  const meta = doc.getMap<unknown>(META_KEY);
  const pages = doc.getMap<unknown>(PAGES_KEY);
  return {
    watch(documentId, listener) {
      let closed = false;
      const pending = new WeakMap<
        Y.Transaction,
        { whole: boolean; ids: Set<string> }
      >();
      const changes = (transaction: Y.Transaction) => {
        let value = pending.get(transaction);
        if (!value) {
          value = { whole: false, ids: new Set() };
          pending.set(transaction, value);
        }
        return value;
      };
      const onElements = (events: Events, transaction: Y.Transaction) => {
        const change = changes(transaction);
        // Read paths here, while Yjs sets currentTarget to the elements map.
        // At afterTransaction an event's target may have changed again.
        for (const event of events) {
          const [head] = event.path;
          if (head === undefined) {
            for (const id of event.changes.keys.keys()) change.ids.add(id);
          } else if (typeof head === "string") change.ids.add(head);
        }
      };
      const onDocument = (_events: Events, transaction: Y.Transaction) => {
        changes(transaction).whole = true;
      };
      const changed = (transaction: Y.Transaction) => {
        const change = pending.get(transaction);
        pending.delete(transaction);
        if (closed || !change || (!change.whole && !change.ids.size)) return;
        listener({
          documentId,
          origin: transaction.origin,
          ...(change.whole ? {} : { elementIds: [...change.ids] }),
        });
      };
      elements.observeDeep(onElements);
      meta.observeDeep(onDocument);
      pages.observeDeep(onDocument);
      doc.on("afterTransaction", changed);
      return {
        ready: Promise.resolve(),
        close() {
          closed = true;
          elements.unobserveDeep(onElements);
          meta.unobserveDeep(onDocument);
          pages.unobserveDeep(onDocument);
          doc.off("afterTransaction", changed);
        },
      };
    },
  };
}
