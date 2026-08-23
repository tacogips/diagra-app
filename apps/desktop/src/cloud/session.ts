// The cloud document lifecycle: which document is open, whether its socket is
// carrying edits, and who else is in the room.
//
// Framework-free, exactly like `file/session.ts`, and announced through the
// same `subscribe(listener)` shape so `App.tsx` can consume either mode
// without caring which it has. It owns the provider and the binding; the
// binding owns the editor <-> Y.Doc relationship and nothing else.
//
// The provider and the REST client are injected so the whole state machine
// can be driven headlessly in `session.test.ts` — there is no WebSocket in
// `bun test`, and a lifecycle that can only be tested by opening a socket is
// a lifecycle that does not get tested.

import {
  CollabBinding,
  createDocProvider,
  observePresence,
  type PresencePeer,
  publishPresence,
} from "@diagra/collab";
import type { Editor } from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { type CloudApi, cloudApi } from "./api.ts";
import type { CloudSettings } from "./settings.ts";

export type CloudStatus =
  | "idle"
  | "connecting"
  | "syncing"
  | "connected"
  | "reconnecting"
  | "error"
  | "closed";

export interface CloudSessionState {
  readonly status: CloudStatus;
  readonly docId: string | null;
  readonly title: string | null;
  readonly error: string | null;
  readonly peers: readonly PresencePeer[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type CloudSessionListener = (state: CloudSessionState) => void;

/** What this session needs from a provider; `YProvider` satisfies it. */
export interface DocumentProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly synced: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: matches lib0's Observable.
  on(name: string, handler: (...args: any[]) => void): void;
  // biome-ignore lint/suspicious/noExplicitAny: matches lib0's Observable.
  off(name: string, handler: (...args: any[]) => void): void;
  destroy(): void;
}

export interface ProviderRequest {
  readonly endpoint: string;
  readonly docId: string;
  readonly doc: Y.Doc;
  readonly token: string | undefined;
  readonly devUser: string | undefined;
}

export type ProviderFactory = (request: ProviderRequest) => DocumentProvider;

export interface CloudSessionOptions {
  readonly editor: Editor;
  /** Read afresh on every open, so a settings edit takes effect. */
  readonly settings: () => CloudSettings;
  readonly api?: CloudApi;
  readonly createProvider?: ProviderFactory;
}

export interface OpenOptions {
  /** Share-link token. Never persisted (design 11). */
  readonly token?: string;
}

const IDLE: CloudSessionState = {
  status: "idle",
  docId: null,
  title: null,
  error: null,
  peers: [],
  canUndo: false,
  canRedo: false,
};

function defaultProviderFactory(request: ProviderRequest): DocumentProvider {
  return createDocProvider({
    endpoint: request.endpoint,
    docId: request.docId,
    doc: request.doc,
    params: () => ({ token: request.token, devUser: request.devUser }),
  }) as unknown as DocumentProvider;
}

export class CloudSession {
  private readonly editor: Editor;
  private readonly readSettings: () => CloudSettings;
  private readonly api: CloudApi;
  private readonly createProvider: ProviderFactory;
  private readonly listeners = new Set<CloudSessionListener>();

  private current: CloudSessionState = IDLE;
  private provider: DocumentProvider | null = null;
  private binding: CollabBinding | null = null;
  private doc: Y.Doc | null = null;
  private stopPresence: (() => void) | null = null;
  private stopUndoState: (() => void) | null = null;
  /** Bumped by every open, so a slow probe cannot resurrect a closed doc. */
  private generation = 0;

  private readonly onSync = (isSynced: boolean): void => {
    if (isSynced) {
      this.attach();
    }
  };
  private readonly onStatus = (event: { status?: string }): void => {
    if (event.status === "disconnected" && this.current.status !== "closed") {
      // The provider owns the backoff from here. Local edits keep applying to
      // the Y.Doc and flush on resync, so this is a status, not an error.
      this.patch({ status: "reconnecting" });
    }
  };

  constructor(options: CloudSessionOptions) {
    this.editor = options.editor;
    this.readSettings = options.settings;
    this.api = options.api ?? cloudApi;
    this.createProvider = options.createProvider ?? defaultProviderFactory;
  }

  state(): CloudSessionState {
    return this.current;
  }

