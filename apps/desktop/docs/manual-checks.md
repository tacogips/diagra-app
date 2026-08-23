# Manual checks: local file editing

The automated suites cover everything that can run headlessly: the atomic
write and the recent-files store in `cargo test`, and the whole document
lifecycle — dirty tracking, debounced autosave, self-write suppression,
conflict reload/keep, and the byte-identical save/open round trip — in
`bun test apps/desktop`.

What no test here can cover is the part that needs a real window and a real
filesystem watcher: native dialogs, macOS FSEvents, and the app surviving a
restart. That is what this page is for. Run it after any change to
`apps/desktop/src-tauri/src/{dialogs,fs,recent,watch}.rs` or to
`apps/desktop/src/file/`.

## Setup

```bash
mise run dev
```

Use a scratch directory outside the repository, for example
`~/diagra-manual/`.

## Procedure

### 1. Save, quit, reopen, and re-save byte for byte

1. In the fresh window, drag a couple of shapes onto the canvas and move one
   of them.
2. `Save As` -> `~/diagra-manual/roundtrip.jsonl`.
3. Copy the file: `cp ~/diagra-manual/roundtrip.jsonl ~/diagra-manual/roundtrip.expected`.
4. Quit the app completely, then relaunch it.
5. `Open` -> `roundtrip.jsonl`. The canvas must show exactly what you saved:
   same shapes, same positions, same labels.
6. Press `Cmd/Ctrl + S` without editing anything.
7. `diff ~/diagra-manual/roundtrip.jsonl ~/diagra-manual/roundtrip.expected`
   must print nothing.

Pass criterion: identical canvas and an empty `diff`.

### 2. External change raises a reload prompt

1. With `roundtrip.jsonl` open, edit the file in another editor — change the
   document `title`, or append a shape record copied from an existing line
   with a different `id` — and save it.
2. Within roughly a second, the app must show the banner
   `File changed on disk.` with `Reload` and `Keep mine`.
3. Click `Reload`. The canvas must show the external edit.

Pass criterion: the banner appears without touching the app, and `Reload`
loads the external content.

### 3. Keep mine wins the next write

1. Edit the open file externally again and wait for the banner.
2. Click `Keep mine`. The banner disappears and the file name is marked
   dirty (`*`).
3. Wait more than one second without touching anything (the autosave
   debounce), or press `Cmd/Ctrl + S`.
4. Re-read the file on disk: it must hold the app's document, not the
   external edit.

Pass criterion: the app's version overwrites the external edit, and no
banner loop follows the write.

### 4. Autosave does not prompt itself

1. With a file open, move a shape and stop.
2. After roughly a second the dirty marker clears on its own and the file's
   modification time advances (`ls -l`).
3. No conflict banner appears — the app must recognize its own write.

Pass criterion: the file updates silently.

### 5. Recent files survive a restart

1. Open two different `.jsonl` files in turn.
2. Quit and relaunch the app.
3. The `Recent` dropdown lists both, most recently opened first.
4. Pick one: it opens.
5. Move one of the files away (`mv`), relaunch, and pick its entry: an error
   is shown and the entry disappears from the list.

Pass criterion: the list survives the restart and self-heals on a dead
entry.

### 6. Unsaved-changes guard

1. Edit the document without saving, then click `New` (or `Open`).
2. A confirmation prompt appears; cancelling it keeps the document.

Pass criterion: no silent loss of unsaved work.

## Results log

| Date | Platform | App version | 1 | 2 | 3 | 4 | 5 | 6 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-24 | macOS (darwin 25.5.0) | 0.1.0 | pending | pending | pending | pending | pending | pending | Pending operator run: the implementation session had no interactive desktop session to drive the GUI. The io-level round-trip that item 1 checks by eye is asserted headlessly by `apps/desktop/src/file/session.test.ts` ("reopening a saved document reproduces the file byte for byte") and by the `packages/io` round-trip and golden suites. |

Record one row per run. `pending` is only acceptable when the run could not
be executed at all; note why in the last column.

## Known limitation

Quitting inside the one-second autosave debounce can lose the last edit. The
window's `beforeunload` handler flushes a pending autosave on a best-effort
basis, but the OS can terminate the process before the write completes. Save
explicitly (`Cmd/Ctrl + S`) before quitting if the last edit matters.
