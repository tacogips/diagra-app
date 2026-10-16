import { expect, test } from "bun:test";
import { DocumentChangeMonitor, type DocumentChange } from "@nodetto/core";
import { createFileDocumentChangeSource } from "./change-source.ts";

test("file source serializes pending native watches, stops callbacks immediately and filters other files", async () => {
  const listeners = new Set<(path: string) => void>();
  const calls: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const source = createFileDocumentChangeSource({
    onFileChanged(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async watch(path) {
      calls.push(`watch ${path}`);
      if (path === "old") await gate;
    },
    async unwatch() {
      calls.push("unwatch");
    },
  });
  const changes: DocumentChange[] = [];
  const monitor = new DocumentChangeMonitor();
  const first = monitor.watch(source, "old", (change) => changes.push(change));
  await Promise.resolve();
  const second = monitor.watch(source, "new", (change) => changes.push(change));
  for (const listener of listeners) listener("old");
  expect(changes).toEqual([]);
  release();
  await Promise.all([first, second]);
  expect(calls).toEqual(["watch old", "unwatch", "watch new"]);
  for (const listener of listeners) {
    listener("old");
    listener("new");
  }
  expect(changes).toEqual([{ documentId: "new" }]);
  const closing = monitor.close();
  expect(listeners.size).toBe(0);
  await closing;
  expect(calls.at(-1)).toBe("unwatch");
});
