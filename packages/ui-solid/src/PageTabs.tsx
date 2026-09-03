// Page tabs above the canvas (design editor-ux 8).
//
// The tab strip reads the store's page list on every revision and writes
// only through the editor's page commands, so an undo puts a deleted tab back
// where it was and a remote rename shows up like a local one. The only state
// kept here is transient UI: which tab is being renamed and which tab's menu
// is open.

import type { Editor } from "@diagra/core";
import type { Page, PageId } from "@diagra/ir";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";

export interface PageTabsProps {
  readonly editor: Editor;
}

const DELETE_PROMPT = (page: Page, count: number): string =>
  `Delete page "${page.name}" and the ${count} element${
    count === 1 ? "" : "s"
  } on it?`;

export function PageTabs(props: PageTabsProps): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [renaming, setRenaming] = createSignal<PageId | null>(null);
  const [menuFor, setMenuFor] = createSignal<PageId | null>(null);

  const pages = createMemo<readonly Page[]>(() => {
    signals.rev();
    return props.editor.store.listPages();
  });
  const currentId = (): PageId => {
    signals.rev();
    return props.editor.currentPageId;
  };
  const canDelete = (): boolean => pages().length > 1;

  const startRename = (id: PageId): void => {
    setMenuFor(null);
    setRenaming(id);
  };

  const commitRename = (id: PageId, value: string): void => {
    if (renaming() !== id) {
      return;
    }
    setRenaming(null);
    const name = value.trim();
    if (name !== "") {
      props.editor.renamePage(id, name);
    }
  };

  const remove = (page: Page): void => {
    setMenuFor(null);
    if (!canDelete()) {
      return;
    }
    const count = props.editor.store.getPageElements(page.id).length;
    if (count > 0 && !window.confirm(DELETE_PROMPT(page, count))) {
      return;
    }
    props.editor.deletePage(page.id);
  };

  const duplicate = (page: Page): void => {
    setMenuFor(null);
    props.editor.duplicatePage(page.id);
  };

  // A menu closes on any press outside it, like the context menu does.
  createEffect(() => {
    if (menuFor() === null) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".diagra-page-menu, .diagra-page-menu-button")
      ) {
        return;
      }
      setMenuFor(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    onCleanup(() =>
      window.removeEventListener("pointerdown", onPointerDown, true),
    );
  });

  const focusInput = (input: HTMLInputElement): void => {
    // The input is created inside the click handler's render; defer so the
    // browser has attached it before focus and select run.
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  };

  return (
    <div class="diagra-page-tabs" role="tablist" aria-label="Pages">
      <For each={pages()}>
        {(page) => (
          <div
            class="diagra-page-tab"
            classList={{ "diagra-active": currentId() === page.id }}
            role="tab"
            aria-selected={currentId() === page.id}
          >
            <Show
              when={renaming() === page.id}
              fallback={
                <button
                  type="button"
                  class="diagra-page-tab-name"
                  title={`${page.name} (${page.kind}). Double-click to rename`}
                  onClick={() => props.editor.setCurrentPage(page.id)}
                  onDblClick={() => startRename(page.id)}
                >
                  {page.name}
                </button>
              }
            >
              <input
                class="diagra-page-rename"
                type="text"
                value={page.name}
                ref={focusInput}
                aria-label="Page name"
                // Typing a tool letter here must insert the letter, never
                // switch tools (design editor-ux 5).
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault();
                    commitRename(page.id, event.currentTarget.value);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setRenaming(null);
                  }
                }}
                onBlur={(event) =>
                  commitRename(page.id, event.currentTarget.value)
                }
              />
            </Show>
            <button
              type="button"
              class="diagra-page-menu-button"
              title="Page options"
              aria-haspopup="menu"
              aria-expanded={menuFor() === page.id}
              onClick={() => setMenuFor(menuFor() === page.id ? null : page.id)}
            >
              ...
            </button>
            <Show when={menuFor() === page.id}>
              <div class="diagra-page-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  class="diagra-menu-item"
                  title="Rename page"
                  onClick={() => startRename(page.id)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="diagra-menu-item"
                  title="Duplicate page and everything on it"
                  onClick={() => duplicate(page)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="diagra-menu-item"
                  title={
                    canDelete()
                      ? "Delete page"
                      : "The last page cannot be deleted"
                  }
                  disabled={!canDelete()}
                  onClick={() => remove(page)}
                >
                  Delete
                </button>
              </div>
            </Show>
          </div>
        )}
      </For>
      <button
        type="button"
        class="diagra-page-add"
        title="Add page"
        onClick={() => props.editor.createPage()}
      >
        +
      </button>
    </div>
  );
}
