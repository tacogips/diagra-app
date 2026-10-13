// Documents the OS asked the app to open: command-line paths and, on macOS,
// open-documents events (`open -a diagra file.jsonl`, Finder "Open With").
// Rust queues the paths until the frontend takes them, so a request that
// arrives before the webview is listening is not lost.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const OPEN_REQUESTED_EVENT = "open-documents-requested";

export interface LaunchBackend {
  /** Remove and return the queued paths, oldest first. */
  takePaths(): Promise<readonly string[]>;
  /**
   * Call `listener` when new paths were queued. Resolves to an unsubscribe
   * function once the listener is registered: only from then on is a newly
   * queued path guaranteed to wake it.
   */
  onOpenRequested(listener: () => void): Promise<() => void>;
}

export function createTauriLaunchBackend(): LaunchBackend {
  return {
    takePaths: () => invoke<string[]>("take_launch_paths"),
    onOpenRequested: (listener) =>
      listen(OPEN_REQUESTED_EVENT, () => listener()).then(
        (stop: UnlistenFn) => () => stop(),
      ),
  };
}

export function createUnavailableLaunchBackend(): LaunchBackend {
  return {
    takePaths: () => Promise.resolve([]),
    onOpenRequested: () => Promise.resolve(() => {}),
  };
}

export function createLaunchBackend(): LaunchBackend {
  return isTauri()
    ? createTauriLaunchBackend()
    : createUnavailableLaunchBackend();
}

/**
 * Take the queued paths and open the most recent request; earlier queued
 * paths are superseded because the editor holds one document at a time.
 */
export async function openRequestedDocument(
  backend: LaunchBackend,
  open: (path: string) => void,
): Promise<void> {
  const path = (await backend.takePaths()).at(-1);
  if (path) open(path);
}

export interface OpenRequestWatcher {
  /** Open what was held back while `canOpen` said no; a no-op otherwise. */
  flush(): void;
  stop(): void;
}

/**
 * Open OS requests as they arrive. The listener is registered before the
 * queue is first drained, so a request queued in between still wakes it.
 * While `canOpen` is false (a cloud room owns the editor) nothing is taken:
 * the paths stay queued on the Rust side until `flush`.
 */
export function watchOpenRequests(
  backend: LaunchBackend,
  open: (path: string) => void,
  canOpen: () => boolean,
): OpenRequestWatcher {
  let stopped = false;
  let held = false;
  // A path already taken off the queue when ownership changed under the
  // take; it is opened on the next flush unless a newer request wins.
  let pending: string | null = null;
  let unlisten: (() => void) | null = null;
  const drain = (): void => {
    if (stopped) return;
    if (!canOpen()) {
      held = true;
      return;
    }
    held = false;
    void backend.takePaths().then(
      (paths) => {
        if (stopped) return;
        const path = paths.at(-1) ?? pending;
        if (!path) return;
        if (!canOpen()) {
          pending = path;
          held = true;
          return;
        }
        pending = null;
        open(path);
      },
      () => {
        // Nothing was taken; whatever is pending stays for the next flush.
        if (pending) held = true;
      },
    );
  };
  void backend.onOpenRequested(drain).then(
    (stop) => {
      if (stopped) {
        stop();
        return;
      }
      unlisten = stop;
      drain();
    },
    // Without a listener the launch paths are still worth opening once.
    () => drain(),
  );
  return {
    flush: () => {
      if (held) drain();
    },
    stop: () => {
      stopped = true;
      unlisten?.();
      unlisten = null;
    },
  };
}
