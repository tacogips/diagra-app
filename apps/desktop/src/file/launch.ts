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
  /** Called when new paths were queued; returns an unsubscribe function. */
  onOpenRequested(listener: () => void): () => void;
}

export function createTauriLaunchBackend(): LaunchBackend {
  return {
    takePaths: () => invoke<string[]>("take_launch_paths"),
    onOpenRequested: (listener) => {
      let unlisten: UnlistenFn | null = null;
      let disposed = false;
      void listen(OPEN_REQUESTED_EVENT, () => listener()).then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      });
      return () => {
        disposed = true;
        unlisten?.();
        unlisten = null;
      };
    },
  };
}

export function createUnavailableLaunchBackend(): LaunchBackend {
  return {
    takePaths: () => Promise.resolve([]),
    onOpenRequested: () => () => {},
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
