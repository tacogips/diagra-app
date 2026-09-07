import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { CloudApi, CloudApiOptions, CloudShareInfo } from "./api.ts";
import type { CloudSessionState } from "./session.ts";
import { createShareUrl, shareTokenForRevocation } from "./share-link.ts";

export function ShareControls(props: {
  readonly api: CloudApi;
  readonly state: CloudSessionState;
  readonly credentials: CloudApiOptions;
}) {
  const [role, setRole] = createSignal<"viewer" | "editor">("viewer");
  const [link, setLink] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [revokeInput, setRevokeInput] = createSignal("");
  const [confirmToken, setConfirmToken] = createSignal<string | null>(null);
  const [shares, setShares] = createSignal<readonly CloudShareInfo[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [nextBefore, setNextBefore] = createSignal<number | null>(null);
  let generation = 0;
  onCleanup(() => {
    generation++;
  });
  let context = "";
  createEffect(() => {
    const next = JSON.stringify([
      props.credentials.endpoint,
      props.credentials.devUser,
      props.credentials.token,
      props.state.docId,
      props.state.role,
    ]);
    if (next === context) return;
    context = next;
    generation++;
    setLink("");
    setNotice("");
    setBusy(false);
    setRevokeInput("");
    setConfirmToken(null);
    setShares([]);
    setLoaded(false);
    setNextBefore(null);
  });
  const loadShares = async (more = false) => {
    const id = props.state.docId;
    const before = more ? nextBefore() : null;
    if (
      !id ||
      busy() ||
      confirmToken() !== null ||
      props.state.role !== "owner" ||
      props.state.status !== "connected" ||
      (more && before === null)
    )
      return;
    const version = generation;
    setBusy(true);
    setNotice("");
    const result = await props.api.listShares({
      ...props.credentials,
      docId: id,
      ...(before === null ? {} : { before }),
    });
    if (version !== generation) return;
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setShares((previous) =>
      more
        ? [
            ...previous,
            ...result.value.items.filter(
              (item) => !previous.some((entry) => entry.token === item.token),
            ),
          ]
        : result.value.items,
    );
    setNextBefore(result.value.nextBefore);
    setLoaded(true);
    const selected = shareTokenForRevocation(
      link(),
      props.credentials.endpoint,
      id,
    );
    if (
      result.value.items.some((item) => item.token === selected && item.revoked)
    )
      setLink("");
  };
  const create = async () => {
    const id = props.state.docId;
    if (
      busy() ||
      confirmToken() !== null ||
      props.state.role !== "owner" ||
      props.state.status !== "connected" ||
      !id
    )
      return;
    const version = generation;
    const credentials = props.credentials;
    setBusy(true);
    setLink("");
    setNotice("");
    const result = await props.api.createShare({
      ...credentials,
      docId: id,
      role: role(),
    });
    if (version !== generation) return;
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    // Creation changes the first page; ask for a fresh list instead of merging
    // a response that has no authoritative creation timestamp.
    setShares([]);
    setLoaded(false);
    setNextBefore(null);
    try {
      setLink(
        createShareUrl(credentials.endpoint, {
          docId: result.value.documentId,
          token: result.value.token,
        }),
      );
    } catch {
      setNotice("Share created, but the endpoint cannot form a browser link.");
    }
  };
  const copy = async () => {
    const value = link();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (link() === value)
        setNotice("Share link copied. Send it only to intended collaborators.");
    } catch {
      if (link() === value)
        setNotice("Clipboard unavailable. Select and copy the link manually.");
    }
  };
  const prepareRevocation = (value: string) => {
    if (
      busy() ||
      props.state.role !== "owner" ||
      props.state.status !== "connected" ||
      !props.state.docId
    )
      return;
    const token = shareTokenForRevocation(
      value,
      props.credentials.endpoint,
      props.state.docId,
    );
    setConfirmToken(token);
    setNotice(
      token ? "" : "Paste a valid share link for this document and server.",
    );
  };
  const revoke = async () => {
    const token = confirmToken();
    const id = props.state.docId;
    if (
      !token ||
      !id ||
      busy() ||
      props.state.role !== "owner" ||
      props.state.status !== "connected"
    )
      return;
    const version = generation;
    const credentials = props.credentials;
    setBusy(true);
    setNotice("");
    const result = await props.api.revokeShare({
      ...credentials,
      docId: id,
      shareToken: token,
    });
    if (version !== generation) return;
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    if (shareTokenForRevocation(link(), credentials.endpoint, id) === token)
      setLink("");
    setConfirmToken(null);
    setRevokeInput("");
    setShares((items) =>
      items.map((item) =>
        item.token === token ? { ...item, revoked: true } : item,
      ),
    );
    setNotice(
      "Share link revoked and its connected clients disconnected. Other links still work; downloaded copies cannot be removed.",
    );
  };
  return (
    <Show when={props.state.role === "owner"}>
      <section aria-label="Share cloud document">
        <button
          type="button"
          disabled={
            busy() ||
            confirmToken() !== null ||
            props.state.status !== "connected"
          }
          onClick={() => void loadShares()}
        >
          {loaded() ? "Refresh share links" : "Load share links"}
        </button>
        <Show when={loaded()}>
          <p>
            Issued links, newest first. Refresh to see changes made elsewhere.
          </p>
          <Show
            when={shares().length > 0}
            fallback={<p>No share links have been issued.</p>}
          >
            <ul
              aria-label="Issued share links"
              style={{ "max-height": "280px", overflow: "auto" }}
            >
              <For each={shares()}>
                {(share) => (
                  <li>
                    <span>
                      {share.role === "editor" ? "Can edit" : "Can view"} —{" "}
                      {share.revoked ? "Revoked" : "Active"} —{" "}
                      {new Date(share.createdAt).toLocaleString()}
                    </span>
                    <Show when={!share.revoked}>
                      <button
                        type="button"
                        disabled={busy() || confirmToken() !== null}
                        onClick={() => {
                          try {
                            setLink(
                              createShareUrl(props.credentials.endpoint, {
                                docId: share.documentId,
                                token: share.token,
                              }),
                            );
                            setRole(share.role);
                            setNotice("");
                          } catch {
                            setNotice(
                              "The endpoint cannot form a browser link.",
                            );
                          }
                        }}
                      >
                        Select link to copy
                      </button>
                    </Show>
                    <button
                      type="button"
                      disabled={
                        busy() ||
                        confirmToken() !== null ||
                        props.state.status !== "connected"
                      }
                      onClick={() => {
                        setConfirmToken(share.token);
                        setNotice("");
                      }}
                    >
                      {share.revoked ? "Retry disconnection…" : "Revoke link…"}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={nextBefore() !== null}>
            <button
              type="button"
              disabled={
                busy() ||
                confirmToken() !== null ||
                props.state.status !== "connected"
              }
              onClick={() => void loadShares(true)}
            >
              Load older links
            </button>
          </Show>
        </Show>
        <label>
          Link permission{" "}
          <select
            aria-label="Share link permission"
            value={role()}
            disabled={busy() || confirmToken() !== null}
            onChange={(event) => {
              setRole(
                event.currentTarget.value === "editor" ? "editor" : "viewer",
              );
              setLink("");
            }}
          >
            <option value="viewer">Can view</option>
            <option value="editor">Can edit</option>
          </select>
        </label>
        <button
          type="button"
          disabled={
            busy() ||
            confirmToken() !== null ||
            props.state.status !== "connected"
          }
          onClick={() => void create()}
        >
          Create share link
        </button>
        <p>
          Anyone with this link receives the selected permission. Creating
          another link does not revoke older links.
        </p>
        <Show when={link()}>
          <input
            aria-label="Selected share link"
            type="password"
            readOnly
            value={link()}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" onClick={() => void copy()}>
            Copy share link
          </button>
          <button
            type="button"
            disabled={
              busy() ||
              confirmToken() !== null ||
              props.state.status !== "connected"
            }
            onClick={() => prepareRevocation(link())}
          >
            Revoke this link…
          </button>
        </Show>
        <label>
          Existing share link to revoke
          <input
            type="password"
            autocomplete="off"
            maxLength={4096}
            spellcheck={false}
            value={revokeInput()}
            disabled={busy() || confirmToken() !== null}
            onInput={(event) => setRevokeInput(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          disabled={
            busy() ||
            confirmToken() !== null ||
            !revokeInput().trim() ||
            props.state.status !== "connected"
          }
          onClick={() => prepareRevocation(revokeInput())}
        >
          Review revocation…
        </button>
        <Show when={confirmToken()}>
          <p>
            Revoke this share link? Everyone using it will lose cloud access and
            be disconnected. Downloaded copies will remain. This cannot be
            undone.
          </p>
          <button
            type="button"
            disabled={busy() || props.state.status !== "connected"}
            onClick={() => void revoke()}
          >
            Confirm revoke link
          </button>
          <button
            type="button"
            disabled={busy()}
            onClick={() => {
              setConfirmToken(null);
              setNotice("");
            }}
          >
            Cancel revocation
          </button>
        </Show>
        <Show when={busy()}>
          <output>Updating sharing controls…</output>
        </Show>
        <Show when={notice()}>
          <output>{notice()}</output>
        </Show>
      </section>
    </Show>
  );
}
