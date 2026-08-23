// App shell: the toolbar and the canvas, plus the tool signal they share.
//
// The tool lives here rather than inside either component because both read
// it and both write it — the canvas resets to "select" after placing a
// shape, so the toolbar's highlight has to follow.

import type { Editor } from "@diagra/core";
import { DiagraCanvas, Toolbar, type ToolKind } from "@diagra/ui-solid";
import { createSignal, type JSX } from "solid-js";

export interface AppProps {
  readonly editor: Editor;
}

export function App(props: AppProps): JSX.Element {
  const [tool, setTool] = createSignal<ToolKind>("select");

  return (
    <div class="app-shell">
      <header class="app-header">
        <span class="app-title">diagra</span>
        <span class="app-hint">
          drag to pan, ctrl/cmd + wheel to zoom, delete to remove, cmd/ctrl + Z
          to undo
        </span>
      </header>
      <Toolbar editor={props.editor} tool={tool()} onToolChange={setTool} />
      <DiagraCanvas
        editor={props.editor}
        tool={tool()}
        onToolChange={setTool}
      />
    </div>
  );
}
