// The cloud document lifecycle, headless.
//
// There is no WebSocket in `bun test`, so the provider is a fake that exposes
// the same three things the session uses — a doc, an awareness, and the
// `sync`/`status` events — and the REST client is a stub with queued answers.
// Everything else, including the binding, is the real implementation.

import { describe, expect, test } from "bun:test";
import { applyIrToDoc, type PresencePeer } from "@diagra/collab";
import { Editor } from "@diagra/core";
import type { Document } from "@diagra/ir";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { ApiResult, CloudApi } from "./api.ts";
import {
  CloudSession,
  type CloudSessionState,
  type DocumentProvider,
} from "./session.ts";
import type { CloudSettings } from "./settings.ts";

const ENDPOINT = "http://localhost:8787";

function roomDocument(): Document {
  return {
    schemaVersion: 1,
    id: "01JDOC0000000000000000000",
    title: "Shop domain",
    pages: [{ id: "p1", name: "Domain model", kind: "erd" }],
    elements: [
      {
        id: "t-users",
        page: "p1",
        type: "erd.table",
        index: "a0",
        semantic: {
          tableName: "users",
          columns: [{ id: "c-id", name: "id", dataType: "uuid", pk: true }],
        },
        visual: { x: 100, y: 100, width: 280 },
      },
    ],
  };
}

class FakeProvider implements DocumentProvider {
  synced = false;
  destroyed = false;
  connected = false;
  connects = 0;
  disconnects = 0;
  readonly awareness: Awareness;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors lib0's Observable.
  private readonly handlers = new Map<string, Set<(...args: any[]) => void>>();

  constructor(readonly doc: Y.Doc) {
    this.awareness = new Awareness(doc);
    // The 30 s liveness timer would keep `bun test` alive.
    clearInterval(
      (this.awareness as unknown as { _checkInterval: number })._checkInterval,
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: mirrors lib0's Observable.
  on(name: string, handler: (...args: any[]) => void): void {
    const bucket = this.handlers.get(name) ?? new Set();
    bucket.add(handler);
    this.handlers.set(name, bucket);
  }

  // biome-ignore lint/suspicious/noExplicitAny: mirrors lib0's Observable.
  off(name: string, handler: (...args: any[]) => void): void {
    this.handlers.get(name)?.delete(handler);
  }

  connect(): void {
    this.connected = true;
    this.connects++;
  }

  disconnect(): void {
    this.connected = false;
    this.disconnects++;
  }

  destroy(): void {
    this.destroyed = true;
    this.handlers.clear();
  }

  /** Pretend the room state arrived and the socket finished its handshake. */
  finishSync(): void {
    this.synced = true;
    this.emit("sync", true);
  }

  dropSocket(): void {
    this.synced = false;
    this.emit("status", { status: "disconnected" });
  }

  emit(name: string, argument: unknown): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) {
      handler(argument);
    }
  }
}

interface Harness {
  readonly editor: Editor;
  readonly session: CloudSession;
  readonly states: CloudSessionState[];
  readonly providers: FakeProvider[];
  /** Room contents the next provider hands over. */
  seed: Document | null;
  probe: ApiResult<"owner" | "editor" | "viewer">;
  probeCalls: number;
  probeEndpoints: string[];
  /** Resolves the pending probe by hand when set. */
  holdProbe:
    | ((result: ApiResult<"owner" | "editor" | "viewer">) => void)
    | null;
  settings: CloudSettings;
}

function harness(): Harness {
  const editor = new Editor();
  const state: Harness = {
    editor,
    session: undefined as unknown as CloudSession,
    states: [],
    providers: [],
    seed: roomDocument(),
    probe: { ok: true, value: "owner" },
    probeCalls: 0,
    probeEndpoints: [],
    holdProbe: null,
    settings: {
      endpointUrl: ENDPOINT,
      userName: "Ada",
      userColor: "#335c67",
      devUser: "owner",
    },
  };

  const api: CloudApi = {
    createShare: async () => ({ ok: false, status: 403, error: "not used" }),
    revokeShare: async () => ({ ok: false, status: 403, error: "not used" }),
    listShares: async () => ({ ok: false, status: 403, error: "not used" }),
    probeDocument(input) {
      state.probeCalls++;
      state.probeEndpoints.push(input.endpoint);
      if (state.holdProbe !== null) {
        return new Promise<ApiResult<"owner" | "editor" | "viewer">>(
          (resolve) => {
            state.holdProbe = resolve;
          },
        );
      }
      return Promise.resolve(state.probe);
    },
    listDocuments() {
      return Promise.resolve({
        ok: true,
        value: {
          items: [],
          nextCursor: null,
          workspaceId: null,
          adoptedCount: 0,
          moreDocuments: false,
          pendingInvalidation: false,
          cursorReset: false,
          status: "complete" as const,
        },
      });
    },
    createDocument() {
      return Promise.resolve({
        ok: false,
        status: null,
        error: "not used here",
      });
    },
  };

  const session = new CloudSession({
    editor,
    settings: () => state.settings,
    api,
    createProvider: (request) => {
      expect(request.endpoint).toBe(ENDPOINT);
      if (state.seed) {
        applyIrToDoc(request.doc, state.seed);
      }
      const provider = new FakeProvider(request.doc);
      state.providers.push(provider);
      return provider;
    },
  });
  (state as { session: CloudSession }).session = session;
  session.subscribe((next) => state.states.push(next));
  return state;
}

