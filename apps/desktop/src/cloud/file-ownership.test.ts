import { describe, expect, test } from "bun:test";
import { applyIrToDoc } from "@diagra/collab";
import { createDefaultRegistry, Editor } from "@diagra/core";
import { serializeDocument } from "@diagra/io";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { FileBackend } from "../file/backend.ts";
import { DocumentSession } from "../file/session.ts";
import { cloudApi, type ApiResult, type CloudRole } from "./api.ts";
import { bindCloudFileOwnership } from "./file-ownership.ts";
import { CloudSession, type DocumentProvider } from "./session.ts";
import { defaultCloudSettings } from "./settings.ts";

class Provider implements DocumentProvider {
  synced = false;
  readonly awareness: Awareness;
  private readonly listeners = new Map<string, Set<(value: unknown) => void>>();
  constructor(readonly doc: Y.Doc) {
    this.awareness = new Awareness(doc);
  }
  on(name: string, listener: (value: unknown) => void): void {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  off(name: string, listener: (value: unknown) => void): void {
    this.listeners.get(name)?.delete(listener);
  }
  emit(name: string, value: unknown): void {
    for (const listener of [...(this.listeners.get(name) ?? [])])
      listener(value);
  }
  connect(): void {}
  disconnect(): void {
    this.synced = false;
  }
  destroy(): void {
    this.awareness.destroy();
    this.listeners.clear();
  }
  sync(): void {
    this.synced = true;
    this.emit("sync", true);
  }
}

async function harness() {
  const editor = new Editor({ registry: createDefaultRegistry() });
  const localText = serializeDocument(editor.getSnapshot());
  const writes: string[] = [];
  const backend: FileBackend = {
    available: true,
    pickOpenPath: async () => "/local.jsonl",
    pickSavePath: async () => null,
    readDocument: async () => localText,
    writeDocument: async (_path, text) => {
      writes.push(text);
    },
    listRecent: async () => [],
    addRecent: async () => [],
    removeRecent: async () => [],
    watch: async () => {},
    unwatch: async () => {},
    onFileChanged: () => () => {},
  };
  const files = new DocumentSession({ editor, backend });
  await files.open();
  let probe: ApiResult<CloudRole> = { ok: true, value: "editor" };
  const providers: Provider[] = [];
  const cloud = new CloudSession({
    editor,
    settings: () => ({
      ...defaultCloudSettings(),
      endpointUrl: "https://example.test",
    }),
    api: { ...cloudApi, probeDocument: async () => probe },
    createProvider: ({ doc }) => {
      applyIrToDoc(doc, { ...editor.getSnapshot(), title: "Cloud snapshot" });
      const provider = new Provider(doc);
      providers.push(provider);
      return provider;
    },
  });
  const stop = bindCloudFileOwnership(cloud, files);
  return {
    editor,
    files,
    cloud,
    providers,
    writes,
    probe: (next: ApiResult<CloudRole>) => {
      probe = next;
    },
    dispose: () => {
      cloud.close();
      stop();
      files.dispose();
    },
  };
}

describe("shared App cloud/file ownership", () => {
  test("denied initial open preserves the dirty local file and save path", async () => {
    const h = await harness();
    try {
      h.editor.createElement("shape.geo", { semantic: { geo: "rect" } });
      const before = h.files.state();
      expect(before.dirty).toBe(true);
      const snapshot = h.editor.getSnapshot();
      h.probe({ ok: false, status: 403, error: "denied" });
      expect(await h.cloud.open("room")).toBe(false);
      expect(h.cloud.state().ownsEditor).toBe(false);
      expect(h.files.state()).toEqual(before);
      expect(h.editor.getSnapshot()).toEqual(snapshot);
      expect(await h.files.save()).toBe(true);
      expect(h.writes).toEqual([serializeDocument(snapshot)]);
    } finally {
      h.dispose();
    }
  });

  test("suspends before first cloud snapshot and throughout viewer replacement", async () => {
    const h = await harness();
    try {
      await h.cloud.open("room");
      expect(h.files.state().filePath).toBe("/local.jsonl");
      const dirtyDuringCloudLoad: boolean[] = [];
      const stop = h.editor.subscribe(() => {
        if (h.editor.getSnapshot().title === "Cloud snapshot")
          dirtyDuringCloudLoad.push(h.files.state().dirty);
      });
      h.providers[0]?.sync();
      expect(h.cloud.state().ownsEditor).toBe(true);
      expect(h.files.state()).toMatchObject({ filePath: null, dirty: false });
      h.editor.createElement("shape.geo", {
        semantic: { geo: "rect", label: "unsent" },
      });
      h.probe({ ok: true, value: "viewer" });
      h.providers[0]?.emit("connection-close", { code: 4403 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(h.providers).toHaveLength(2);
      expect(h.cloud.state().ownsEditor).toBe(true);
      expect(h.cloud.state().recoveries).toHaveLength(1);
      h.providers[1]?.sync();
      expect(h.cloud.state()).toMatchObject({
        role: "viewer",
        ownsEditor: true,
      });
      expect(h.files.state()).toMatchObject({ filePath: null, dirty: false });
      expect(dirtyDuringCloudLoad.length).toBeGreaterThan(0);
      expect(dirtyDuringCloudLoad.every((dirty) => !dirty)).toBe(true);
      expect(await h.files.save()).toBe(false);
      expect(h.writes).toEqual([]);
      stop();
    } finally {
      h.dispose();
    }
  });
});
