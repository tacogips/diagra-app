// The cloud controls: where the server is, which document is open, and how
// to get one.
//
// Nothing here is Tauri-specific, so the whole flow also runs under plain
// `vite dev` in a browser — which is how it gets exercised against
// `wrangler dev` without building the native shell.
//
// The endpoint field starts empty and stays empty until the user fills it in.
// A share token is typed per open and never reaches storage.

import type { Editor } from "@diagra/core";
import { serializeDocument } from "@diagra/io";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  type JSX,
  Show,
} from "solid-js";
import { type CloudApi, cloudApi, type CloudDocument } from "./api.ts";
import type {
  CloudSession,
  CloudSessionState,
  CloudSessionRecovery,
} from "./session.ts";
import type { CloudSettings } from "./settings.ts";
import { ShareControls } from "./ShareControls.tsx";

export interface CloudPanelProps {
  readonly editor: Editor;
  readonly session: CloudSession;
  readonly state: CloudSessionState;
  readonly settings: CloudSettings;
  readonly onSettingsChange: (settings: CloudSettings) => void;
  /**
   * Asked before anything replaces what is on the canvas. Returns false when
   * the user would rather keep their unsaved work.
   */
  readonly mayDiscard?: () => boolean;
  /** Injectable for tests and for a future authenticated client. */
  readonly api?: CloudApi;
  /** Opaque account lifecycle signal; changing it invalidates list pages. */
  readonly refreshToken?: unknown;
}

