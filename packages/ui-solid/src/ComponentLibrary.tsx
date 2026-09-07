import {
  type Editor,
  componentInstancesOnPage,
  selectComponentInstances,
} from "@diagra/core";
import type { FrameSemantic } from "@diagra/ir";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import { componentPreviewSource } from "./component-preview.ts";

export function ComponentLibrary(props: {
  readonly editor: Editor;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const [query, setQuery] = createSignal("");
  const [previewId, setPreviewId] = createSignal<string | null>(null);
  const instances = createMemo(() => {
    signals.rev();
    return componentInstancesOnPage(props.editor);
  });
  const components = createMemo(() => {
    signals.rev();
    const search = query().trim().toLocaleLowerCase();
    return props.editor
      .getSnapshot()
      .elements.filter(
        (element) =>
          element.type === "frame" &&
          (element.semantic as FrameSemantic).component === true,
      )
      .map((element) => {
        const semantic = element.semantic as FrameSemantic;
        const properties = (semantic.variantProperties ?? [])
          .map((property) => `${property.name}=${property.value}`)
          .join(", ");
        return {
          element,
          name: semantic.name || "Untitled component",
          page: props.editor.store.getPage(element.page)?.name ?? "",
          variant: [semantic.variantSet, properties || semantic.variantName]
            .filter(Boolean)
            .join(" / "),
        };
      })
      .filter((entry) =>
        `${entry.name} ${entry.page} ${entry.variant}`
          .toLocaleLowerCase()
          .includes(search),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.element.id.localeCompare(b.element.id),
      );
  });
  // Stable IDs preserve the entry subtree while its metadata changes.
  const entriesById = createMemo(
    () => new Map(components().map((entry) => [entry.element.id, entry])),
  );
  const componentIds = createMemo(() =>
    components().map((entry) => entry.element.id),
  );
  const preview = createMemo(() => {
    signals.rev();
    const id = previewId();
    return id && entriesById().has(id)
      ? componentPreviewSource(props.editor, id)
      : null;
  });
  return (
    <section class="diagra-component-library" aria-label="Component library">
      <h2>Components</h2>
      <input
        type="search"
        aria-label="Search components"
        placeholder="Search name, page or variant"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      />
      <For each={componentIds()}>
        {(id) => (
          <Show when={entriesById().get(id)}>
            {(entry) => (
              <div class="diagra-component-entry">
                <strong>{entry().name}</strong>
                <span>{entry().page}</span>
                <Show when={entry().variant}>
                  <span>{entry().variant}</span>
                </Show>
                <div>
                  <button
                    type="button"
                    aria-label={`Preview ${entry().name}`}
                    aria-expanded={previewId() === id}
                    onClick={() => setPreviewId(previewId() === id ? null : id)}
                  >
                    {previewId() === id ? "Hide preview" : "Preview"}
                  </button>
                  <button
                    type="button"
                    title={`Insert ${entry().name} on this page`}
                    disabled={readOnly()}
                    onClick={() =>
                      props.editor.createComponentInstance(
                        id,
                        props.editor.camera.screenToPage({ x: 40, y: 40 }),
                      )
                    }
                  >
                    Insert
                  </button>
                  <button
                    type="button"
                    title={`${readOnly() ? "Inspect" : "Edit"} ${entry().name} source`}
                    onClick={() => {
                      props.editor.setCurrentPage(entry().element.page);
                      props.editor.selection.set([id]);
                      const box = props.editor.getBounds(id);
                      if (box)
                        props.editor.camera.set({
                          x: -box.x + 40,
                          y: -box.y + 40,
                          z: 1,
                        });
                    }}
                  >
                    Go to source
                  </button>
                </div>
                <button
                  type="button"
                  title="Select editable instances of this exact component on the current page"
                  disabled={!instances().get(id)?.length}
                  onClick={() => selectComponentInstances(props.editor, id)}
                >
                  Select instances on this page (
                  {instances().get(id)?.length ?? 0})
                </button>
                <Show when={previewId() === id}>
                  <Show
                    when={preview()}
                    fallback={
                      <span>Preview unavailable for this component.</span>
                    }
                  >
                    {(source) => (
                      <img
                        class="diagra-component-preview"
                        src={source()}
                        alt={`Preview of ${entry().name}`}
                        decoding="async"
                      />
                    )}
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        )}
      </For>
      <Show when={components().length === 0}>
        <p>
          No matching components. Select an artboard and choose Create component
          in the inspector.
        </p>
      </Show>
    </section>
  );
}
