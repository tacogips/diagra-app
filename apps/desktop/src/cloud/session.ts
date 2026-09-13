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
import type { Document, ElementId } from "@diagra/ir";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { type CloudApi, type CloudRole, cloudApi } from "./api.ts";
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
  readonly role: CloudRole | null;
  readonly status: CloudStatus;
  readonly docId: string | null;
  readonly title: string | null;
  readonly error: string | null;
  readonly peers: readonly PresencePeer[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** This cloud binding has replaced the host's local-file editor owner. */
  readonly ownsEditor: boolean;
  /** Writer snapshots retained after losing or downgrading cloud access. */
  readonly recoveries: readonly CloudSessionRecovery[];
}

export type CloudSessionListener = (state: CloudSessionState) => void;
export interface CloudSessionRecovery {
  /** Session-local identity; the same document can have several snapshots. */
  readonly id: number;
  readonly docId: string;
  readonly title: string;
  readonly document: Document;
}
export interface CloudAccessLost {
  readonly docId: string;
  readonly message: string;
}
export type CloudAccessLostListener = (event: CloudAccessLost) => void;

/** What this session needs from a provider; `YProvider` satisfies it. */
export interface DocumentProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly synced: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: matches lib0's Observable.
  on(name: string, handler: (...args: any[]) => void): void;
  // biome-ignore lint/suspicious/noExplicitAny: matches lib0's Observable.
  off(name: string, handler: (...args: any[]) => void): void;
  connect(): void | Promise<void>;
  disconnect(): void;
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

type ConnectionContext = Readonly<{
  endpoint: string;
  devUser: string | undefined;
  token: string | undefined;
}>;

const IDLE: CloudSessionState = {
  role: null,
  status: "idle",
  docId: null,
  title: null,
  error: null,
  peers: [],
  canUndo: false,
  canRedo: false,
  ownsEditor: false,
  recoveries: [],
};

function defaultProviderFactory(request: ProviderRequest): DocumentProvider {
  return createDocProvider({
    endpoint: request.endpoint,
    docId: request.docId,
    doc: request.doc,
    params: () => ({ token: request.token, devUser: request.devUser }),
    connect: false,
    managedReconnect: true,
  }) as unknown as DocumentProvider;
}

export class CloudSession {
  private readonly editor: Editor;
  private readonly readSettings: () => CloudSettings;
  private readonly api: CloudApi;
  private readonly createProvider: ProviderFactory;
  private readonly listeners = new Set<CloudSessionListener>();
  private readonly accessLostListeners = new Set<CloudAccessLostListener>();

  private current: CloudSessionState = IDLE;
  private provider: DocumentProvider | null = null;
  private binding: CollabBinding | null = null;
  private doc: Y.Doc | null = null;
  private stopPresence: (() => void) | null = null;
  private stopUndoState: (() => void) | null = null;
  private connection: ConnectionContext | null = null;
  private revalidating = false;
  private revalidatingWasWriter = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = 500;
  private nextRecoveryId = 1;
  /** Bumped by every open, so a slow probe cannot resurrect a closed doc. */
  private generation = 0;

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

  subscribeAccessLost(listener: CloudAccessLostListener): () => void {
    this.accessLostListeners.add(listener);
    return () => {
      this.accessLostListeners.delete(listener);
    };
  }

  /** Retained snapshots are user-controlled and survive later cloud opens. */
  discardRecovery(id: number): void {
    this.patch({
      recoveries: this.current.recoveries.filter(
        (recovery) => recovery.id !== id,
      ),
    });
  }

  /**
   * Let a host-side REST lifecycle (deletion, account removal) stop this
   * session without coupling the public client to a particular auth system.
   */
  loseAccess(message = "Cloud document access was lost."): void {
    if (this.current.docId === null) return;
    this.accessLost(message);
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
    const connection: ConnectionContext = {
      endpoint: settings.endpointUrl,
      devUser: settings.devUser,
      token: options.token,
    };
    this.connection = connection;
    this.patch({
      status: "connecting",
      role: null,
      docId,
      title: null,
      error: null,
      peers: [],
      ownsEditor: false,
    });

    const probe = await this.api.probeDocument({
      endpoint: connection.endpoint,
      docId,
      ...(connection.devUser ? { devUser: connection.devUser } : {}),
      ...(connection.token ? { token: connection.token } : {}),
    });
    if (generation !== this.generation) {
      // Another open (or a close) happened while the probe was in flight.
      return false;
    }
    if (!probe.ok) {
      this.fail(describeProbe(probe.status, probe.error));
      return false;
    }

    if (!this.installProvider(generation, connection.endpoint, docId)) {
      return false;
    }
    this.patch({ status: "syncing", role: probe.value });
    this.connectProvider();
    return true;
  }

