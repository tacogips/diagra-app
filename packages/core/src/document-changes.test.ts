import { expect, test } from "bun:test";
import {
  DocumentChangeMonitor,
  type DocumentChange,
  type DocumentChangeSource,
} from "./document-changes.ts";

function source(ready = Promise.resolve()) {
  let notify: (change: DocumentChange) => void = () => {};
  let closed = 0;
  const changes: DocumentChangeSource = {
    watch(_id, listener) {
      notify = listener;
      return {
        ready,
        close: () => {
          closed++;
        },
      };
    },
  };
  return {
    changes,
    emit: (id: string) => notify({ documentId: id }),
    closed: () => closed,
  };
}

test("one consumer switches local/cloud sources and rejects stale or wrong-resource notifications", async () => {
  const local = source();
  const cloud = source();
  const monitor = new DocumentChangeMonitor();
  const seen: string[] = [];
  await monitor.watch(local.changes, "/drawing.jsonl", (change) =>
    seen.push(change.documentId),
  );
  local.emit("/other.jsonl");
  local.emit("/drawing.jsonl");
  await monitor.watch(cloud.changes, "room", (change) =>
    seen.push(change.documentId),
  );
  local.emit("/drawing.jsonl");
  cloud.emit("room");
  await monitor.close();
  cloud.emit("room");
  expect(seen).toEqual(["/drawing.jsonl", "room"]);
  expect(local.closed()).toBe(1);
  expect(cloud.closed()).toBe(1);
});

test("late setup cannot reactivate a source after switching or closing", async () => {
  let ready: () => void = () => {};
  const pending = source(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const next = source();
  const monitor = new DocumentChangeMonitor();
  const seen: string[] = [];
  const opening = monitor.watch(pending.changes, "old", () => seen.push("old"));
  await monitor.watch(next.changes, "new", () => seen.push("new"));
  ready();
  await opening;
  pending.emit("old");
  next.emit("new");
  expect(seen).toEqual(["new"]);
  expect(pending.closed()).toBe(1);
  await monitor.close();
});

test("a failed watch is cleaned up and a different source can be opened", async () => {
  const broken = source(Promise.reject(new Error("offline")));
  const next = source();
  const monitor = new DocumentChangeMonitor();
  await expect(monitor.watch(broken.changes, "bad", () => {})).rejects.toThrow(
    "offline",
  );
  expect(broken.closed()).toBe(1);
  await monitor.watch(next.changes, "new", () => {});
  await monitor.close();
  await monitor.close();
  expect(next.closed()).toBe(1);
});
