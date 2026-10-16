import type { DocumentChangeSource } from "@nodetto/core";
import type { FileBackend } from "./backend.ts";

/** Native notifications become resource invalidations, just like cloud push. */
export function createFileDocumentChangeSource(
  backend: Pick<FileBackend, "watch" | "unwatch" | "onFileChanged">,
): DocumentChangeSource {
  // The native backend watches one path. Serialize setup/teardown so a slow
  // close for an old path cannot unwatch the document opened after it.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
  return {
    watch(documentId, listener) {
      let closed = false;
      const stop = backend.onFileChanged((path) => {
        if (!closed && path === documentId) listener({ documentId });
      });
      const ready = enqueue(() =>
        closed ? Promise.resolve() : backend.watch(documentId),
      );
      let closing: Promise<void> | undefined;
      return {
        ready,
        close() {
          if (closing) return closing;
          closed = true;
          stop();
          closing = enqueue(() => backend.unwatch());
          return closing;
        },
      };
    },
  };
}
