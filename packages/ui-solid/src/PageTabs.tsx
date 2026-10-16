// Page tabs above the canvas (design editor-ux 8).
//
// The tab strip reads the store's page list on every revision and writes
// only through the editor's page commands, so an undo puts a deleted tab back
// where it was and a remote rename shows up like a local one. The only state
// kept here is transient UI: which tab is being renamed and which tab's menu
// is open.

import type { Editor } from "@nodetto/core";
import type { Page, PageId } from "@nodetto/ir";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import {
  PageTabDrag,
  type PageTabDrop,
  type PageTabBox,
} from "./page-tab-drag.ts";
import { pageRenameDraft } from "./page-rename.ts";

export interface PageTabsProps {
  readonly editor: Editor;
}

const DELETE_PROMPT = (page: Page, count: number): string =>
  `Delete page "${page.name}" and the ${count} element${
    count === 1 ? "" : "s"
  } on it?`;

export function PageTabs(props: PageTabsProps): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const [renaming, setRenaming] = createSignal<PageId | null>(null);
  const [menuFor, setMenuFor] = createSignal<PageId | null>(null);
  createEffect(() => {
    if (!readOnly()) return;
    setRenaming(null);
    setMenuFor(null);
  });
  let renameDraft: ReturnType<typeof pageRenameDraft>;
  const [renameValue, setRenameValue] = createSignal("");
  const [renameError, setRenameError] = createSignal("");
  const renameErrorId = createUniqueId();
  let strip: HTMLDivElement | undefined;
  const drag = new PageTabDrag(props.editor);
  const [draggedPage, setDraggedPage] = createSignal<PageId | null>(null);
  const [drop, setDrop] = createSignal<PageTabDrop | null>(null);
  let suppressClick = false;
  const cancelDrag = (): void => {
    suppressClick = suppressClick || drag.moved;
    drag.cancel();
    setDraggedPage(null);
    setDrop(null);
  };
  const tabBoxes = (): PageTabBox[] =>
    Array.from(
      strip?.querySelectorAll<HTMLDivElement>("[data-page-drag-target]") ?? [],
    ).map((element) => {
      const box = element.getBoundingClientRect();
      return {
        id: element.dataset.pageDragTarget ?? "",
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      };
    });
  const moveDrag = (event: PointerEvent): void => {
    if (!drag.owns(event.pointerId)) return;
    setDrop(
      drag.move(
        event.pointerId,
        { x: event.clientX, y: event.clientY },
        tabBoxes(),
      ),
    );
    if (drag.moved) setDraggedPage(drag.id);
  };
  createEffect(() => {
    signals.rev();
    if (drag.id && !drag.available) cancelDrag();
  });
  const cancelKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || drag.id === null) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
  };
  window.addEventListener("keydown", cancelKey, true);
  window.addEventListener("blur", cancelDrag);
  onCleanup(() => {
    window.removeEventListener("keydown", cancelKey, true);
    window.removeEventListener("blur", cancelDrag);
    cancelDrag();
  });

  const focusPage = (id: PageId): void => {
    queueMicrotask(() => {
      const button = Array.from(
        strip?.querySelectorAll<HTMLButtonElement>("[data-page-tab]") ?? [],
      ).find((candidate) => candidate.dataset.pageTab === id);
      button?.focus();
      button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  const openMenu = (id: PageId): void => {
    if (props.editor.readOnly) return;
    setMenuFor(id);
    queueMicrotask(() =>
      strip
        ?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")
        ?.focus(),
    );
  };
  const tabKey = (event: KeyboardEvent, id: PageId): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
      return;
    const list = pages();
    const index = list.findIndex((page) => page.id === id);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? list.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % list.length
            : event.key === "ArrowLeft"
              ? (index + list.length - 1) % list.length
              : null;
    if (next !== null && list[next]) {
      event.preventDefault();
      setMenuFor(null);
      props.editor.setCurrentPage(list[next].id);
      focusPage(list[next].id);
    } else if (event.key === "F2") {
      event.preventDefault();
      startRename(id);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(id);
    }
  };

  const pages = createMemo<readonly Page[]>(() => {
    signals.rev();
    return props.editor.store.listPages();
  });
  const pagesById = createMemo(
    () => new Map(pages().map((page) => [page.id, page])),
  );
  const pageIds = createMemo(() => pages().map((page) => page.id));
  const currentId = (): PageId => {
    signals.rev();
    return props.editor.currentPageId;
  };
  const canDelete = (): boolean => !readOnly() && pages().length > 1;

  const startRename = (id: PageId): void => {
    if (props.editor.readOnly) return;
    renameDraft = pageRenameDraft(props.editor, id);
    if (!renameDraft) return;
    setRenameValue(renameDraft.value);
    setRenameError("");
    setMenuFor(null);
    setRenaming(id);
  };

  const commitRename = (id: PageId, value: string): void => {
    if (renaming() !== id) {
      return;
    }
    const result = renameDraft?.commit(value);
    if (result === "unavailable") {
      setRenameError(
        "Page changed while renaming. Press Escape and reopen Rename to try again.",
      );
      return;
    }
    setRenaming(null);
  };

  const remove = (page: Page): void => {
    setMenuFor(null);
    if (!canDelete()) {
      return;
    }
    const count = props.editor.store.getPageElements(page.id).length;
    if (count > 0 && !window.confirm(DELETE_PROMPT(page, count))) {
      focusPage(page.id);
      return;
    }
    props.editor.deletePage(page.id);
    focusPage(props.editor.currentPageId);
  };

  const duplicate = (page: Page): void => {
    if (props.editor.readOnly) return;
    setMenuFor(null);
    props.editor.duplicatePage(page.id);
    focusPage(props.editor.currentPageId);
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
        target.closest(".nodetto-page-menu, .nodetto-page-menu-button")
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
      if (input.isConnected) {
        input.focus();
        input.select();
      }
    });
  };

  return (
    <div class="nodetto-page-tabs" ref={strip}>
      <div class="nodetto-page-tab-list" role="tablist" aria-label="Pages">
        <For each={pageIds()}>
          {(id) => (
            <Show when={pagesById().get(id)}>
              {(page) => (
                <div
                  class="nodetto-page-tab"
                  data-page-drag-target={id}
                  classList={{
                    "nodetto-active": currentId() === id,
                    "is-dragging": draggedPage() === id,
                    "is-drop-before":
                      drop()?.id === id && drop()?.side === "before",
                    "is-drop-after":
                      drop()?.id === id && drop()?.side === "after",
                  }}
                  role="presentation"
                >
                  <Show
                    when={renaming() === id}
                    fallback={
                      <button
                        type="button"
                        class="nodetto-page-tab-name"
                        role="tab"
                        data-page-tab={id}
                        aria-selected={currentId() === id}
                        tabindex={currentId() === id ? 0 : -1}
                        onKeyDown={(event) => tabKey(event, id)}
                        title={`${page().name} (${page().kind})${readOnly() ? "" : ". Double-click to rename"}`}
                        draggable={false}
                        onPointerDown={(event) => {
                          suppressClick = false;
                          if (event.button !== 0 || readOnly() || renaming())
                            return;
                          if (
                            drag.start(id, event.pointerId, {
                              x: event.clientX,
                              y: event.clientY,
                            })
                          ) {
                            setMenuFor(null);
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                          }
                        }}
                        onPointerMove={moveDrag}
                        onPointerUp={(event) => {
                          if (!drag.owns(event.pointerId)) return;
                          moveDrag(event);
                          const result = drag.finish(event.pointerId);
                          suppressClick = suppressClick || result.dragged;
                          setDraggedPage(null);
                          setDrop(null);
                          if (
                            event.currentTarget.hasPointerCapture(
                              event.pointerId,
                            )
                          )
                            event.currentTarget.releasePointerCapture(
                              event.pointerId,
                            );
                          if (result.reordered) focusPage(id);
                        }}
                        onPointerCancel={cancelDrag}
                        onLostPointerCapture={cancelDrag}
                        onClick={(event) => {
                          if (suppressClick) {
                            suppressClick = false;
                            event.preventDefault();
                            return;
                          }
                          props.editor.setCurrentPage(id);
                        }}
                        onDblClick={() => startRename(id)}
                      >
                        {page().name}
                      </button>
                    }
                  >
                    <input
                      class="nodetto-page-rename"
                      type="text"
                      value={renameValue()}
                      onInput={(event) =>
                        setRenameValue(event.currentTarget.value)
                      }
                      ref={focusInput}
                      aria-label="Page name"
                      aria-invalid={renameError() ? true : undefined}
                      aria-describedby={
                        renameError() ? renameErrorId : undefined
                      }
                      // Typing a tool letter here must insert the letter, never
                      // switch tools (design editor-ux 5).
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter" && !event.isComposing) {
                          event.preventDefault();
                          commitRename(id, event.currentTarget.value);
                          focusPage(id);
                        } else if (
                          event.key === "Escape" &&
                          !event.isComposing
                        ) {
                          event.preventDefault();
                          setRenaming(null);
                          focusPage(id);
                        }
                      }}
                      onBlur={(event) =>
                        commitRename(id, event.currentTarget.value)
                      }
                    />
                    <Show when={renameError()}>
                      <span id={renameErrorId} role="alert">
                        {renameError()}
                      </span>
                    </Show>
                  </Show>
                  <button
                    type="button"
                    class="nodetto-page-menu-button"
                    title="Page options"
                    disabled={readOnly()}
                    aria-label={`Options for ${page().name}`}
                    tabindex={currentId() === id ? 0 : -1}
                    aria-haspopup="menu"
                    aria-expanded={menuFor() === id}
                    onClick={() =>
                      menuFor() === id ? setMenuFor(null) : openMenu(id)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        openMenu(id);
                      }
                    }}
                  >
                    ...
                  </button>
                  <Show when={menuFor() === id}>
                    <div
                      class="nodetto-page-menu"
                      role="menu"
                      aria-label={`Options for ${page().name}`}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setMenuFor(null);
                          focusPage(id);
                          return;
                        }
                        if (event.key === "Tab") {
                          event.preventDefault();
                          setMenuFor(null);
                          if (event.shiftKey) focusPage(id);
                          else
                            strip
                              ?.querySelector<HTMLButtonElement>(
                                ".nodetto-page-add",
                              )
                              ?.focus();
                          return;
                        }
                        const items = Array.from(
                          event.currentTarget.querySelectorAll<HTMLButtonElement>(
                            "[role=menuitem]:not(:disabled)",
                          ),
                        );
                        const index = items.indexOf(
                          document.activeElement as HTMLButtonElement,
                        );
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? items.length - 1
                              : event.key === "ArrowDown"
                                ? (index + 1) % items.length
                                : event.key === "ArrowUp"
                                  ? (index + items.length - 1) % items.length
                                  : null;
                        if (next !== null) {
                          event.preventDefault();
                          items[next]?.focus();
                        }
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        tabindex="-1"
                        class="nodetto-menu-item"
                        title="Rename page"
                        onClick={() => startRename(id)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        tabindex="-1"
                        class="nodetto-menu-item"
                        title="Duplicate page and everything on it"
                        onClick={() => duplicate(page())}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        tabindex="-1"
                        class="nodetto-menu-item"
                        title={
                          canDelete()
                            ? "Delete page"
                            : "The last page cannot be deleted"
                        }
                        disabled={!canDelete()}
                        onClick={() => remove(page())}
                      >
                        Delete
                      </button>
                      <For each={[-1, 1] as const}>
                        {(delta) => (
                          <button
                            type="button"
                            role="menuitem"
                            tabindex="-1"
                            class="nodetto-menu-item"
                            disabled={
                              pages()[delta === -1 ? 0 : pages().length - 1]
                                ?.id === id
                            }
                            onClick={() => {
                              props.editor.reorderPage(id, delta);
                              setMenuFor(null);
                              focusPage(id);
                            }}
                          >
                            Move {delta === -1 ? "left" : "right"}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          )}
        </For>
      </div>
      <button
        type="button"
        class="nodetto-page-add"
        title="Add page"
        aria-label="Add page"
        disabled={readOnly()}
        onClick={() => {
          props.editor.createPage();
          focusPage(props.editor.currentPageId);
        }}
      >
        +
      </button>
    </div>
  );
}
