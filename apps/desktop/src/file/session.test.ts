// The document lifecycle, headless.
//
// The backend is mocked with an in-memory filesystem and the autosave timer
// is driven by hand, so every branch — debounce, conflict, failed open —
// runs without a Tauri runtime and without waiting on wall-clock time.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDefaultRegistry, Editor } from "@nodetto/core";
import { parseDocument, serializeDocument } from "@nodetto/io";
import { seed } from "../seed.ts";
import type {
  FileBackend,
  FileChangedListener,
  RecentEntry,
} from "./backend.ts";
import { DocumentSession, type TimerHandle } from "./session.ts";

const BPMN_FIXTURE = readFileSync(
  `${import.meta.dir}/../../../../packages/io/src/__fixtures__/bpmn/purchase-request.bpmn`,
  "utf8",
);

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
  /** Hold every subsequent write until `releaseWrites`. */
  blockWrites(): void;
  releaseWrites(): void;
}

/**
 * How the Rust `read_document` command reports a missing file; the session
 * matches this prefix to decide whether a recent entry is dead. Pinned on
 * the Rust side by `read_document_reports_a_missing_file`.
 */
const MISSING_FILE_ERROR = "file not found";

function createMockBackend(): MockBackend {
  const files = new Map<string, string>();
  const listeners = new Set<FileChangedListener>();
  let recent: RecentEntry[] = [];
  let clock = 0;
  let readFailure: string | null = null;
  let writeFailure: string | null = null;
  let writeGate: Promise<void> | null = null;
  let openWriteGate: (() => void) | null = null;

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
    blockWrites() {
      writeGate = new Promise((resolve) => {
        openWriteGate = resolve;
      });
    },
    releaseWrites() {
      openWriteGate?.();
      writeGate = null;
      openWriteGate = null;
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
        ? Promise.reject(new Error(`${MISSING_FILE_ERROR}: ${path}`))
        : Promise.resolve(contents);
    },
    writeDocument(path: string, contents: string) {
      if (writeFailure !== null) {
        const message = writeFailure;
        writeFailure = null;
        return Promise.reject(new Error(message));
      }
      // Captured now: a write already waiting must not be freed by a gate
      // opened for a later one.
      return (writeGate ?? Promise.resolve()).then(() => {
        files.set(path, contents);
        backend.writes.push({ path, contents });
      });
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
  test("import detaches the old file and never autosaves imported content over it", async () => {
    const { editor, backend, session, timers } = createHarness();
    const original = serializeDocument(editor.getSnapshot());
    backend.files.set("old.jsonl", original);
    await session.openPath("old.jsonl");
    addShape(editor, "pending old edit");
    const imported = {
      ...editor.getSnapshot(),
      title: "Imported",
      elements: [],
    };
    await session.importDocument(imported, "design.jsonl");
    expect(session.state().filePath).toBeNull();
    expect(session.state().fileName).toBe("design.jsonl");
    expect(session.state().dirty).toBe(true);
    expect(timers.pendingCount).toBe(0);
    expect(backend.files.get("old.jsonl")).toBe(original);
    expect(editor.getSnapshot().title).toBe("Imported");
  });

  test("invalid imports leave the open document and file association untouched", async () => {
    const { editor, backend, session } = createHarness();
    const before = editor.getSnapshot();
    backend.files.set("old.jsonl", serializeDocument(before));
    await session.openPath("old.jsonl");
    await expect(
      session.importDocument({ ...before, schemaVersion: -1 }, "broken.jsonl"),
    ).rejects.toThrow();
    expect(editor.getSnapshot()).toEqual(before);
    expect(session.state().filePath).toBe("old.jsonl");
  });
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

  test("opening Mermaid imports a detached document and never rewrites the source", async () => {
    const harness = createHarness();
    const path = "/docs/order-flow.mmd";
    const source = `sequenceDiagram
  actor user as User
  participant api as API
  user->>api: Create order
`;
    harness.backend.files.set(path, source);

    const opened = await harness.session.openPath(path);

    expect(opened).toBe(true);
    expect(harness.session.state()).toMatchObject({
      filePath: null,
      fileName: "order-flow.mmd",
      dirty: true,
      error: null,
    });
    expect(harness.editor.getSnapshot().title).toBe("order-flow");
    expect(harness.editor.getSnapshot().pages[0]?.kind).toBe("sequence");
    expect(harness.editor.store.listElements()).toHaveLength(3);
    expect(harness.backend.watched).toEqual([]);

    addShape(harness.editor, "local edit");
    harness.timers.fire();
    await harness.settle();
    expect(harness.backend.writes).toEqual([]);
    expect(harness.backend.files.get(path)).toBe(source);
  });

  test("a malformed Mermaid file leaves the current document and association intact", async () => {
    const source = await savedFile("original");
    const harness = createHarness();
    harness.backend.files.set(source.path, source.text);
    await harness.session.openPath(source.path);
    const before = serializeDocument(harness.editor.getSnapshot());
    harness.backend.files.set(
      "/docs/broken.mermaid",
      "flowchart LR\n  A --> B",
    );

    const opened = await harness.session.openPath("/docs/broken.mermaid");

    expect(opened).toBe(false);
    expect(serializeDocument(harness.editor.getSnapshot())).toBe(before);
    expect(harness.session.state().filePath).toBe(source.path);
    expect(harness.session.state().error).toContain(
      "could not import broken.mermaid",
    );
    expect(harness.backend.watched).toEqual([source.path]);
  });

  test("opening BPMN imports a detached document and never rewrites the source", async () => {
    const harness = createHarness();
    const path = "/docs/purchase-request.bpmn";
    harness.backend.files.set(path, BPMN_FIXTURE);

    expect(await harness.session.openPath(path)).toBe(true);
    expect(harness.session.state()).toMatchObject({
      filePath: null,
      fileName: "purchase-request.bpmn",
      dirty: true,
      importWarnings: [],
      error: null,
    });
    expect(harness.editor.getSnapshot().pages[0]?.kind).toBe("bpmn");
    expect(
      harness.editor.store
        .listElements()
        .filter((element) =>
          ["bpmn.event", "bpmn.task", "bpmn.gateway"].includes(element.type),
        ),
    ).toHaveLength(13);
    expect(harness.backend.watched).toEqual([]);

    addShape(harness.editor, "local edit");
    harness.timers.fire();
    await harness.settle();
    expect(harness.backend.writes).toEqual([]);
    expect(harness.backend.files.get(path)).toBe(BPMN_FIXTURE);
  });

  test("a malformed BPMN file leaves the current document and association intact", async () => {
    const source = await savedFile("original");
    const harness = createHarness();
    harness.backend.files.set(source.path, source.text);
    await harness.session.openPath(source.path);
    const before = serializeDocument(harness.editor.getSnapshot());
    harness.backend.files.set("/docs/broken.bpmn", "<bpmn:definitions");

    expect(await harness.session.openPath("/docs/broken.bpmn")).toBe(false);
    expect(serializeDocument(harness.editor.getSnapshot())).toBe(before);
    expect(harness.session.state().filePath).toBe(source.path);
    expect(harness.session.state().error).toContain(
      "could not import broken.bpmn",
    );
    expect(harness.backend.watched).toEqual([source.path]);
  });

  test("BPMN import warnings are surfaced and cleared by a JSONL open", async () => {
    const harness = createHarness();
    const path = "/docs/unsupported.bpmn";
    const source =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs"><bpmn:process id="Process"><bpmn:transaction id="Transaction_A"><bpmn:task id="Nested_A" /></bpmn:transaction></bpmn:process></bpmn:definitions>';
    harness.backend.files.set(path, source);

    expect(await harness.session.openPath(path)).toBe(true);
    expect(harness.session.state().importWarnings).toHaveLength(1);
    expect(harness.session.state().importWarnings[0]?.element).toBe(
      "transaction",
    );

    const jsonlPath = "/docs/after-import.jsonl";
    harness.backend.files.set(
      jsonlPath,
      serializeDocument(harness.editor.getSnapshot()),
    );
    expect(await harness.session.openPath(jsonlPath)).toBe(true);
    expect(harness.session.state().importWarnings).toEqual([]);
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

  test("a recent entry that is only unreachable stays in the list", async () => {
    const source = await savedFile("from disk");
    const harness = createHarness();
    harness.backend.files.set(source.path, source.text);
    harness.backend.openAnswers.push(source.path);
    await harness.session.open();

    // The file is still there; the read failed for another reason (an
    // offline share, a lock). Pruning it would make the user hunt for it.
    harness.backend.failNextRead("resource temporarily unavailable");
    const reopened = await harness.session.openPath(source.path);

    expect(reopened).toBe(false);
    expect(harness.session.state().recent.map((entry) => entry.path)).toEqual([
      source.path,
    ]);
    expect(harness.session.state().error).toContain("could not open");
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

  test("a change to the same document is shown live without a banner", async () => {
    const harness = await openedHarness();
    const external = `${harness.backend.files.get("/docs/a.jsonl")}`.replace(
      '"title":"Untitled"',
      '"title":"Edited elsewhere"',
    );
    harness.backend.files.set("/docs/a.jsonl", external);

    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    expect(harness.session.state().conflict).toBeNull();
    expect(harness.session.state().dirty).toBe(false);
    expect(harness.editor.store.getMeta().title).toBe("Edited elsewhere");
  });

  test("a different document on disk raises a conflict", async () => {
    const harness = await openedHarness();
    const external =
      '{"kind":"document","schemaVersion":1,"id":"x","title":"Elsewhere"}\n';
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

  test("an edit made while the banner is up is not written to disk", async () => {
    const harness = await openedHarness();
    const external =
      '{"kind":"document","schemaVersion":1,"id":"x","title":"Elsewhere"}\n';
    harness.backend.files.set("/docs/a.jsonl", external);
    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();
    expect(harness.session.state().conflict).not.toBeNull();

    addShape(harness.editor, "while deciding");
    harness.timers.fire();
    await harness.settle();

    // The banner is the question "which version wins?". Autosaving over the
    // external change would answer it for the user.
    expect(harness.session.state().dirty).toBe(true);
    expect(harness.backend.files.get("/docs/a.jsonl")).toBe(external);
  });

  test("an autosave armed before the event does not land once the banner is up", async () => {
    const harness = await openedHarness();
    addShape(harness.editor, "edited just before");
    expect(harness.timers.pendingCount).toBe(1);

    const external =
      '{"kind":"document","schemaVersion":1,"id":"x","title":"Elsewhere"}\n';
    harness.backend.files.set("/docs/a.jsonl", external);
    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    expect(harness.session.state().conflict).not.toBeNull();
    expect(harness.timers.pendingCount).toBe(0);
    harness.timers.fire();
    await harness.settle();
    expect(harness.backend.files.get("/docs/a.jsonl")).toBe(external);
  });

  test("an explicit save while the banner is up keeps mine and clears it", async () => {
    const harness = await openedHarness();
    const external =
      '{"kind":"document","schemaVersion":1,"id":"x","title":"Elsewhere"}\n';
    harness.backend.files.set("/docs/a.jsonl", external);
    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();

    const saved = await harness.session.save();

    expect(saved).toBe(true);
    expect(harness.backend.files.get("/docs/a.jsonl")).toBe(
      serializeDocument(harness.editor.getSnapshot()),
    );
    // Disk now holds our document, so the banner's `diskText` is stale and
    // the question it asked is answered.
    expect(harness.session.state().conflict).toBeNull();
  });

  test("a conflict raised during a write survives that write", async () => {
    const harness = await openedHarness();
    const external =
      '{"kind":"document","schemaVersion":1,"id":"x","title":"Elsewhere"}\n';

    harness.backend.blockWrites();
    addShape(harness.editor, "one");
    harness.timers.fire();
    await harness.settle();

    // The external change lands while our bytes are still in flight; our
    // write will overwrite it, so the banner is the only way back to it.
    harness.backend.files.set("/docs/a.jsonl", external);
    harness.backend.emitFileChanged("/docs/a.jsonl");
    await harness.settle();
    expect(harness.session.state().conflict?.diskText).toBe(external);

    harness.backend.releaseWrites();
    await harness.settle();

    expect(harness.session.state().conflict?.diskText).toBe(external);
    // Still actionable: reloading is how the user gets the overwritten
    // version back.
    expect(await harness.session.resolveConflict("reload")).toBe(true);
    expect(harness.editor.store.getMeta().title).toBe("Elsewhere");
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

describe("live outside changes (nodetto-cli and other writers)", () => {
  async function opened(): Promise<Harness> {
    const harness = createHarness({ seeded: false });
    addShape(harness.editor, "first");
    harness.backend.saveAnswers.push("/docs/live.jsonl");
    await harness.session.save();
    return harness;
  }

  /** What another writer would save: the disk document plus `change`. */
  function writeElsewhere(
    harness: Harness,
    change: (editor: Editor) => void,
  ): string {
    const other = new Editor({
      document: parseDocument(
        `${harness.backend.files.get("/docs/live.jsonl")}`,
      ),
    });
    change(other);
    const text = serializeDocument(other.getSnapshot());
    harness.backend.files.set("/docs/live.jsonl", text);
    return text;
  }

  test("a clean document takes an outside change in place and keeps the camera", async () => {
    const harness = await opened();
    harness.editor.camera.set({ x: 120, y: -40, z: 1.5 });
    const external = writeElsewhere(harness, (editor) =>
      addShape(editor, "drawn by the CLI"),
    );

    harness.backend.emitFileChanged("/docs/live.jsonl");
    await harness.settle();

    expect(harness.session.state().conflict).toBeNull();
    expect(harness.session.state().dirty).toBe(false);
    expect(serializeDocument(harness.editor.getSnapshot())).toBe(external);
    expect(harness.editor.camera.get()).toEqual({ x: 120, y: -40, z: 1.5 });
    expect(harness.timers.pendingCount).toBe(0);
    expect(harness.session.state().outsideChange).toEqual({
      added: 1,
      updated: 0,
      removed: 0,
      merged: false,
    });

    // The note is about the last outside change; a local edit retires it.
    addShape(harness.editor, "the person draws");
    expect(harness.session.state().outsideChange).toBeNull();
  });

  test("unsaved local edits merge with a disjoint outside change and autosave the result", async () => {
    const harness = await opened();
    addShape(harness.editor, "drawn by the person");
    writeElsewhere(harness, (editor) => addShape(editor, "drawn by the CLI"));

    harness.backend.emitFileChanged("/docs/live.jsonl");
    await harness.settle();

    const labels = () =>
      harness.editor.store
        .listElements()
        .map((element) => (element.semantic as { label?: string }).label)
        .sort();
    expect(harness.session.state().conflict).toBeNull();
    expect(labels()).toEqual([
      "drawn by the CLI",
      "drawn by the person",
      "first",
    ]);
    expect(harness.session.state().dirty).toBe(true);
    expect(harness.session.state().outsideChange?.merged).toBe(true);

    harness.timers.fire();
    await harness.settle();
    const saved = parseDocument(
      `${harness.backend.files.get("/docs/live.jsonl")}`,
    );
    expect(saved.elements).toHaveLength(3);
  });

  test("the same field changed on both sides keeps mine and asks", async () => {
    const harness = await opened();
    const id = harness.editor.store.listElements()[0]?.id ?? "";
    harness.editor.apply([
      { type: "updateSemantic", id, semantic: { geo: "rect", label: "mine" } },
    ]);
    const external = writeElsewhere(harness, (editor) =>
      editor.apply([
        {
          type: "updateSemantic",
          id,
          semantic: { geo: "rect", label: "theirs" },
        },
      ]),
    );

    harness.backend.emitFileChanged("/docs/live.jsonl");
    await harness.settle();

    expect(harness.session.state().conflict?.mergedConflicts).toEqual([id]);
    expect(
      (harness.editor.store.get(id)?.semantic as { label?: string }).label,
    ).toBe("mine");
    expect(harness.timers.pendingCount).toBe(0);
    expect(await harness.session.resolveConflict("reload")).toBe(true);
    expect(serializeDocument(harness.editor.getSnapshot())).toBe(external);
  });

  test("a move and a rename of the same element both survive", async () => {
    const harness = await opened();
    const id = harness.editor.store.listElements()[0]?.id ?? "";
    harness.editor.moveElements([{ id, x: 300, y: 200 }]);
    writeElsewhere(harness, (editor) =>
      editor.apply([
        {
          type: "updateSemantic",
          id,
          semantic: { geo: "rect", label: "renamed" },
        },
      ]),
    );

    harness.backend.emitFileChanged("/docs/live.jsonl");
    await harness.settle();

    const element = harness.editor.store.get(id);
    expect(harness.session.state().conflict).toBeNull();
    expect(element?.visual.x).toBe(300);
    expect((element?.semantic as { label?: string }).label).toBe("renamed");
  });
});

describe("a write that outlives its document", () => {
  /** A document written by an unrelated session, ready to be opened. */
  async function foreignDocument(label: string): Promise<string> {
    const other = createHarness({ seeded: false });
    addShape(other.editor, label);
    other.backend.saveAnswers.push("/docs/b.jsonl");
    await other.session.save();
    const text = other.backend.files.get("/docs/b.jsonl");
    if (text === undefined) {
      throw new Error("the fixture failed to save");
    }
    return text;
  }

  test("a queued write is dropped when the document is replaced", async () => {
    const harness = createHarness();
    harness.backend.saveAnswers.push("/docs/a.jsonl");
    await harness.session.save();
    const documentB = await foreignDocument("belongs to b");
    harness.backend.files.set("/docs/b.jsonl", documentB);

    harness.backend.blockWrites();
    addShape(harness.editor, "one");
    harness.timers.fire();
    await harness.settle();
    addShape(harness.editor, "two");
    harness.timers.fire();
    await harness.settle();

    // One write is stalled in the backend and a second is queued behind it.
    const opened = await harness.session.openPath("/docs/b.jsonl");
    expect(opened).toBe(true);

    harness.backend.releaseWrites();
    await harness.settle();

    const fileA = harness.backend.files.get("/docs/a.jsonl") as string;
    // The queued write would have serialized document B into file A.
    expect(fileA).not.toBe(documentB);
    expect(fileA).not.toContain("belongs to b");
    expect(harness.backend.files.get("/docs/b.jsonl")).toBe(documentB);
    // And the write that was already in flight must not drag the session
    // back to the file the user left.
    expect(harness.session.state().filePath).toBe("/docs/b.jsonl");
    expect(harness.session.state().fileName).toBe("b.jsonl");
  });

  test("a queued write is dropped when the document is emptied", async () => {
    const harness = createHarness();
    harness.backend.saveAnswers.push("/docs/a.jsonl");
    await harness.session.save();
    const saved = harness.backend.files.get("/docs/a.jsonl") as string;

    harness.backend.blockWrites();
    addShape(harness.editor, "one");
    harness.timers.fire();
    await harness.settle();
    addShape(harness.editor, "two");
    harness.timers.fire();
    await harness.settle();

    await harness.session.newDocument();
    harness.backend.releaseWrites();
    await harness.settle();

    // The empty document must not be written into the user's file.
    const fileA = harness.backend.files.get("/docs/a.jsonl") as string;
    expect(fileA).not.toBe(serializeDocument(harness.editor.getSnapshot()));
    expect(fileA.length).toBeGreaterThanOrEqual(saved.length);
    expect(harness.session.state().filePath).toBeNull();
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

describe("handing the editor to another document mode", () => {
  test("a suspended session closes the file and stops autosaving", async () => {
    const harness = createHarness();
    harness.backend.saveAnswers.push("/docs/a.jsonl");
    await harness.session.save();
    const saved = harness.backend.files.get("/docs/a.jsonl");
    expect(harness.session.state().filePath).toBe("/docs/a.jsonl");

    harness.session.suspend();
    expect(harness.session.state().filePath).toBeNull();
    expect(harness.session.state().fileName).toBeNull();
    await harness.settle();
    expect(harness.backend.watched.at(-1)).toBeNull();

    // Everything a cloud room writes into the store arrives as an ordinary
    // store diff. None of it may reach the file the user had open.
    addShape(harness.editor, "written by a peer");
    expect(harness.timers.pendingCount).toBe(0);
    harness.timers.fire();
    await harness.settle();

    expect(harness.session.state().dirty).toBe(false);
    expect(harness.backend.files.get("/docs/a.jsonl")).toBe(saved as string);
  });

  test("resuming tracks edits again, and saving asks for a path", async () => {
    const harness = createHarness();
    harness.backend.saveAnswers.push("/docs/a.jsonl");
    await harness.session.save();
    harness.session.suspend();
    harness.session.resume();

    addShape(harness.editor, "back in file mode");
    await harness.settle();
    expect(harness.session.state().dirty).toBe(true);

    // The editor no longer holds the document that file contained, so the
    // save has to ask rather than overwrite it.
    harness.backend.saveAnswers.push("/docs/b.jsonl");
    expect(await harness.session.save()).toBe(true);
    expect(harness.session.state().filePath).toBe("/docs/b.jsonl");
  });

  test("suspending twice is harmless", () => {
    const harness = createHarness();
    harness.session.suspend();
    harness.session.suspend();
    expect(harness.session.state().filePath).toBeNull();
  });
});

describe("overlapping open requests", () => {
  /** Hold every read of `path` until the returned function is called. */
  function holdReads(backend: MockBackend, path: string): () => void {
    const read = backend.readDocument.bind(backend);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.readDocument = (requested: string) =>
      requested === path ? gate.then(() => read(requested)) : read(requested);
    return release;
  }

  function documentText(editor: Editor, title: string): string {
    return serializeDocument({ ...editor.getSnapshot(), title });
  }

  test("an older open that settles last cannot replace the newer document or its edits", async () => {
    const harness = createHarness();
    const { backend, editor, session } = harness;
    backend.files.set("/docs/a.jsonl", documentText(editor, "A"));
    backend.files.set("/docs/b.jsonl", documentText(editor, "B"));
    const releaseA = holdReads(backend, "/docs/a.jsonl");

    const openingA = session.openPath("/docs/a.jsonl");
    expect(await session.openPath("/docs/b.jsonl")).toBe(true);
    addShape(editor, "edit to B");
    await harness.settle();
    expect(session.state().dirty).toBe(true);
    const watchesBefore = backend.watched.length;

    releaseA();
    expect(await openingA).toBe(false);
    expect(editor.getSnapshot().title).toBe("B");
    expect(session.state().filePath).toBe("/docs/b.jsonl");
    expect(session.state().dirty).toBe(true);
    expect(session.state().recent.map((entry) => entry.path)).toEqual([
      "/docs/b.jsonl",
    ]);
    expect(backend.watched.length).toBe(watchesBefore);
  });

  test("a new document retires an open still reading", async () => {
    const harness = createHarness();
    const { backend, editor, session } = harness;
    backend.files.set("/docs/a.jsonl", documentText(editor, "A"));
    const releaseA = holdReads(backend, "/docs/a.jsonl");

    const openingA = session.openPath("/docs/a.jsonl");
    await session.newDocument();
    releaseA();
    expect(await openingA).toBe(false);
    expect(session.state().filePath).toBeNull();
    expect(editor.getSnapshot().title).not.toBe("A");
  });

  test("an open still reading when the cloud takes the editor never loads", async () => {
    const harness = createHarness();
    const { backend, editor, session } = harness;
    backend.files.set("/docs/a.jsonl", documentText(editor, "A"));
    const releaseA = holdReads(backend, "/docs/a.jsonl");
    const before = editor.getSnapshot().title;

    const openingA = session.openPath("/docs/a.jsonl");
    session.suspend();
    releaseA();
    expect(await openingA).toBe(false);
    expect(editor.getSnapshot().title).toBe(before);
    expect(session.state().filePath).toBeNull();
  });
});

describe("opening while another mode owns the editor", () => {
  test("a suspended session refuses to open a file into the editor", async () => {
    const harness = createHarness();
    const { backend, editor, session } = harness;
    backend.files.set(
      "/docs/a.jsonl",
      serializeDocument({ ...editor.getSnapshot(), title: "A" }),
    );
    session.suspend();
    const before = editor.getSnapshot();

    expect(await session.openPath("/docs/a.jsonl")).toBe(false);
    backend.openAnswers.push("/docs/a.jsonl");
    expect(await session.open()).toBe(false);
    expect(editor.getSnapshot()).toEqual(before);
    expect(session.state().filePath).toBeNull();
    expect(session.state().error).toContain("cloud document");
    // The dialog was never shown either.
    expect(backend.openAnswers).toEqual(["/docs/a.jsonl"]);
  });
});

describe("overlapping imports", () => {
  test("an import overtaken while the old watch stops never loads", async () => {
    const harness = createHarness();
    const { backend, editor, session } = harness;
    backend.files.set(
      "/docs/a.jsonl",
      serializeDocument({ ...editor.getSnapshot(), title: "A" }),
    );
    expect(await session.openPath("/docs/a.jsonl")).toBe(true);
    const imported = { ...editor.getSnapshot(), title: "Imported" };

    const importing = session.importDocument(imported, "diagram.mmd");
    session.suspend();
    expect(await importing).toBe(false);
    expect(editor.getSnapshot().title).toBe("A");
  });

  test("a newer open wins over an import still stopping the old watch", async () => {
    const harness = createHarness();
    const { backend, editor, session } = harness;
    for (const name of ["a", "b"])
      backend.files.set(
        `/docs/${name}.jsonl`,
        serializeDocument({ ...editor.getSnapshot(), title: name }),
      );
    expect(await session.openPath("/docs/a.jsonl")).toBe(true);
    const imported = { ...editor.getSnapshot(), title: "Imported" };

    const importing = session.importDocument(imported, "diagram.mmd");
    const opening = session.openPath("/docs/b.jsonl");
    expect(await importing).toBe(false);
    expect(await opening).toBe(true);
    expect(editor.getSnapshot().title).toBe("b");
    expect(session.state().filePath).toBe("/docs/b.jsonl");
  });
});

test("page-only edits autosave their names and order, while changing the active page stays clean", async () => {
  const h = createHarness({ seeded: false });
  try {
    h.backend.saveAnswers.push("/docs/pages.jsonl");
    await h.session.save();
    const first = h.editor.currentPageId;
    const second = h.editor.createPage({ name: "Second" });
    expect(h.session.state().dirty).toBe(true);
    expect(h.timers.pendingCount).toBe(1);
    h.timers.fire();
    await h.settle();
    expect(h.session.state().dirty).toBe(false);
    h.editor.setCurrentPage(first);
    expect(h.session.state().dirty).toBe(false);
    expect(h.timers.pendingCount).toBe(0);
    h.editor.renamePage(first, "Renamed first");
    h.editor.reorderPageTo(first, 1);
    h.timers.fire();
    await h.settle();
    const reopened = parseDocument(
      h.backend.files.get("/docs/pages.jsonl") ?? "",
    );
    expect(
      new Editor({ document: reopened }).store.listPages().map((p) => p.id),
    ).toEqual([second, first]);
    expect(reopened.pages.find((p) => p.id === first)?.name).toBe(
      "Renamed first",
    );
    expect(h.session.state().dirty).toBe(false);
  } finally {
    h.session.dispose();
  }
});

describe("saving modes and first-shape autosave", () => {
  test("empty documents and page-only changes create no file", async () => {
    const h = createHarness({ seeded: false });
    let allocations = 0;
    h.backend.autosavePath = async () => {
      allocations += 1;
      return "managed.jsonl";
    };
    await h.session.flush();
    h.editor.createPage({ kind: "freeform", name: "Extra" });
    h.timers.fire();
    await h.session.flush();
    expect(allocations).toBe(0);
    expect(h.backend.writes).toHaveLength(0);
    h.session.dispose();
  });

  test("first shape saves without a dialog and is watched and listed in Recent", async () => {
    const h = createHarness({ seeded: false });
    h.backend.autosavePath = async () => "managed.jsonl";
    addShape(h.editor, "first");
    expect(h.backend.writes).toHaveLength(0);
    expect(await h.session.flush()).toBe(true);
    expect(h.session.state().filePath).toBe("managed.jsonl");
    expect(h.session.state().dirty).toBe(false);
    expect(
      parseDocument(h.backend.files.get("managed.jsonl") ?? "").elements,
    ).toHaveLength(1);
    expect(h.backend.watched).toContain("managed.jsonl");
    expect(h.session.state().recent[0]?.path).toBe("managed.jsonl");
    h.session.dispose();
  });

  test("undoing the first shape before autosave leaves no file", async () => {
    const h = createHarness({ seeded: false });
    let allocations = 0;
    h.backend.autosavePath = async () => {
      allocations += 1;
      return "managed.jsonl";
    };
    addShape(h.editor, "first");
    h.editor.undo();
    h.timers.fire();
    await h.settle();
    expect(allocations).toBe(0);
    expect(h.backend.writes).toHaveLength(0);
    h.session.dispose();
  });

  test("manual cancels pending autosave and flush, but explicit Save still works", async () => {
    const h = createHarness({ seeded: false });
    h.backend.autosavePath = async () => "managed.jsonl";
    addShape(h.editor, "first");
    expect(h.timers.pendingCount).toBe(1);
    h.session.setSaveMode("manual");
    expect(h.timers.pendingCount).toBe(0);
    expect(await h.session.flush()).toBe(false);
    expect(h.backend.writes).toHaveLength(0);
    expect(h.session.state().dirty).toBe(true);
    h.backend.saveAnswers.push("chosen.jsonl");
    expect(await h.session.save()).toBe(true);
    addShape(h.editor, "second");
    h.timers.fire();
    await h.settle();
    expect(h.backend.writes).toHaveLength(1);
    h.session.setSaveMode("automatic");
    expect(h.timers.pendingCount).toBe(1);
    await h.session.flush();
    expect(h.backend.writes).toHaveLength(2);
    expect(h.session.state().dirty).toBe(false);
    h.session.dispose();
  });

  test("overlapping first saves allocate one file and flush preserves edits during a write", async () => {
    const h = createHarness({ seeded: false });
    let allocations = 0;
    h.backend.autosavePath = async () => {
      allocations += 1;
      return "managed.jsonl";
    };
    h.backend.blockWrites();
    addShape(h.editor, "first");
    h.timers.fire();
    await h.settle();
    addShape(h.editor, "second");
    h.timers.fire();
    const flush = h.session.flush();
    h.backend.releaseWrites();
    await flush;
    expect(allocations).toBe(1);
    expect(
      parseDocument(h.backend.files.get("managed.jsonl") ?? "").elements,
    ).toHaveLength(2);
    expect(h.session.state().dirty).toBe(false);
    h.session.dispose();
  });

  for (const action of ["manual", "new"] as const) {
    test(`pending path allocation is retired by ${action}`, async () => {
      const h = createHarness({ seeded: false });
      let release: (path: string) => void = () => {};
      h.backend.autosavePath = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      addShape(h.editor, "first");
      h.timers.fire();
      if (action === "manual") h.session.setSaveMode("manual");
      else await h.session.newDocument();
      release("managed.jsonl");
      await h.settle();
      expect(h.backend.writes).toHaveLength(0);
      expect(h.session.state().filePath).toBeNull();
      h.session.dispose();
    });
  }

  test("switching to manual during a write keeps later edits dirty", async () => {
    const h = createHarness({ seeded: false });
    h.backend.autosavePath = async () => "managed.jsonl";
    h.backend.blockWrites();
    addShape(h.editor, "first");
    h.timers.fire();
    await h.settle();
    addShape(h.editor, "later");
    h.session.setSaveMode("manual");
    h.backend.releaseWrites();
    await h.session.flush();
    expect(h.session.state().dirty).toBe(true);
    expect(h.backend.writes).toHaveLength(1);
    expect(h.timers.pendingCount).toBe(0);
    h.session.dispose();
  });
});

test("explicit Save As wins over a pending first automatic save", async () => {
  const h = createHarness({ seeded: false });
  let release: (path: string) => void = () => {};
  h.backend.autosavePath = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  addShape(h.editor, "first");
  h.timers.fire();
  h.backend.saveAnswers.push("chosen.jsonl");
  expect(await h.session.saveAs()).toBe(true);
  release("managed.jsonl");
  await h.settle();
  expect(h.session.state().filePath).toBe("chosen.jsonl");
  expect(h.backend.files.has("managed.jsonl")).toBe(false);
  expect(h.backend.writes).toHaveLength(1);
  h.session.dispose();
});