  subscribe(listener: CloudSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Open `docId` against the configured endpoint.
   *
   * The REST probe runs first on purpose: an upgrade the server refuses is
   * answered before the 101 and the provider would retry it forever, so the
   * only way to tell the user "that token is not valid for this document" is
   * to ask a route that can answer in words.
   */
  async open(docId: string, options: OpenOptions = {}): Promise<boolean> {
    const settings = this.readSettings();
    if (settings.endpointUrl.trim() === "") {
      this.fail("set a sync endpoint first");
      return false;
    }
    this.close();
    const generation = ++this.generation;
    this.patch({
      status: "connecting",
      docId,
      title: null,
      error: null,
      peers: [],
    });

    const probe = await this.api.probeDocument({
      endpoint: settings.endpointUrl,
      docId,
      ...(settings.devUser ? { devUser: settings.devUser } : {}),
      ...(options.token ? { token: options.token } : {}),
    });
    if (generation !== this.generation) {
      // Another open (or a close) happened while the probe was in flight.
      return false;
    }
    if (!probe.ok) {
      this.fail(describeProbe(probe.status, probe.error));
      return false;
    }

    const doc = new Y.Doc();
    this.doc = doc;
    let provider: DocumentProvider;
    try {
      provider = this.createProvider({
        endpoint: settings.endpointUrl,
        docId,
        doc,
        token: options.token,
        devUser: settings.devUser,
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      return false;
    }
    this.provider = provider;
    provider.on("sync", this.onSync);
    provider.on("status", this.onStatus);
    this.patch({ status: "syncing" });

    // A provider that was already synced (a fake, or a warm cache) never
    // emits the event this session is waiting for.
    if (provider.synced) {
      this.attach();
    }
    return true;
  }

  /** Close the document and drop every subscription. Safe to call twice. */
  close(): void {
    this.generation += 1;
    this.detachBinding();
    if (this.provider) {
      this.provider.off("sync", this.onSync);
      this.provider.off("status", this.onStatus);
      this.provider.destroy();
      this.provider = null;
    }
    this.doc?.destroy();
    this.doc = null;
    if (this.current.status !== "idle") {
      this.patch({
        status: "closed",
        docId: null,
        title: null,
        error: null,
        peers: [],
        canUndo: false,
        canRedo: false,
      });
    }
  }

  undo(): boolean {
    const undone = this.binding?.undo() ?? false;
    this.publishUndoState();
    return undone;
  }

  redo(): boolean {
    const redone = this.binding?.redo() ?? false;
    this.publishUndoState();
    return redone;
  }

  canUndo(): boolean {
    return this.binding?.canUndo() ?? false;
  }

  canRedo(): boolean {
    return this.binding?.canRedo() ?? false;
  }

  /** Publish this client's cursor/selection. No-op while disconnected. */
  publishPresence(cursor: { x: number; y: number } | null): void {
    const awareness = this.provider?.awareness;
    if (!awareness || this.binding === null) {
      return;
    }
    const settings = this.readSettings();
    publishPresence(awareness, {
      user: { name: settings.userName, color: settings.userColor },
      cursor,
      selection: [...this.editor.selection.ids()] as readonly ElementId[],
      page: this.editor.currentPageId,
    });
  }

  private attach(): void {
    if (this.doc === null) {
      return;
    }
    if (this.binding !== null) {
      // A resync after a reconnect. The binding never went anywhere — the
      // Y.Doc kept accepting edits offline — so only the status moves back.
      if (this.current.status !== "connected") {
        this.patch({ status: "connected", error: null });
      }
      return;
    }
    const binding = new CollabBinding({ editor: this.editor, doc: this.doc });
    binding.attach();
    this.binding = binding;
    this.stopUndoState = binding.onUndoState(() => {
      this.publishUndoState();
    });
    const awareness = this.provider?.awareness;
    if (awareness) {
      this.stopPresence = observePresence(awareness, (peers) => {
        this.patch({ peers });
      });
    }
    this.patch({
      status: "connected",
      title: this.editor.getSnapshot().title,
      error: null,
      canUndo: binding.canUndo(),
      canRedo: binding.canRedo(),
    });
    this.publishPresence(null);
  }

  private detachBinding(): void {
    this.stopPresence?.();
    this.stopPresence = null;
    this.stopUndoState?.();
    this.stopUndoState = null;
    this.binding?.detach();
    this.binding = null;
  }

  private publishUndoState(): void {
    this.patch({ canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  private fail(message: string): void {
    this.detachBinding();
    if (this.provider) {
      this.provider.off("sync", this.onSync);
      this.provider.off("status", this.onStatus);
      this.provider.destroy();
      this.provider = null;
    }
    this.doc?.destroy();
    this.doc = null;
    this.patch({ status: "error", error: message, peers: [] });
  }

  private patch(changes: Partial<CloudSessionState>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of [...this.listeners]) {
      listener(this.current);
    }
  }
}

/** Turn a REST status into something a person can act on. */
function describeProbe(status: number | null, error: string): string {
  switch (status) {
    case 401:
      return "the server did not accept this identity (401)";
    case 403:
      return "this share link does not grant access to that document (403)";
    case 404:
      return "no such document on this endpoint (404)";
    default:
      return error;
  }
}
