import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface FileMenuHandlers {
  readonly canEdit: () => boolean;
  readonly newDocument: () => void;
  readonly open: () => void;
  readonly save: () => void;
  readonly reload: () => void;
  readonly saveAs: () => void;
  readonly exportDocument: () => void;
}

export function dispatchFileMenuAction(
  action: string,
  handlers: FileMenuHandlers,
): void {
  if (action === "export") {
    handlers.exportDocument();
    return;
  }
  if (!handlers.canEdit()) return;
  switch (action) {
    case "new":
      handlers.newDocument();
      break;
    case "open":
      handlers.open();
      break;
    case "reload":
      handlers.reload();
      break;
    case "save":
      handlers.save();
      break;
    case "save-as":
      handlers.saveAs();
      break;
  }
}

/** Listen before draining commands queued while the webview was starting. */
export function watchNativeFileMenu(handlers: FileMenuHandlers): () => void {
  if (!isTauri()) return () => {};
  let stopped = false;
  let unlisten: (() => void) | undefined;
  let pending = Promise.resolve();
  const drain = () => {
    pending = pending
      .then(async () => {
        if (stopped) return;
        const actions = await invoke<string[]>("take_file_menu_actions");
        if (stopped) return;
        for (const action of actions) dispatchFileMenuAction(action, handlers);
      })
      .catch((error) =>
        console.error("Could not read file menu actions", error),
      );
  };
  void listen("file-menu-requested", drain)
    .then((stop) => {
      if (stopped) {
        stop();
        return;
      }
      unlisten = stop;
      drain();
    })
    .catch((error) => console.error("Could not watch file menu", error));
  return () => {
    stopped = true;
    unlisten?.();
  };
}