  /** Close the document and drop every subscription. Safe to call twice. */
  close(): void {
    this.generation += 1;
    this.cancelRetry();
    this.revalidating = false;
    this.revalidatingWasWriter = false;
    this.connection = null;
    this.detachBinding();
    this.editor.setReadOnly(false);
    if (this.provider) {
      this.removeProviderListeners(this.provider);
      this.provider.disconnect();
      this.provider.destroy();
      this.provider = null;
    }
    this.doc?.destroy();
    this.doc = null;
    if (this.current.status !== "idle") {
      this.patch({
        status: "closed",
        role: null,
        docId: null,
        title: null,
        error: null,
        peers: [],
        canUndo: false,
        canRedo: false,
        ownsEditor: false,
      });
    }
  }

  undo(): boolean {
    if (!this.canWrite()) return false;
    const undone = this.binding?.undo() ?? false;
    this.publishUndoState();
    return undone;
  }

  redo(): boolean {
    if (!this.canWrite()) return false;
    const redone = this.binding?.redo() ?? false;
    this.publishUndoState();
    return redone;
  }

  canUndo(): boolean {
    if (!this.canWrite()) return false;
    return this.binding?.canUndo() ?? false;
  }

  canRedo(): boolean {
    if (!this.canWrite()) return false;
    return this.binding?.canRedo() ?? false;
  }

