// Bridge from the core's subscription callbacks to Solid signals.
//
// The core store stays canonical: nothing is copied into a Solid store. The
// signals here are change *notifications* — a revision counter plus the two
// pieces of ephemeral state — and views read the current value straight off
// the editor whenever one of them fires.

import type { CameraState, Editor } from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import { type Accessor, createSignal, onCleanup } from "solid-js";

export interface EditorSignals {
  /** Increments on every store commit. Read it to depend on the document. */
  readonly rev: Accessor<number>;
  readonly camera: Accessor<CameraState>;
  readonly selection: Accessor<ReadonlySet<ElementId>>;
}

/**
 * Subscribe to an editor for the lifetime of the calling component.
 * Must be called from a component or reactive root so `onCleanup` runs.
 */
export function createEditorSignals(editor: Editor): EditorSignals {
  const [rev, setRev] = createSignal(editor.revision);
  const [camera, setCamera] = createSignal<CameraState>(editor.camera.get());
  const [selection, setSelection] = createSignal<ReadonlySet<ElementId>>(
    editor.selection.ids(),
  );

  const unsubscribes = [
    editor.subscribe(() => setRev(editor.revision)),
    editor.camera.subscribe((state) => setCamera(state)),
    editor.selection.subscribe((ids) => setSelection(ids)),
  ];
  onCleanup(() => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  });

  return { rev, camera, selection };
}
