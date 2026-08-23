// Desktop entry point.
//
// Builds an editor, seeds the demo document, wires the document session to
// the host filesystem, and mounts the Solid app. Seeding happens before the
// session exists so the demo document is the clean starting state rather
// than the user's first unsaved edit.

import { createDefaultRegistry, Editor } from "@diagra/core";
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import { createFileBackend } from "./file/backend.ts";
import { DocumentSession } from "./file/session.ts";
import { seed } from "./seed.ts";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app root element");
}

const editor = new Editor({ registry: createDefaultRegistry() });
seed(editor);

const backend = createFileBackend();
const session = new DocumentSession({ editor, backend });

// Best effort on the way out: an autosave still inside its debounce window
// gets one chance to reach disk. A quit can still outrun it.
window.addEventListener("beforeunload", () => {
  void session.flush();
  session.dispose();
});

render(
  () => (
    <App editor={editor} session={session} filesAvailable={backend.available} />
  ),
  root,
);
