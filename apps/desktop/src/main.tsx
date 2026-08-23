// Desktop entry point.
//
// Builds an editor, seeds the demo document, wires the document session to
// the host filesystem, and mounts the Solid app. Seeding happens before the
// session exists so the demo document is the clean starting state rather
// than the user's first unsaved edit.
//
// The cloud session is built here too, but connects to nothing until the user
// configures an endpoint and opens a document: this build ships no server
// address of any kind.

import { createDefaultRegistry, Editor } from "@diagra/core";
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import {
  type CloudSettings,
  loadCloudSettings,
  saveCloudSettings,
} from "./cloud/settings.ts";
import { CloudSession } from "./cloud/session.ts";
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

// The session reads these on every connect, so an endpoint edited mid-run
// applies to the next open without a restart.
let cloudSettings: CloudSettings = loadCloudSettings();
const cloud = new CloudSession({ editor, settings: () => cloudSettings });

// Best effort on the way out: an autosave still inside its debounce window
// gets one chance to reach disk. A quit can still outrun it.
window.addEventListener("beforeunload", () => {
  void session.flush();
  session.dispose();
  cloud.close();
});

render(
  () => (
    <App
      editor={editor}
      session={session}
      cloud={cloud}
      filesAvailable={backend.available}
      cloudSettings={cloudSettings}
      onCloudSettingsChange={(next) => {
        cloudSettings = next;
        saveCloudSettings(next);
      }}
    />
  ),
  root,
);