export function CloudPanel(props: CloudPanelProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [documents, setDocuments] = createSignal<readonly CloudDocument[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [docId, setDocId] = createSignal("");
  const [token, setToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  let listRequest = 0;

  const api = (): CloudApi => props.api ?? cloudApi;

  const credentials = () => ({
    endpoint: props.settings.endpointUrl,
    ...(props.settings.devUser ? { devUser: props.settings.devUser } : {}),
    ...(token() ? { token: token() } : {}),
  });

  const patchSettings = (changes: Partial<CloudSettings>): void => {
    props.onSettingsChange({ ...props.settings, ...changes });
  };

  const listContext = (): string => JSON.stringify(credentials());

  // A list page belongs to one server/account/token context. Never let an
  // older response populate a new account's panel or leave it busy.
  createEffect(() => {
    void api();
    void listContext();
    void props.refreshToken;
    listRequest += 1;
    setDocuments([]);
    setNextCursor(null);
    setBusy(false);
    setNotice(null);
    onCleanup(() => {
      listRequest += 1;
    });
  });

  const loadPage = async (
    before: string | undefined,
    accumulated: readonly CloudDocument[],
  ): Promise<void> => {
    const request = ++listRequest;
    const context = listContext();
    const apiRef = api();
    const refreshToken = props.refreshToken;
    setBusy(true);
    setNotice(null);
    const result = await apiRef.listDocuments({
      ...credentials(),
      ...(before === undefined ? {} : { before }),
    });
    if (request !== listRequest) return;
    if (apiRef !== api() || refreshToken !== props.refreshToken) {
      setBusy(false);
      return;
    }
    if (context !== listContext()) {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (result.ok) {
      if (result.value.cursorReset) {
        setDocuments([]);
        setNextCursor(null);
        setNotice(
          "The document list changed. Refresh list to restart at the newest documents.",
        );
        return;
      }
      const items = [...accumulated, ...result.value.items];
      setDocuments(items);
      setNextCursor(result.value.nextCursor);
      if (result.value.moreDocuments) {
        setNotice("Migrating older documents. Refresh list to check again.");
      } else if (result.value.pendingInvalidation) {
        setNotice("Document access is updating. Refresh list to check again.");
      } else {
        setNotice(items.length === 0 ? "no documents yet" : null);
      }
    } else {
      if (before === undefined) setDocuments([]);
      setNextCursor(null);
      setNotice(result.error);
    }
  };

  const refresh = async (): Promise<void> => loadPage(undefined, []);

  const loadMore = async (): Promise<void> => {
    const cursor = nextCursor();
    if (cursor !== null) await loadPage(cursor, documents());
  };

  /**
   * `confirm` is false only when the room was just created from what is on
   * the canvas: the content is not being discarded, it is being published.
   */
  const openDocument = async (id: string, confirm = true): Promise<void> => {
    if (
      id.trim() === "" ||
      (confirm && props.mayDiscard && !props.mayDiscard())
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    await props.session.open(id.trim(), token() ? { token: token() } : {});
    setBusy(false);
  };

  const createEmpty = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    const result = await api().createDocument({
      ...credentials(),
      title: "Untitled",
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    await openDocument(result.value.id);
  };

  /** Publish what is on the canvas as a new cloud document, then open it. */
  const publishCurrent = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    let jsonl: string;
    try {
      jsonl = serializeDocument(props.editor.getSnapshot());
    } catch (error) {
      setBusy(false);
      setNotice(error instanceof Error ? error.message : String(error));
      return;
    }
    const result = await api().createDocument({ ...credentials(), jsonl });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    await openDocument(result.value.id, false);
  };

  const downloadRecovery = (recovery: CloudSessionRecovery): void => {
    try {
      const blob = new Blob([serializeDocument(recovery.document)], {
        type: "application/x-ndjson;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${recovery.title.replace(/[/\\:*?"<>|]+/g, "-") || "untitled"}-recovery-${recovery.id}.jsonl`;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setNotice("Could not download the recovery copy. Please retry.");
    }
  };

  return (
    <div class="app-cloud-panel">
      <div class="app-cloud-summary">
        <button
          type="button"
          class="app-file-button"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          {open() ? "Hide cloud" : "Cloud"}
        </button>
        <span class="app-cloud-status" data-status={props.state.status}>
          {props.state.status}
        </span>
        <Show when={props.state.docId}>
          {(id) => (
            <button
              type="button"
              class="app-file-button"
              onClick={() => props.session.close()}
              title={`Close ${id()}`}
            >
              Close document
            </button>
          )}
        </Show>
      </div>

      <For each={props.state.recoveries}>
        {(recovery) => (
          <div class="app-cloud-notice" role="status">
            <span>
              Recovery copy #{recovery.id} of {recovery.title} is kept in
              memory. It may contain edits that did not reach the server.
              Download it before closing this app or tab.
            </span>{" "}
            <button
              type="button"
              class="app-file-button"
              onClick={() => downloadRecovery(recovery)}
            >
              Download recovery copy
            </button>{" "}
            <button
              type="button"
              class="app-file-button"
              onClick={() => {
                if (window.confirm("Discard the saved recovery copy?"))
                  props.session.discardRecovery(recovery.id);
              }}
            >
              Discard recovery copy
            </button>
          </div>
        )}
      </For>

      <Show when={notice()}>
        {(message) => <p class="app-cloud-notice">{message()}</p>}
      </Show>

      <Show when={open()}>
        <div class="app-cloud-body">
          <ShareControls
            api={api()}
            state={props.state}
            credentials={credentials()}
          />
          <div class="app-cloud-row">
            <label class="app-cloud-field">
              <span>Endpoint</span>
              {/*
                The placeholder is a format hint on a host that cannot exist
                (RFC 2606 reserves example.com): this build ships no reachable
                endpoint, not even as a suggestion.
              */}
              <input
                type="url"
                placeholder="https://sync.example.com"
                value={props.settings.endpointUrl}
                onChange={(event) =>
                  patchSettings({ endpointUrl: event.currentTarget.value })
                }
              />
            </label>
            <label class="app-cloud-field">
              <span>Name</span>
              <input
                type="text"
                value={props.settings.userName}
                onChange={(event) =>
                  patchSettings({ userName: event.currentTarget.value })
                }
              />
            </label>
            <label class="app-cloud-field app-cloud-field-narrow">
              <span>Colour</span>
              <input
                type="color"
                value={props.settings.userColor}
                onChange={(event) =>
                  patchSettings({ userColor: event.currentTarget.value })
                }
              />
            </label>
            <label class="app-cloud-field">
              <span>Dev user</span>
              <input
                type="text"
                placeholder="optional"
                value={props.settings.devUser ?? ""}
                onChange={(event) =>
                  patchSettings({ devUser: event.currentTarget.value })
                }
              />
            </label>
          </div>

          <div class="app-cloud-row">
            <label class="app-cloud-field">
              <span>Document id</span>
              <input
                type="text"
                value={docId()}
                onInput={(event) => setDocId(event.currentTarget.value)}
              />
            </label>
            <label class="app-cloud-field">
              {/* Kept in memory only: a share link is a credential. */}
              <span>Share token</span>
              <input
                type="password"
                placeholder="optional"
                value={token()}
                onInput={(event) => setToken(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              class="app-file-button"
              disabled={busy() || docId().trim() === ""}
              onClick={() => void openDocument(docId())}
            >
              Open
            </button>
          </div>

          <div class="app-cloud-row">
            <button
              type="button"
              class="app-file-button"
              disabled={busy()}
              onClick={() => void refresh()}
            >
              Refresh list
            </button>
            <button
              type="button"
              class="app-file-button"
              disabled={busy()}
              onClick={() => void createEmpty()}
            >
              New cloud document
            </button>
            <button
              type="button"
              class="app-file-button"
              disabled={busy()}
              onClick={() => void publishCurrent()}
              title="Create a cloud document from what is on the canvas"
            >
              Publish current
            </button>
          </div>

          <Show when={documents().length > 0}>
            <ul class="app-cloud-list">
              <For each={documents()}>
                {(entry) => (
                  <li>
                    <button
                      type="button"
                      class="app-file-button"
                      disabled={busy()}
                      onClick={() => void openDocument(entry.id)}
                    >
                      Open
                    </button>
                    <span class="app-cloud-doc-title">{entry.title}</span>
                    <span class="app-cloud-doc-id">{entry.id}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={nextCursor() !== null}>
            <button
              type="button"
              class="app-file-button"
              disabled={busy()}
              onClick={() => void loadMore()}
            >
              Load more
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
