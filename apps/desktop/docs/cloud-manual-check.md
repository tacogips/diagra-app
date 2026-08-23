# Manual check: cloud documents

What runs headlessly already: the Y.Doc mapping, the minimal-write differ and
the two-way binding in `bun test packages/collab`; the connection state
machine in `apps/desktop/src/cloud/session.test.ts`; and the whole
concurrent-editing claim end to end against a real sync server in the private
cloud repository (`workers/sync/test/collab-binding.test.ts`, plus
`bun --cwd=workers/sync run check:collab-two-client` against `wrangler dev`).

What none of that covers is the webview: whether a real `WebSocket` to a
user-entered endpoint survives the Content Security Policy, and whether two
windows of the built app actually show each other's cursors. That is this
page. Run it after any change to `apps/desktop/src/cloud/`, to
`packages/collab`, or to `app.security.csp` in `src-tauri/tauri.conf.json`.

## Setup

A sync server has to be running. It lives in the private `diagra-cloud`
repository; from a checkout of that repository:

```bash
bun --cwd=workers/sync run migrate:local   # once per .wrangler state dir
bun --cwd=workers/sync run dev             # http://localhost:8787
```

Then start the editor twice — either two windows of `mise run dev`, or one
Tauri window plus a browser tab on `bun --cwd=apps/desktop run dev`. Both
work: nothing in the cloud panel is Tauri-specific.

## Procedure

### 1. Configure the endpoint

1. Press `Cloud`, then type `http://localhost:8787` into **Endpoint**.
2. Give each window a different **Name** and **Colour**, and set **Dev user**
   to `owner` in both (the dev server maps it to a principal; see the sync
   server README).
3. Reload the window. The endpoint, name and colour come back; the share
   token field is empty.

Pass criterion: settings persist, and nothing was written to storage that
looks like a credential (check devtools -> Application -> Local Storage:
`diagra.cloud.settings` holds only the four non-secret fields).

### 2. Publish, then open in the second window

1. In window A, press `Publish current`. The status badge goes
   `connecting` -> `syncing` -> `connected`, and the title bar shows the
   document title instead of the file name.
2. Copy the id from the cloud list (`Refresh list`).
3. In window B, paste it into **Document id** and press `Open`.

Pass criterion: window B shows the same diagram, and the file controls
(New/Open/Save/Save As/Recent) are disabled in both.

### 3. Concurrent edits and cursors

1. Move a shape in window A while window B watches.
2. Move the pointer around window B's canvas.

Pass criterion: the move appears in B within a moment; A shows B's cursor,
coloured and labelled with B's name, and the header shows "1 other here".
The cursor stays put when you pan or zoom (it is projected through the
camera, not pinned to the screen).

### 4. Undo is per user

1. In window A move shape X; in window B move shape Y.
2. Press `Cmd/Ctrl + Z` in window A.

Pass criterion: X returns to where A found it. Y does **not** move. Repeat
with the header `Undo` button; the toolbar's own undo/redo pair is hidden in
cloud mode, because it drives the local-file history rather than the room's.

### 5. Reconnect

1. Stop `wrangler dev`. The badge goes `reconnecting`.
2. Keep editing in window A. The canvas keeps responding.
3. Start `wrangler dev` again.

Pass criterion: the badge returns to `connected` and the edits made while
offline appear in window B. Nothing is lost — the edits were in the local
Y.Doc the whole time.

### 6. Errors are readable

1. Press `Close document`, then open a document id that does not exist.
2. Open a real id with a nonsense **Share token**.

Pass criterion: the banner says "no such document on this endpoint (404)"
and "this share link does not grant access to that document (403)" — not a
spinner that never resolves. The REST probe is what makes this possible: a
refused WebSocket upgrade would just retry forever.

### 7. The Content Security Policy allows the endpoint

Run items 1 to 3 in a **built** binary (`mise run build`), not only in dev,
and watch the webview console.

Pass criterion: no `Content-Security-Policy` violation for the WebSocket or
the REST calls. `connect-src` allows `https:`/`wss:` anywhere plus plaintext
loopback, because the endpoint is user configuration and cannot be known at
build time; if a violation appears, widen that directive rather than
removing the policy.

## Results log

| Date | Platform | App version | 1 | 2 | 3 | 4 | 5 | 6 | 7 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-24 | macOS (darwin 25.5.0) | 0.1.0 | pending | pending | pending | pending | pending | pending | pending | Pending operator run: the implementation session had no interactive desktop session and no running sync server. Items 2 to 5 are covered headlessly at the layer below by `workers/sync/test/collab-binding.test.ts` (two bound editors converging through a real DocRoom, concurrent semantic + visual edits, per-user undo) and by `session.test.ts` (reconnect, error mapping). Items 1, 3 (cursors) and 7 have no headless equivalent. |

Record one row per run. `pending` is only acceptable when the run could not
be executed at all; note why in the last column.
