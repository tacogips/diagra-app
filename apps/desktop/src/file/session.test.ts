// The document lifecycle, headless.
//
// The backend is mocked with an in-memory filesystem and the autosave timer
// is driven by hand, so every branch — debounce, conflict, failed open —
// runs without a Tauri runtime and without waiting on wall-clock time.

import { describe, expect, test } from "bun:test";
import { createDefaultRegistry, Editor } from "@diagra/core";
import { serializeDocument } from "@diagra/io";
import { seed } from "../seed.ts";
import type {
  FileBackend,
  FileChangedListener,
  RecentEntry,
} from "./backend.ts";
import { DocumentSession, type TimerHandle } from "./session.ts";

interface MockBackend extends FileBackend {
  readonly files: Map<string, string>;
  /** Queued dialog answers, consumed in order. */
  readonly openAnswers: (string | null)[];
  readonly saveAnswers: (string | null)[];
  readonly writes: { path: string; contents: string }[];
  readonly watched: (string | null)[];
  emitFileChanged(path: string): void;
  failNextRead(message: string): void;
  failNextWrite(message: string): void;
}

function createMockBackend(): MockBackend {
  const files = new Map<string, string>();
  const listeners = new Set<FileChangedListener>();
  let recent: RecentEntry[] = [];
  let clock = 0;
  let readFailure: string | null = null;
  let writeFailure: string | null = null;

  const backend: MockBackend = {
    available: true,
    files,
    openAnswers: [],
    saveAnswers: [],
    writes: [],
    watched: [],
    emitFileChanged(path: string) {
      for (const listener of [...listeners]) {
        listener(path);
      }
    },
    failNextRead(message: string) {
      readFailure = message;
    },
    failNextWrite(message: string) {
      writeFailure = message;
    },
    pickOpenPath() {
      return Promise.resolve(backend.openAnswers.shift() ?? null);
    },
    pickSavePath() {
      return Promise.resolve(backend.saveAnswers.shift() ?? null);
    },
    readDocument(path: string) {
      if (readFailure !== null) {
        const message = readFailure;
        readFailure = null;
        return Promise.reject(new Error(message));
      }
      const contents = files.get(path);
      return contents === undefined
        ? Promise.reject(new Error(`no such file: ${path}`))
        : Promise.resolve(contents);
    },
    writeDocument(path: string, contents: string) {
      if (writeFailure !== null) {
        const message = writeFailure;
        writeFailure = null;
        return Promise.reject(new Error(message));
      }
      files.set(path, contents);
      backend.writes.push({ path, contents });
      return Promise.resolve();
    },
    listRecent() {
      return Promise.resolve(recent);
    },
    addRecent(path: string) {
      clock += 1;
      recent = [
        { path, openedAtMs: clock },
        ...recent.filter((entry) => entry.path !== path),
      ];
      return Promise.resolve(recent);
    },
    removeRecent(path: string) {
      recent = recent.filter((entry) => entry.path !== path);
      return Promise.resolve(recent);
    },
    watch(path: string) {
      backend.watched.push(path);
      return Promise.resolve();
    },
    unwatch() {
      backend.watched.push(null);
      return Promise.resolve();
    },
    onFileChanged(listener: FileChangedListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return backend;
}

/** A scheduler the test fires by hand, so debounce timing is exact. */
function createTimers() {
  const pending = new Map<number, () => void>();
  let nextHandle = 0;
  return {
    get pendingCount(): number {
      return pending.size;
    },
    schedule(callback: () => void): TimerHandle {
      nextHandle += 1;
      pending.set(nextHandle, callback);
      return nextHandle;
    },
    cancel(handle: TimerHandle): void {
      pending.delete(handle as number);
    },
    /** Fire every scheduled callback, newest scheduling wins by insertion. */
    fire(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
  };
}

interface Harness {
  readonly editor: Editor;
  readonly backend: MockBackend;
  readonly session: DocumentSession;
  readonly timers: ReturnType<typeof createTimers>;
  /** Let queued backend promises settle. */
  settle(): Promise<void>;
}

function createHarness(options: { seeded?: boolean } = {}): Harness {
  const editor = new Editor({ registry: createDefaultRegistry() });
  if (options.seeded !== false) {
    seed(editor);
  }
  const backend = createMockBackend();
  const timers = createTimers();
  const session = new DocumentSession({
    editor,
    backend,
    autosaveDelayMs: 1000,
    scheduleTimer: (callback) => timers.schedule(callback),
    cancelTimer: (handle) => {
      timers.cancel(handle);
    },
  });
  return {
    editor,
    backend,
    session,
    timers,
    async settle() {
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
      }
    },
  };
}

function addShape(editor: Editor, label: string): void {
  editor.createElement("shape.geo", {
    visual: { x: 10, y: 10, width: 100, height: 60 },
    semantic: { geo: "rect", label },
  });
}

describe("a new session", () => {
  test("starts untitled, clean and without a conflict", () => {
    const { session } = createHarness();
    const state = session.state();

    expect(state.filePath).toBeNull();
    expect(state.fileName).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.conflict).toBeNull();
    expect(state.status).toBe("idle");
  });

  test("marks the document dirty when the editor changes", () => {
    const { editor, session } = createHarness();

    addShape(editor, "one");

    expect(session.state().dirty).toBe(true);
  });

  test("does not autosave an untitled document", () => {
    const { editor, timers } = createHarness();

    addShape(editor, "one");

    expect(timers.pendingCount).toBe(0);
  });

  test("newDocument empties the editor and stays clean", async () => {
    const { editor, session } = createHarness();

    await session.newDocument();

    expect(editor.store.listElements()).toEqual([]);
    expect(session.state().dirty).toBe(false);
    expect(session.state().filePath).toBeNull();
  });
});

describe("saving", () => {
  test("save without a path asks for one and writes there", async () => {
    const { session, backend } = createHarness();
    backend.saveAnswers.push("/docs/a.jsonl");

    const saved = await session.save();

    expect(saved).toBe(true);
    expect(backend.files.has("/docs/a.jsonl")).toBe(true);
    expect(session.state().filePath).toBe("/docs/a.jsonl");
    expect(session.state().fileName).toBe("a.jsonl");
    expect(session.state().dirty).toBe(false);
  });

  test("a cancelled save-as writes nothing", async () => {
    const { session, backend } = createHarness();
    backend.saveAnswers.push(null);

    const saved = await session.save();

    expect(saved).toBe(false);
    expect(backend.writes).toEqual([]);
    expect(session.state().filePath).toBeNull();
  });

  test("save-as records the file as recent and watches it", async () => {
    const { session, backend } = createHarness();
    backend.saveAnswers.push("/docs/a.jsonl");

    await session.save();

    expect(session.state().recent.map((entry) => entry.path)).toEqual([
      "/docs/a.jsonl",
    ]);
    expect(backend.watched).toEqual(["/docs/a.jsonl"]);
  });

  test("a failed write leaves the document dirty and reports it", async () => {
    const { session, backend } = createHarness();
    backend.saveAnswers.push("/docs/a.jsonl");
    backend.failNextWrite("disk full");

    const saved = await session.save();

    expect(saved).toBe(false);
    expect(session.state().error).toContain("disk full");
    expect(session.state().filePath).toBeNull();
  });

  test("concurrent saves are serialized and the last one wins", async () => {
    const { editor, session, backend } = createHarness();
    backend.saveAnswers.push("/docs/a.jsonl");
    await session.save();

    addShape(editor, "one");
    const first = session.save();
    addShape(editor, "two");
    const second = session.save();
    await Promise.all([first, second]);

    expect(backend.writes).toHaveLength(3);
    expect(backend.files.get("/docs/a.jsonl")).toBe(
      serializeDocument(editor.getSnapshot()),
    );
  });
});

describe("autosave", () => {
  async function fileBackedHarness(): Promise<Harness> {
    const harness = createHarness();
    harness.backend.saveAnswers.push("/docs/a.jsonl");
    await harness.session.save();
    return harness;
  }

  test("coalesces rapid edits into a single write", async () => {
    const harness = await fileBackedHarness();
    const before = harness.backend.writes.length;

    addShape(harness.editor, "one");
    addShape(harness.editor, "two");
    addShape(harness.editor, "three");

    expect(harness.timers.pendingCount).toBe(1);
    harness.timers.fire();
    await harness.settle();

    expect(harness.backend.writes.length - before).toBe(1);
    expect(harness.session.state().dirty).toBe(false);
  });

  test("writes the state as of the moment it fires", async () => {
    const harness = await fileBackedHarness();

    addShape(harness.editor, "one");
    harness.timers.fire();
    await harness.settle();

    expect(harness.backend.files.get("/docs/a.jsonl")).toBe(
      serializeDocument(harness.editor.getSnapshot()),
    );
  });

  test("an explicit save cancels the pending autosave", async () => {
    const harness = await fileBackedHarness();
    const before = harness.backend.writes.length;

    addShape(harness.editor, "one");
    await harness.session.save();
    harness.timers.fire();
    await harness.settle();

    expect(harness.backend.writes.length - before).toBe(1);
  });

  test("flush writes a pending autosave immediately", async () => {
    const harness = await fileBackedHarness();
    const before = harness.backend.writes.length;

    addShape(harness.editor, "one");
    const flushed = await harness.session.flush();

    expect(flushed).toBe(true);
    expect(harness.backend.writes.length - before).toBe(1);
    expect(await harness.session.flush()).toBe(false);
  });
});

describe("opening", () => {
  async function savedFile(label: string): Promise<{
    readonly path: string;
    readonly text: string;
  }> {
    const harness = createHarness();
    addShape(harness.editor, label);
    harness.backend.saveAnswers.push("/docs/source.jsonl");
    await harness.session.save();
    const text = harness.backend.files.get("/docs/source.jsonl");
    if (text === undefined) {
      throw new Error("the fixture failed to save");
    }
    return { path: "/docs/source.jsonl", text };
  }

  test("open loads the file, stays clean and starts watching", async () => {
    const source = await savedFile("from disk");
    const harness = createHarness();
    harness.backend.files.set(source.path, source.text);
    harness.backend.openAnswers.push(source.path);

    const opened = await harness.session.open();

    expect(opened).toBe(true);
    expect(harness.session.state().filePath).toBe(source.path);
    expect(harness.session.state().dirty).toBe(false);
    expect(harness.backend.watched).toEqual([source.path]);
    expect(harness.session.state().recent.map((entry) => entry.path)).toEqual([
      source.path,
    ]);
  });

  test("a cancelled open changes nothing", async () => {
    const { session, editor } = createHarness();
    const before = editor.store.size;

    const opened = await session.open();

    expect(opened).toBe(false);
    expect(editor.store.size).toBe(before);
    expect(session.state().filePath).toBeNull();
  });

  test("a file that cannot be parsed leaves the document untouched", async () => {
    const { session, editor, backend } = createHarness();
    backend.files.set("/docs/broken.jsonl", "not json at all\n");
    const before = serializeDocument(editor.getSnapshot());

    const opened = await session.openPath("/docs/broken.jsonl");

    expect(opened).toBe(false);
    expect(serializeDocument(editor.getSnapshot())).toBe(before);
    expect(session.state().filePath).toBeNull();
    expect(session.state().error).toContain("could not parse");
  });

  test("a recent entry that no longer opens is dropped from the list", async () => {
    const source = await savedFile("from disk");
    const harness = createHarness();
    harness.backend.files.set(source.path, source.text);
    harness.backend.openAnswers.push(source.path);
    await harness.session.open();
    expect(harness.session.state().recent).toHaveLength(1);

    harness.backend.files.delete(source.path);
    const reopened = await harness.session.openPath(source.path);

    expect(reopened).toBe(false);
    expect(harness.session.state().recent).toEqual([]);
    expect(harness.session.state().error).toContain("could not open");
  });
});

describe("external changes", () => {
  async function openedHarness(): Promise<Harness> {
    const harness = createHarness();
    harness.backend.saveAnswers.push("/docs/a.jsonl");
    await harness.session.save();
    return harness;
  }

  test("our own write echoing back raises no conflict", async () => {
    const harness = await openedHarness();

    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    expect(harness.session.state().conflict).toBeNull();
  });

  test("a change to another file is ignored", async () => {
    const harness = await openedHarness();
    harness.backend.files.set("/docs/other.jsonl", "irrelevant\n");

    harness.backend.emitFileChanged("/docs/other.jsonl");
    await harness.settle();

    expect(harness.session.state().conflict).toBeNull();
  });

  test("a read that fails mid-write raises no conflict", async () => {
    const harness = await openedHarness();
    harness.backend.failNextRead("resource temporarily unavailable");

    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    // Catching the file between the temp write and the rename must not put
    // a banner in front of the user; the next event carries settled bytes.
    expect(harness.session.state().conflict).toBeNull();
    expect(harness.session.state().error).toBeNull();
  });

  test("different bytes on disk raise a conflict", async () => {
    const harness = await openedHarness();
    const external = `${harness.backend.files.get("/docs/a.jsonl")}`.replace(
      '"title":"Untitled"',
      '"title":"Edited elsewhere"',
    );
    harness.backend.files.set("/docs/a.jsonl", external);

    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    expect(harness.session.state().conflict?.diskText).toBe(external);
  });

  test("reload takes the file and clears the conflict", async () => {
    const harness = await openedHarness();
    const other = createHarness();
    addShape(other.editor, "written elsewhere");
    const external = serializeDocument(other.editor.getSnapshot());
    harness.backend.files.set("/docs/a.jsonl", external);
    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    const reloaded = await harness.session.resolveConflict("reload");

    expect(reloaded).toBe(true);
    expect(harness.session.state().conflict).toBeNull();
    expect(harness.session.state().dirty).toBe(false);
    expect(serializeDocument(harness.editor.getSnapshot())).toBe(external);
  });

  test("keeping mine re-dirties the document and the next save overwrites", async () => {
    const harness = await openedHarness();
    const mine = serializeDocument(harness.editor.getSnapshot());
    harness.backend.files.set("/docs/a.jsonl", '{"kind":"document"}\n');
    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    const kept = await harness.session.resolveConflict("keep");

    expect(kept).toBe(true);
    expect(harness.session.state().conflict).toBeNull();
    expect(harness.session.state().dirty).toBe(true);

    harness.timers.fire();
    await harness.settle();

    expect(harness.backend.files.get("/docs/a.jsonl")).toBe(mine);
  });

  test("an unparseable file on disk keeps the banner up", async () => {
    const harness = await openedHarness();
    harness.backend.files.set("/docs/a.jsonl", "garbage\n");
    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    const reloaded = await harness.session.resolveConflict("reload");

    expect(reloaded).toBe(false);
    expect(harness.session.state().conflict).not.toBeNull();
    expect(harness.session.state().error).toContain("could not parse");
  });

  test("a disposed session stops reacting to file changes", async () => {
    const harness = await openedHarness();
    harness.backend.files.set("/docs/a.jsonl", "garbage\n");

    harness.session.dispose();
    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    expect(harness.session.state().conflict).toBeNull();
  });
});

describe("the save/open round trip", () => {
  test("reopening a saved document reproduces the file byte for byte", async () => {
    const author = createHarness();
    addShape(author.editor, "a rectangle");
    author.backend.saveAnswers.push("/docs/roundtrip.jsonl");
    await author.session.save();
    const onDisk = author.backend.files.get("/docs/roundtrip.jsonl");
    expect(onDisk).toBeDefined();

    const reader = createHarness({ seeded: false });
    reader.backend.files.set("/docs/roundtrip.jsonl", onDisk as string);
    const opened = await reader.session.openPath("/docs/roundtrip.jsonl");
    expect(opened).toBe(true);

    // The document the reader holds must serialize to the same bytes, and
    // saving it again must not rewrite the file differently.
    expect(serializeDocument(reader.editor.getSnapshot())).toBe(
      onDisk as string,
    );
    await reader.session.save();
    expect(reader.backend.files.get("/docs/roundtrip.jsonl")).toBe(
      onDisk as string,
    );
  });
});
