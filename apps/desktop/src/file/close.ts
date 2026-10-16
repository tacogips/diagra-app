import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DocumentSession } from "./session.ts";

/** Manual saving never writes on close; failed automatic saves stay reviewable. */
export async function prepareDocumentClose(
  session: Pick<DocumentSession, "flush" | "state">,
  confirmDiscard: () => Promise<boolean>,
): Promise<boolean> {
  await session.flush();
  return !session.state().dirty || confirmDiscard();
}

export async function installCloseGuard(
  session: DocumentSession,
): Promise<void> {
  let approved = false;
  window.addEventListener("beforeunload", (event) => {
    if (!approved && session.state().dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  if (!isTauri()) return;
  let closing = false;
  await listen("document-close-requested", () => {
    if (closing) return;
    closing = true;
    void (async () => {
      try {
        if (
          !(await prepareDocumentClose(session, () => confirmDiscardChanges()))
        )
          return;
        approved = true;
        await invoke("finish_document_close");
      } catch (error) {
        approved = false;
        console.error("Could not finish closing the document", error);
      } finally {
        closing = false;
      }
    })();
  });
  await invoke("enable_close_guard");
}

/** A modal in the editor remains visible even when the OS sends Quit in the background. */
function confirmDiscardChanges(): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-close-dialog";
    dialog.setAttribute("aria-label", "Unsaved changes");
    const message = document.createElement("p");
    message.textContent = "Discard unsaved changes?";
    const finish = (discard: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(discard);
    };
    const discard = document.createElement("button");
    discard.textContent = "Discard";
    discard.onclick = () => finish(true);
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.autofocus = true;
    cancel.onclick = () => finish(false);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.append(message, discard, cancel);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