function statuses(harness: Harness): string[] {
  return harness.states.map((state) => state.status);
}

async function settleRevalidation(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("CloudSession", () => {
  test("retains authoritative viewer role and disables cloud undo/redo", async () => {
    const state = harness();
    state.probe = { ok: true, value: "viewer" };
    try {
      expect(await state.session.open("doc-1")).toBe(true);
      (state.providers[0] as FakeProvider).finishSync();
      expect(state.session.state().role).toBe("viewer");
      expect(state.editor.readOnly).toBe(true);
      const before = state.editor.getSnapshot();
      expect(state.editor.setText("t-users", "Local attempt")).toBe(false);
      expect(state.editor.getSnapshot()).toEqual(before);
      expect(state.session.canUndo()).toBe(false);
      expect(state.session.undo()).toBe(false);
      expect(state.session.redo()).toBe(false);
      expect(state.session.state().canUndo).toBe(false);
      const provider = state.providers[0] as FakeProvider;
      const table = provider.doc
        .getMap<Y.Map<unknown>>("elements")
        .get("t-users") as Y.Map<unknown>;
      (table.get("visual") as Y.Map<unknown>).set("y", 999);
      expect(state.editor.store.get("t-users")?.visual.y).toBe(999);
      provider.dropSocket();
      expect(state.editor.readOnly).toBe(true);
      provider.finishSync();
      expect(state.editor.readOnly).toBe(true);
    } finally {
      state.session.close();
    }
    expect(state.session.state().role).toBeNull();
    expect(state.editor.readOnly).toBe(false);
  });
  test("refuses to open without a configured endpoint", async () => {
    const test = harness();
    test.settings = { ...test.settings, endpointUrl: "   " };

    expect(await test.session.open("doc-1")).toBe(false);
    expect(test.session.state().status).toBe("error");
    expect(test.session.state().error).toMatch(/endpoint/);
    expect(test.providers).toHaveLength(0);
  });

  test("connects, syncs, then attaches the binding", async () => {
    const test = harness();
    expect(await test.session.open("doc-1")).toBe(true);
    expect(statuses(test)).toEqual(["connecting", "syncing"]);

    (test.providers[0] as FakeProvider).finishSync();

    const state = test.session.state();
    expect(state.status).toBe("connected");
    expect(state.docId).toBe("doc-1");
    expect(state.title).toBe("Shop domain");
    // The room's document, not the editor's starting one.
    expect(test.editor.store.has("t-users")).toBe(true);
    expect(test.editor.currentPageId).toBe("p1");
  });

  test("maps rejected probes onto a readable error", async () => {
    for (const [status, expected] of [
      [401, /identity/],
      [403, /share link/],
      [404, /no such document/],
    ] as const) {
      const test = harness();
      test.probe = { ok: false, status, error: "server said no" };

      expect(await test.session.open("doc-1")).toBe(false);
      expect(test.session.state().status).toBe("error");
      expect(test.session.state().error).toMatch(expected);
      expect(test.session.state().ownsEditor).toBe(false);
      // Nothing was opened, so nothing has to be torn down.
      expect(test.providers).toHaveLength(0);
    }
  });

  test("passes an unrecognised failure through verbatim", async () => {
    const test = harness();
    test.probe = { ok: false, status: null, error: "Unable to connect" };
    await test.session.open("doc-1");
    expect(test.session.state().error).toBe("Unable to connect");
  });

  test("revalidates a dropped writer socket before explicitly reconnecting", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.editor.moveElements([{ id: "t-users", x: 333, y: 1 }]);
    expect(test.session.canUndo()).toBe(true);

    provider.dropSocket();
    expect(test.session.state().status).toBe("reconnecting");
    expect(test.session.state().error).toBeNull();
    expect(test.editor.readOnly).toBe(true);
    expect(provider.disconnects).toBe(1);

    await settleRevalidation();
    expect(test.session.state().status).toBe("syncing");
    expect(test.editor.readOnly).toBe(true);
    expect(provider.connects).toBe(2);

    provider.finishSync();
    expect(test.session.state().status).toBe("connected");
    expect(test.editor.readOnly).toBe(false);
    expect(test.session.state().canUndo).toBe(true);
    // The binding was attached once and stayed attached across the drop.
    expect(test.editor.store.has("t-users")).toBe(true);
  });

  test("preserves a writer recovery snapshot and uses a fresh document on viewer downgrade", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.editor.moveElements([{ id: "t-users", x: 640, y: 220 }]);
    const oldDoc = provider.doc;
    test.probe = { ok: true, value: "viewer" };
    test.settings = {
      ...test.settings,
      endpointUrl: "http://changed.example.test",
      devUser: "changed-user",
    };

    provider.dropSocket();
    await settleRevalidation();

    expect(test.providers).toHaveLength(2);
    expect(test.probeEndpoints.at(-1)).toBe(ENDPOINT);
    expect(provider.destroyed).toBe(true);
    expect((test.providers[1] as FakeProvider).doc).not.toBe(oldDoc);
    expect(test.session.state().role).toBe("viewer");
    expect(test.session.state().ownsEditor).toBe(true);
    expect(
      test.session.state().recoveries[0]?.document.elements[0]?.visual.x,
    ).toBe(640);
    (test.providers[1] as FakeProvider).finishSync();
    expect(test.editor.readOnly).toBe(true);
  });

  test("definitive revalidation loss stops reconnecting and emits an opaque event", async () => {
    const test = harness();
    const losses: { docId: string; message: string }[] = [];
    test.session.subscribeAccessLost((event) => losses.push(event));
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.probe = { ok: false, status: 403, error: "raw server detail" };

    provider.dropSocket();
    await settleRevalidation();

    expect(test.session.state().status).toBe("error");
    expect(test.session.state().docId).toBeNull();
    expect(test.session.state().role).toBeNull();
    expect(test.session.state().ownsEditor).toBe(false);
    expect(test.session.state().error).toBe("Cloud document access was lost.");
    expect(test.session.state().recoveries[0]?.docId).toBe("doc-1");
    expect(losses).toEqual([
      { docId: "doc-1", message: "Cloud document access was lost." },
    ]);
    expect(provider.connects).toBe(1);
  });

  test("gates a failed upgrade through access revalidation before retrying", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    // No sync was ever received: this models a close during the upgrade.
    provider.dropSocket();
    expect(test.session.state().ownsEditor).toBe(false);
    expect(test.editor.readOnly).toBe(false);

    await settleRevalidation();

    expect(test.session.state().status).toBe("syncing");
    expect(provider.connects).toBe(2);
  });

  test("does not reconnect a failed upgrade after definitive access loss", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    test.probe = { ok: false, status: 401, error: "ignored" };

    provider.dropSocket();
    await settleRevalidation();

    expect(test.session.state().status).toBe("error");
    expect(test.session.state().ownsEditor).toBe(false);
    expect(provider.connects).toBe(1);
  });

  test("keeps writer provenance through a successful probe followed by another failed upgrade", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.editor.moveElements([{ id: "t-users", x: 888, y: 1 }]);

    provider.dropSocket();
    await settleRevalidation();
    expect(test.session.state().status).toBe("syncing");
    test.probe = { ok: true, value: "viewer" };
    provider.dropSocket();
    await settleRevalidation();

    expect(test.providers).toHaveLength(2);
    expect(
      test.session.state().recoveries.at(-1)?.document.elements[0]?.visual.x,
    ).toBe(888);
  });

  test("keeps writer recovery through a successful probe followed by definitive loss", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.editor.moveElements([{ id: "t-users", x: 889, y: 1 }]);

    provider.dropSocket();
    await settleRevalidation();
    test.probe = { ok: false, status: 403, error: "ignored" };
    provider.dropSocket();
    await settleRevalidation();

    expect(test.session.state().status).toBe("error");
    expect(
      test.session.state().recoveries.at(-1)?.document.elements[0]?.visual.x,
    ).toBe(889);
  });

  test("retries transient revalidation probes without reconnecting the provider", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.probe = { ok: false, status: null, error: "offline" };

    provider.dropSocket();
    await settleRevalidation();

    expect(test.session.state().status).toBe("reconnecting");
    expect(provider.connects).toBe(1);
    test.session.close();
  });

  test("ignores stale sync and cancels a queued transient retry when closed", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.probe = { ok: false, status: null, error: "offline" };

    provider.dropSocket();
    await settleRevalidation();
    provider.finishSync();
    expect(test.session.state().status).toBe("reconnecting");
    expect(test.editor.readOnly).toBe(true);
    test.session.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 550));

    expect(test.probeCalls).toBe(2);
    expect(provider.connects).toBe(1);
  });

  test("keeps writer recovery eligibility across a transient probe before viewer downgrade", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.editor.moveElements([{ id: "t-users", x: 777, y: 1 }]);
    test.probe = { ok: false, status: null, error: "offline" };
    provider.dropSocket();
    await settleRevalidation();
    test.probe = { ok: true, value: "viewer" };
    await new Promise<void>((resolve) => setTimeout(resolve, 550));

    expect(test.providers).toHaveLength(2);
    expect(
      test.session.state().recoveries[0]?.document.elements[0]?.visual.x,
    ).toBe(777);
    test.session.close();
  });

  test("retains same-document recoveries and discards only the selected copy", async () => {
    const test = harness();
    await test.session.open("doc-1");
    let provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.editor.moveElements([{ id: "t-users", x: 201, y: 1 }]);
    test.probe = { ok: false, status: 403, error: "ignored" };
    provider.dropSocket();
    await settleRevalidation();

    test.probe = { ok: true, value: "owner" };
    await test.session.open("doc-1");
    provider = test.providers[1] as FakeProvider;
    provider.finishSync();
    test.editor.moveElements([{ id: "t-users", x: 202, y: 1 }]);
    test.probe = { ok: false, status: 404, error: "ignored" };
    provider.dropSocket();
    await settleRevalidation();

    const [first, second] = test.session.state().recoveries;
    expect(first?.id).not.toBe(second?.id);
    expect(
      test.session.state().recoveries.map((recovery) => recovery.docId),
    ).toEqual(["doc-1", "doc-1"]);
    test.session.discardRecovery(first?.id as number);
    expect(test.session.state().recoveries).toEqual([second]);
  });

  test("retains recoveries from different documents", async () => {
    const test = harness();
    await test.session.open("doc-1");
    let provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.probe = { ok: false, status: 403, error: "ignored" };
    provider.dropSocket();
    await settleRevalidation();

    test.probe = { ok: true, value: "owner" };
    await test.session.open("doc-2");
    provider = test.providers[1] as FakeProvider;
    provider.finishSync();
    test.probe = { ok: false, status: 404, error: "ignored" };
    provider.dropSocket();
    await settleRevalidation();

    expect(
      test.session.state().recoveries.map((recovery) => recovery.docId),
    ).toEqual(["doc-1", "doc-2"]);
  });

  test("syncs edits both ways while connected", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();

    // Local edit reaches the doc.
    test.editor.moveElements([{ id: "t-users", x: 640, y: 220 }]);
    const table = provider.doc
      .getMap<Y.Map<unknown>>("elements")
      .get("t-users") as Y.Map<unknown>;
    expect((table.get("visual") as Y.Map<unknown>).get("x")).toBe(640);

    // A peer's edit reaches the store.
    (table.get("visual") as Y.Map<unknown>).set("y", 999);
    expect(test.editor.store.get("t-users")?.visual.y).toBe(999);
  });

  test("routes undo and redo to the binding", async () => {
    const test = harness();
    await test.session.open("doc-1");
    (test.providers[0] as FakeProvider).finishSync();

    expect(test.session.canUndo()).toBe(false);
    test.editor.moveElements([{ id: "t-users", x: 5, y: 6 }]);
    expect(test.session.canUndo()).toBe(true);
    expect(test.session.state().canUndo).toBe(true);

    expect(test.session.undo()).toBe(true);
    expect(test.editor.store.get("t-users")?.visual.x).toBe(100);
    expect(test.session.canRedo()).toBe(true);
    expect(test.session.redo()).toBe(true);
    expect(test.editor.store.get("t-users")?.visual.x).toBe(5);
  });

  test("publishes and observes presence", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();

    test.session.publishPresence({ x: 12, y: 34 });
    const local = provider.awareness.getLocalState() as {
      user: { name: string };
      cursor: { x: number };
      page: string;
    };
    expect(local.user.name).toBe("Ada");
    expect(local.cursor.x).toBe(12);
    expect(local.page).toBe("p1");

    // A second client in the room shows up as a peer.
    const peerAwareness = new Awareness(new Y.Doc());
    clearInterval(
      (peerAwareness as unknown as { _checkInterval: number })._checkInterval,
    );
    provider.awareness.states.set(77, {
      user: { name: "Grace", color: "#9e2a2b" },
      cursor: { x: 1, y: 2 },
      selection: [],
      page: "p1",
    });
    provider.awareness.emit("change", [
      { added: [77], updated: [], removed: [] },
      "test",
    ]);

    const peers: readonly PresencePeer[] = test.session.state().peers;
    expect(peers.map((peer) => peer.state.user.name)).toEqual(["Grace"]);
  });

  test("stops syncing once closed", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();

    test.session.close();
    expect(test.session.state().status).toBe("closed");
    expect(test.session.state().docId).toBeNull();
    expect(provider.destroyed).toBe(true);

    test.editor.moveElements([{ id: "t-users", x: 1, y: 1 }]);
    expect(test.session.canUndo()).toBe(false);
    test.session.close();
    expect(test.session.state().status).toBe("closed");
  });

  test("closing after a failure clears the error", async () => {
    const test = harness();
    test.probe = { ok: false, status: 404, error: "gone" };
    await test.session.open("doc-1");
    expect(test.session.state().status).toBe("error");

    test.session.close();
    expect(test.session.state().error).toBeNull();
    expect(test.session.state().status).toBe("closed");
  });

  test("does not connect a document that was closed mid-probe", async () => {
    const test = harness();
    test.holdProbe = () => {};
    const pending = test.session.open("doc-1");
    test.session.close();

    const resolve = test.holdProbe as unknown as (
      result: ApiResult<"owner" | "editor" | "viewer">,
    ) => void;
    resolve({ ok: true, value: "owner" });

    expect(await pending).toBe(false);
    expect(test.providers).toHaveLength(0);
    expect(test.session.state().status).toBe("closed");
  });

  test("host access loss during an initial probe emits once and invalidates it", async () => {
    const test = harness();
    const losses: { docId: string; message: string }[] = [];
    test.session.subscribeAccessLost((event) => losses.push(event));
    test.holdProbe = () => {};
    const pending = test.session.open("doc-1");

    test.session.loseAccess("Cloud document access was lost.");
    const resolve = test.holdProbe as unknown as (
      result: ApiResult<"owner" | "editor" | "viewer">,
    ) => void;
    resolve({ ok: true, value: "owner" });

    expect(await pending).toBe(false);
    expect(test.providers).toHaveLength(0);
    expect(test.session.state().ownsEditor).toBe(false);
    expect(losses).toEqual([
      { docId: "doc-1", message: "Cloud document access was lost." },
    ]);
  });

  test("ignores a stale revalidation response after close and a new open", async () => {
    const test = harness();
    await test.session.open("doc-1");
    const provider = test.providers[0] as FakeProvider;
    provider.finishSync();
    test.holdProbe = () => {};
    provider.dropSocket();
    await settleRevalidation();
    const resolve = test.holdProbe as unknown as (
      result: ApiResult<"owner" | "editor" | "viewer">,
    ) => void;

    test.holdProbe = null;
    expect(await test.session.open("doc-2")).toBe(true);
    resolve({ ok: false, status: 403, error: "stale" });
    await settleRevalidation();

    expect(test.session.state().docId).toBe("doc-2");
    expect(test.session.state().status).toBe("syncing");
    expect(test.providers).toHaveLength(2);
  });

  test("seeds an empty room from the editor's document", async () => {
    const test = harness();
    test.seed = null;
    const before = test.editor.getSnapshot();

    await test.session.open("doc-1");
    (test.providers[0] as FakeProvider).finishSync();

    const elements = (test.providers[0] as FakeProvider).doc.getMap("elements");
    expect(test.session.state().status).toBe("connected");
    expect(elements.size).toBe(before.elements.length);
    expect(
      (test.providers[0] as FakeProvider).doc
        .getMap<unknown>("meta")
        .get("title"),
    ).toBe(before.title);
  });
});
