// Desktop entry point.
//
// Builds an editor, seeds the demo document, and mounts the Solid app.

import { createDefaultRegistry, Editor } from "@diagra/core";
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import { seed } from "./seed.ts";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app root element");
}

const editor = new Editor({ registry: createDefaultRegistry() });
seed(editor);

render(() => <App editor={editor} />, root);