  /** Publish this client's cursor/selection/brush. No-op while disconnected. */
  publishPresence(
    cursor: { x: number; y: number } | null,
    brush: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null = null,
  ): void {
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
      brush,
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
        this.editor.setReadOnly(this.current.role === "viewer");
        this.revalidatingWasWriter =
          this.current.role === "owner" || this.current.role === "editor";
        this.patch({ status: "connected", error: null });
        this.publishUndoState();
      }
      return;
    }
    const binding = new CollabBinding({ editor: this.editor, doc: this.doc });
    // The host must retire its local-file owner before this binding can mutate
    // the editor. It intentionally stays false through initial probing/sync.
    this.patch({ ownsEditor: true });
    this.editor.setReadOnly(this.current.role === "viewer");
    binding.attach();
    this.binding = binding;
    this.revalidatingWasWriter =
      this.current.role === "owner" || this.current.role === "editor";
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
    });
    this.publishUndoState();
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

  private canWrite(): boolean {
    return (
      this.current.status === "connected" &&
      (this.current.role === "owner" || this.current.role === "editor")
    );
  }

  private installProvider(
    generation: number,
    endpoint: string,
    docId: string,
  ): boolean {
    const doc = new Y.Doc();
    this.doc = doc;
    let provider: DocumentProvider;
    try {
      provider = this.createProvider({
        endpoint,
        docId,
        doc,
        token: this.connection?.token,
        devUser: this.connection?.devUser,
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      return false;
    }
    this.provider = provider;
    const onSync = (isSynced: boolean): void => {
      if (
        this.provider === provider &&
        generation === this.generation &&
        !this.revalidating &&
        this.retryTimer === null &&
        isSynced
      ) {
        this.attach();
      }
    };
    const onStatus = (event: { status?: string }): void => {
      if (
        this.provider === provider &&
        generation === this.generation &&
        event.status === "disconnected"
      ) {
        void this.revalidateAfterClose(provider, generation);
      }
    };
    const onConnectionClose = (): void => {
      if (this.provider === provider && generation === this.generation) {
        void this.revalidateAfterClose(provider, generation);
      }
    };
    provider.on("sync", onSync);
    provider.on("status", onStatus);
    provider.on("connection-close", onConnectionClose);
    this.providerListeners.set(provider, {
      onSync,
      onStatus,
      onConnectionClose,
    });
    return true;
  }

  private readonly providerListeners = new Map<
    DocumentProvider,
    Readonly<{
      // biome-ignore lint/suspicious/noExplicitAny: matches lib0's Observable.
      onSync: (...args: any[]) => void;
      // biome-ignore lint/suspicious/noExplicitAny: matches lib0's Observable.
      onStatus: (...args: any[]) => void;
      // biome-ignore lint/suspicious/noExplicitAny: matches lib0's Observable.
      onConnectionClose: (...args: any[]) => void;
    }>
  >();

  private removeProviderListeners(provider: DocumentProvider): void {
    const handlers = this.providerListeners.get(provider);
    if (handlers) {
      provider.off("sync", handlers.onSync);
      provider.off("status", handlers.onStatus);
      provider.off("connection-close", handlers.onConnectionClose);
      this.providerListeners.delete(provider);
    }
  }

  private connectProvider(): void {
    const provider = this.provider;
    if (!provider) return;
    try {
      void Promise.resolve(provider.connect()).catch(() => {
        if (this.provider === provider && this.current.status !== "closed") {
          void this.revalidateAfterClose(provider, this.generation);
        }
      });
    } catch {
      void this.revalidateAfterClose(provider, this.generation);
    }
    // A fake or a warm cache need not emit a sync event after connect().
    if (provider.synced && !this.revalidating && this.retryTimer === null) {
      this.attach();
    }
  }

  private async revalidateAfterClose(
    provider: DocumentProvider,
    generation: number,
  ): Promise<void> {
    if (
      this.revalidating ||
      this.retryTimer !== null ||
      this.current.status === "closed" ||
      this.current.status === "error" ||
      this.current.docId === null
    ) {
      return;
    }
    this.revalidating = true;
    if (!this.revalidatingWasWriter) {
      this.revalidatingWasWriter =
        this.current.ownsEditor && this.editor.readOnly === false;
    }
    // Stop provider-owned backoff until the current authorization is known.
    provider.disconnect();
    if (this.current.ownsEditor) this.editor.setReadOnly(true);
    this.patch({
      status: "reconnecting",
      role: null,
      canUndo: false,
      canRedo: false,
    });
    // Let a provider finish its close callback before a REST probe decides
    // whether another socket attempt is allowed.
    await Promise.resolve();
    if (
      generation !== this.generation ||
      this.provider !== provider ||
      this.current.docId === null
    ) {
      return;
    }
    const docId = this.current.docId;
    const connection = this.connection;
    if (connection === null) return;
    const probe = await this.api.probeDocument({
      endpoint: connection.endpoint,
      docId,
      ...(connection.devUser ? { devUser: connection.devUser } : {}),
      ...(connection.token ? { token: connection.token } : {}),
    });
    if (
      generation !== this.generation ||
      this.provider !== provider ||
      this.current.docId !== docId
    ) {
      return;
    }
    if (!probe.ok) {
      if (
        probe.status === 401 ||
        probe.status === 403 ||
        probe.status === 404
      ) {
        this.accessLost("Cloud document access was lost.");
      } else {
        this.revalidating = false;
        this.scheduleRevalidation(provider, generation);
      }
      return;
    }
    this.revalidating = false;
    this.retryDelayMs = 500;
    const wasWriter = this.revalidatingWasWriter;
    if (wasWriter && probe.value === "viewer") {
      this.captureRecovery();
      this.detachBinding();
      this.removeProviderListeners(provider);
      provider.disconnect();
      provider.destroy();
      this.provider = null;
      this.doc?.destroy();
      this.doc = null;
      this.revalidatingWasWriter = false;
      if (!this.installProvider(generation, connection.endpoint, docId)) return;
      this.patch({ status: "syncing", role: "viewer", peers: [] });
      this.connectProvider();
      return;
    }
    this.patch({ status: "syncing", role: probe.value });
    this.connectProvider();
  }

  private scheduleRevalidation(
    provider: DocumentProvider,
    generation: number,
  ): void {
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.revalidateAfterClose(provider, generation);
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelayMs = 500;
  }

  private captureRecovery(): void {
    const docId = this.current.docId;
    if (docId === null) return;
    // A recovery copy must not retain references that a later binding can
    // mutate while this snapshot waits to be downloaded.
    const document = structuredClone(this.editor.getSnapshot()) as Document;
    this.patch({
      recoveries: [
        ...this.current.recoveries,
        { id: this.nextRecoveryId++, docId, title: document.title, document },
      ],
    });
  }

  private accessLost(message: string): void {
    const docId = this.current.docId;
    if (docId === null) return;
    if (
      this.current.ownsEditor &&
      (this.editor.readOnly === false || this.revalidatingWasWriter)
    ) {
      this.captureRecovery();
    }
    // Also invalidates an initial probe: host-side access loss can arrive
    // while an open is still pending, before CloudSession owns the editor.
    this.generation += 1;
    this.cancelRetry();
    this.revalidating = false;
    this.revalidatingWasWriter = false;
    this.connection = null;
    this.detachBinding();
    this.editor.setReadOnly(false);
    if (this.provider) {
      this.removeProviderListeners(this.provider);
      this.provider.disconnect();
      this.provider.destroy();
      this.provider = null;
    }
    this.doc?.destroy();
    this.doc = null;
    this.patch({
      status: "error",
      role: null,
      docId: null,
      title: null,
      error: message,
      peers: [],
      canUndo: false,
      canRedo: false,
      ownsEditor: false,
    });
    for (const listener of [...this.accessLostListeners])
      listener({ docId, message });
  }

  private fail(message: string): void {
    this.cancelRetry();
    this.detachBinding();
    this.editor.setReadOnly(false);
    if (this.provider) {
      this.removeProviderListeners(this.provider);
      this.provider.disconnect();
      this.provider.destroy();
      this.provider = null;
    }
    this.doc?.destroy();
    this.doc = null;
    this.patch({
      status: "error",
      role: null,
      docId: null,
      title: null,
      error: message,
      peers: [],
      canUndo: false,
      canRedo: false,
      ownsEditor: false,
    });
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
