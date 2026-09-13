// A real local-file lifecycle, deliberately without any cloud session.
//
// The backend uses Bun's Node-compatible filesystem API for document bytes;
// dialogs, recents, and watching are small local fakes because they are host
// integration details rather than persistence.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createDefaultRegistry, Editor } from "@diagra/core";
import { serializeDocument } from "@diagra/io";
import type { FileBackend, RecentEntry } from "./backend.ts";
import { DocumentSession } from "./session.ts";

function createFilesystemBackend(documentPath: string): FileBackend {
  let recent: RecentEntry[] = [];

  return {
    available: true,
    pickOpenPath: () => Promise.resolve(documentPath),
    pickSavePath: () => Promise.resolve(documentPath),
    readDocument: (path) => readFile(path, "utf8"),
    writeDocument: (path, contents) => writeFile(path, contents, "utf8"),
    listRecent: () => Promise.resolve(recent),
    addRecent: (path) => {
      recent = [
        { path, openedAtMs: Date.now() },
        ...recent.filter((entry) => entry.path !== path),
      ];
      return Promise.resolve(recent);
    },
    removeRecent: (path) => {
      recent = recent.filter((entry) => entry.path !== path);
      return Promise.resolve(recent);
    },
    watch: () => Promise.resolve(),
    unwatch: () => Promise.resolve(),
    onFileChanged: () => () => {},
  };
}

function addShape(editor: Editor, label: string): void {
  editor.createElement("shape.geo", {
    visual: { x: 10, y: 10, width: 100, height: 60 },
    semantic: { geo: "rect", label },
  });
}

function restoreGlobal(
  name: "fetch" | "WebSocket",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, name);
  } else {
    Object.defineProperty(globalThis, name, descriptor);
  }
}

describe("local document files", () => {
  test("opens, edits, saves, and reopens a real JSONL file without network access", async () => {
    const directory = await mkdtemp(join(tmpdir(), "diagra-offline-"));
    const documentPath = join(directory, "local-only.jsonl");
    const fetchDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "fetch",
    );
    const webSocketDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "WebSocket",
    );
    let fetchAttempts = 0;
    let webSocketAttempts = 0;
    const sessions: DocumentSession[] = [];

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: () => {
        fetchAttempts += 1;
        throw new Error("offline file test must not fetch");
      },
    });
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: class {
        constructor() {
          webSocketAttempts += 1;
          throw new Error("offline file test must not open a WebSocket");
        }
      },
    });

    try {
      const source = new Editor({ registry: createDefaultRegistry() });
      addShape(source, "already on disk");
      const originalText = serializeDocument(source.getSnapshot());
      await writeFile(documentPath, originalText, "utf8");

      const editor = new Editor({ registry: createDefaultRegistry() });
      const session = new DocumentSession({
        editor,
        backend: createFilesystemBackend(documentPath),
      });
      sessions.push(session);

      expect(await session.open()).toBe(true);
      expect(await readFile(documentPath, "utf8")).toBe(originalText);
      expect(editor.store.listElements()).toHaveLength(1);
      expect(session.state()).toMatchObject({
        filePath: documentPath,
        dirty: false,
        error: null,
      });

      addShape(editor, "edited entirely locally");
      expect(session.state().dirty).toBe(true);
      expect(await session.save()).toBe(true);
      const savedText = await readFile(documentPath, "utf8");
      expect(savedText).not.toBe(originalText);
      expect(savedText).toContain('"label":"edited entirely locally"');
      expect(session.state().dirty).toBe(false);

      const reopenedEditor = new Editor({ registry: createDefaultRegistry() });
      const reopenedSession = new DocumentSession({
        editor: reopenedEditor,
        backend: createFilesystemBackend(documentPath),
      });
      sessions.push(reopenedSession);
      expect(await reopenedSession.open()).toBe(true);
      expect(reopenedEditor.store.listElements()).toHaveLength(2);
      expect(serializeDocument(reopenedEditor.getSnapshot())).toBe(savedText);

      expect(fetchAttempts).toBe(0);
      expect(webSocketAttempts).toBe(0);
    } finally {
      for (const session of sessions) session.dispose();
      restoreGlobal("fetch", fetchDescriptor);
      restoreGlobal("WebSocket", webSocketDescriptor);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
