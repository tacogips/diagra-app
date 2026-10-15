// Desktop entry point.
//
// Builds an editor, seeds the demo document, wires the document session to
// the host filesystem, and mounts the Solid app. Seeding happens before the
// session exists so the demo document is the clean starting state rather
// than the user's first unsaved edit.
//
// The packaged desktop client owns local files only. Cloud sessions are supplied
// by the separately hosted web entry point, never by this application.

import { createDefaultRegistry, Editor } from "@nodetto/core";
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import { createExportBackend, createFileBackend } from "./file/backend.ts";
import { createLaunchBackend } from "./file/launch.ts";
import { DocumentSession } from "./file/session.ts";
import { seed } from "./seed.ts";
import "./style.css";
import "./inspector.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app root element");
}

const editor = new Editor({ registry: createDefaultRegistry() });
seed(editor);

const backend = createFileBackend();
const session = new DocumentSession({ editor, backend });
// Exports share the dialog and atomic-write commands but not the session:
// an export never changes which file is open.
const exportBackend = createExportBackend();

// Best effort on the way out: an autosave still inside its debounce window
// gets one chance to reach disk. A quit can still outrun it.
window.addEventListener("beforeunload", () => {
  void session.flush();
  session.dispose();
});

render(
  () => (
    <App
      editor={editor}
      session={session}
      filesAvailable={backend.available}
      exportBackend={exportBackend}
      launchBackend={createLaunchBackend()}
    />
  ),
  root,
);
