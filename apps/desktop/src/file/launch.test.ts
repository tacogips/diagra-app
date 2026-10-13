import { expect, test } from "bun:test";
import {
  type LaunchBackend,
  openRequestedDocument,
  watchOpenRequests,
} from "./launch.ts";

function queue(paths: string[]): LaunchBackend {
  return {
    takePaths: () => Promise.resolve(paths.splice(0)),
    onOpenRequested: () => Promise.resolve(() => {}),
  };
}

/** A backend whose listener registration completes only when told to. */
function slowListener(paths: string[]) {
  let listener: (() => void) | null = null;
  let register: () => void = () => {};
  let unsubscribed = false;
  const takes: number[] = [];
  const backend: LaunchBackend = {
    takePaths: () => {
      takes.push(paths.length);
      return Promise.resolve(paths.splice(0));
    },
    onOpenRequested: (next) =>
      new Promise((resolve) => {
        register = () => {
          listener = next;
          resolve(() => {
            unsubscribed = true;
          });
        };
      }),
  };
  return {
    backend,
    takes,
    register: () => register(),
    request(path: string) {
      paths.push(path);
      listener?.();
    },
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

test("opens the newest requested document once", async () => {
  const backend = queue(["/tmp/old.jsonl", "/tmp/new.jsonl"]);
  const opened: string[] = [];
  await openRequestedDocument(backend, (path) => opened.push(path));
  await openRequestedDocument(backend, (path) => opened.push(path));
  expect(opened).toEqual(["/tmp/new.jsonl"]);
});

test("does nothing when no document was requested", async () => {
  const opened: string[] = [];
  await openRequestedDocument(queue([]), (path) => opened.push(path));
  expect(opened).toEqual([]);
});

test("drains the queue only after the listener is registered", async () => {
  const launch = slowListener([]);
  const opened: string[] = [];
  watchOpenRequests(
    launch.backend,
    (path) => opened.push(path),
    () => true,
  );
  await settle();
  // Before registration nothing is taken, so a request queued in this
  // window cannot be missed by an early, empty drain.
  expect(launch.takes).toEqual([]);
  launch.request("/tmp/raced.jsonl");
  launch.register();
  await settle();
  expect(opened).toEqual(["/tmp/raced.jsonl"]);

  launch.request("/tmp/later.jsonl");
  await settle();
  expect(opened).toEqual(["/tmp/raced.jsonl", "/tmp/later.jsonl"]);
});

test("holds requests while opening is not allowed and opens them on flush", async () => {
  const launch = slowListener(["/tmp/at-launch.jsonl"]);
  const opened: string[] = [];
  let allowed = false;
  const watcher = watchOpenRequests(
    launch.backend,
    (path) => opened.push(path),
    () => allowed,
  );
  launch.register();
  await settle();
  launch.request("/tmp/while-cloud.jsonl");
  await settle();
  // Nothing was taken: the paths stay queued on the Rust side.
  expect(launch.takes).toEqual([]);
  expect(opened).toEqual([]);

  allowed = true;
  watcher.flush();
  await settle();
  expect(opened).toEqual(["/tmp/while-cloud.jsonl"]);
  watcher.flush();
  await settle();
  expect(opened).toEqual(["/tmp/while-cloud.jsonl"]);
});

test("stopping before registration unsubscribes and opens nothing", async () => {
  const launch = slowListener(["/tmp/a.jsonl"]);
  const opened: string[] = [];
  const watcher = watchOpenRequests(
    launch.backend,
    (path) => opened.push(path),
    () => true,
  );
  watcher.stop();
  launch.register();
  await settle();
  expect(launch.unsubscribed).toBe(true);
  expect(opened).toEqual([]);
  expect(launch.takes).toEqual([]);
});

test("a path taken just before the cloud takes over opens on the next flush", async () => {
  let release: (paths: string[]) => void = () => {};
  let allowed = true;
  const opened: string[] = [];
  const backend: LaunchBackend = {
    takePaths: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    onOpenRequested: () => Promise.resolve(() => {}),
  };
  const watcher = watchOpenRequests(
    backend,
    (path) => opened.push(path),
    () => allowed,
  );
  await settle();
  // The take is in flight when ownership changes.
  allowed = false;
  release(["/tmp/raced.jsonl"]);
  await settle();
  expect(opened).toEqual([]);

  allowed = true;
  watcher.flush();
  release([]);
  await settle();
  expect(opened).toEqual(["/tmp/raced.jsonl"]);
});
