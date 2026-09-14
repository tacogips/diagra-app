import {
  type Editor,
  type ViewportSize,
  layerRows,
  layerName,
  selectLayerRow,
  selectLayerSearchMatches,
} from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import {
  createMemo,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import { ComponentLibrary } from "./ComponentLibrary.tsx";
import { ColorTokens } from "./ColorTokens.tsx";
import { NumberTokens } from "./NumberTokens.tsx";
import { ReviewComments } from "./ReviewComments.tsx";
import { TypographyStyles } from "./TypographyStyles.tsx";
import { LayerRenameInput } from "./LayerRenameInput.tsx";
import { layerNavigation } from "./layer-keyboard.ts";
import { HelpHint } from "./HelpHint.tsx";

export function Layers(props: {
  readonly editor: Editor;
  readonly viewport?: ViewportSize;
  readonly commentAuthor?: string;
  readonly commentPlacementActive?: boolean;
  readonly onPlaceComment?: (
    input: {
      readonly author: string;
      readonly body: string;
    },
    onPlaced: () => void,
  ) => void;
  readonly onCancelCommentPlacement?: () => void;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const [query, setQuery] = createSignal("");
  const [allPages, setAllPages] = createSignal(false);
  const [renaming, setRenaming] = createSignal<ElementId>();
  createEffect(() => {
    if (readOnly()) setRenaming(undefined);
  });
  let selectionAnchor: ElementId | undefined;
  let searchInput: HTMLInputElement | undefined;
  const nameButtons = new Map<ElementId, HTMLButtonElement>();
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<ElementId>>(
    new Set(),
  );
  const rows = createMemo(() => {
    signals.rev();
    if (allPages())
      return props.editor.store
        .listPages()
        .flatMap((page) =>
          layerRows(props.editor, collapsed(), query(), page.id),
        );
    return layerRows(props.editor, collapsed(), query());
  });
  const toggle = (id: ElementId): void => {
    const next = new Set(collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };
  const searchMatches = createMemo(() => {
    signals.rev();
    if (!query().trim()) return [];
    const context = props.editor.createShapeContext();
    return rows().filter(
      (row) =>
        row.matched &&
        row.element.page === props.editor.currentPageId &&
        !context.isLocked?.(row.element.id),
    );
  });
  const rowMap = createMemo(
    () => new Map(rows().map((row) => [row.element.id, row])),
  );
  return (
    <nav class="diagra-layers" aria-label="Layers">
      <details class="diagra-navigation-group">
        <summary>Components</summary>
        <ComponentLibrary editor={props.editor} />
      </details>
      <details class="diagra-navigation-group">
        <summary>Styles and tokens</summary>
        <fieldset
          disabled={readOnly()}
          style={{ border: "none", margin: 0, padding: 0, "min-width": 0 }}
        >
          <ColorTokens editor={props.editor} />
          <NumberTokens editor={props.editor} />
          <TypographyStyles editor={props.editor} />
        </fieldset>
      </details>
      <details
        class="diagra-navigation-group"
        open={props.commentPlacementActive}
      >
        <summary>Comments</summary>
        <ReviewComments
          editor={props.editor}
          viewport={props.viewport}
          author={props.commentAuthor}
          commentPlacementActive={props.commentPlacementActive}
          onPlaceComment={props.onPlaceComment}
          onCancelCommentPlacement={props.onCancelCommentPlacement}
        />
      </details>
      <h2>
        Layers{" "}
        <HelpHint
          text={`Shift-click selects a range; Ctrl/Cmd-click toggles a layer. ${readOnly() ? "" : "Double-click a name or press F2 to rename. "}Use Up/Down or Home/End to select, Shift to extend, and Left/Right to navigate the hierarchy.`}
        />
      </h2>
      <label>
        <input
          type="checkbox"
          checked={allPages()}
          onChange={(event) => setAllPages(event.currentTarget.checked)}
        />
        All pages
      </label>
      <input
        type="search"
        ref={searchInput}
        aria-label="Search layers"
        placeholder="Search layers"
        title="Search by name, content, column or type"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        on:keydown={(event) => event.stopPropagation()}
        on:keyup={(event) => event.stopPropagation()}
        style={{
          width: "calc(100% - 16px)",
          margin: "0 8px",
          "box-sizing": "border-box",
        }}
      />
      <Show when={query().trim()}>
        <button
          type="button"
          disabled={!searchMatches().length}
          title="Select editable search hits on the current page, excluding context-only ancestors"
          onClick={() => {
            selectLayerSearchMatches(props.editor, query());
            selectionAnchor = undefined;
          }}
        >
          Select matches on this page ({searchMatches().length})
        </button>
      </Show>
      <For each={[...rowMap().keys()]}>
        {(id) => (
          <Show when={rowMap().get(id)}>
            {(row) => {
              let nameButton: HTMLButtonElement | undefined;
              onCleanup(() => {
                nameButtons.delete(id);
                if (renaming() === id) setRenaming(undefined);
              });
              const startRename = (): void => {
                if (props.editor.readOnly) return;
                if (!props.editor.createShapeContext().isLocked?.(id))
                  setRenaming(id);
              };
              return (
                <div
                  class="diagra-layer-row"
                  style={{ "padding-left": `${8 + row().depth * 14}px` }}
                >
                  <Show
                    when={row().hasChildren}
                    fallback={<span class="diagra-layer-spacer" />}
                  >
                    <button
                      type="button"
                      aria-label={`Toggle ${layerName(row().element)} contents`}
                      aria-expanded={
                        Boolean(query().trim()) || !collapsed().has(id)
                      }
                      disabled={Boolean(query().trim())}
                      onClick={() => toggle(id)}
                    >
                      {!query().trim() && collapsed().has(id) ? ">" : "v"}
                    </button>
                  </Show>
                  <Show
                    when={renaming() !== id}
                    fallback={
                      <LayerRenameInput
                        editor={props.editor}
                        id={id}
                        onDone={(restoreFocus) => {
                          setRenaming(undefined);
                          if (restoreFocus)
                            queueMicrotask(() => {
                              if (nameButton?.isConnected) nameButton.focus();
                              else searchInput?.focus();
                            });
                        }}
                      />
                    }
                  >
                    <button
                      ref={(button) => {
                        nameButton = button;
                        nameButtons.set(id, button);
                      }}
                      type="button"
                      class="diagra-layer-name"
                      aria-pressed={signals.selection().has(id)}
                      title={
                        row().matchDetail ??
                        `${layerName(row().element)} (${row().element.type})`
                      }
                      onClick={(event) => {
                        selectionAnchor = selectLayerRow(
                          props.editor,
                          rows(),
                          id,
                          selectionAnchor,
                          {
                            range: event.shiftKey,
                            additive: event.ctrlKey || event.metaKey,
                          },
                        );
                      }}
                      onDblClick={startRename}
                      on:keydown={(event) => {
                        if (
                          event.isComposing ||
                          event.keyCode === 229 ||
                          event.ctrlKey ||
                          event.metaKey ||
                          event.altKey
                        )
                          return;
                        if (event.key === "F2") {
                          event.preventDefault();
                          event.stopPropagation();
                          startRename();
                          return;
                        }
                        const navigation = layerNavigation(
                          rows(),
                          id,
                          event.key,
                          collapsed(),
                          Boolean(query().trim()),
                        );
                        if (!navigation) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (navigation.action !== "select")
                          toggle(navigation.id);
                        else
                          selectionAnchor = selectLayerRow(
                            props.editor,
                            rows(),
                            navigation.id,
                            selectionAnchor,
                            { range: event.shiftKey },
                          );
                        queueMicrotask(() => {
                          const button = nameButtons.get(navigation.id);
                          if (!button?.isConnected) return;
                          button.focus();
                          button.scrollIntoView({
                            block: "nearest",
                            inline: "nearest",
                          });
                        });
                      }}
                    >
                      {layerName(row().element)}
                      <Show when={allPages()}>
                        <small
                          style={{ display: "block", "font-weight": "normal" }}
                        >
                          {props.editor.store.getPage(row().element.page)?.name}
                        </small>
                      </Show>
                      <Show when={row().matchDetail}>
                        <small
                          style={{
                            display: "block",
                            "font-weight": "normal",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                          }}
                        >
                          {row().matchDetail}
                        </small>
                      </Show>
                    </button>
                  </Show>
                  <Show when={props.viewport}>
                    <button
                      type="button"
                      class="diagra-layer-icon"
                      aria-label={`Locate ${layerName(row().element)} on canvas`}
                      title="Select this layer and fit its visible artwork"
                      onClick={() => {
                        if (
                          !props.viewport ||
                          props.viewport.width <= 0 ||
                          props.viewport.height <= 0
                        )
                          return;
                        props.editor.setCurrentPage(row().element.page);
                        props.editor.selection.set([id]);
                        selectionAnchor = id;
                        props.editor.zoomToSelection(props.viewport);
                      }}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <circle cx="10" cy="10" r="5" />
                        <path d="M10 2v4m0 8v4M2 10h4m8 0h4" />
                      </svg>
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="diagra-layer-icon"
                    title={
                      row().element.visual.hidden ? "Show layer" : "Hide layer"
                    }
                    aria-label={`${row().element.visual.hidden ? "Show" : "Hide"} ${layerName(row().element)}`}
                    aria-pressed={row().element.visual.hidden === true}
                    disabled={readOnly()}
                    onClick={() =>
                      props.editor.apply([
                        {
                          type: "updateVisual",
                          id,
                          visual: { hidden: !row().element.visual.hidden },
                        },
                      ])
                    }
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
                      <circle cx="10" cy="10" r="2" />
                      <Show when={row().element.visual.hidden}>
                        <path d="m3 3 14 14" />
                      </Show>
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="diagra-layer-icon"
                    title={
                      row().element.visual.locked
                        ? "Unlock layer"
                        : "Lock layer"
                    }
                    aria-label={`${row().element.visual.locked ? "Unlock" : "Lock"} ${layerName(row().element)}`}
                    aria-pressed={row().element.visual.locked === true}
                    disabled={readOnly()}
                    onClick={() =>
                      props.editor.apply([
                        {
                          type: "updateVisual",
                          id,
                          visual: { locked: !row().element.visual.locked },
                        },
                      ])
                    }
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <rect x="5" y="9" width="10" height="8" />
                      <path
                        d={
                          row().element.visual.locked
                            ? "M7 9V6a3 3 0 0 1 6 0v3"
                            : "M7 9V6a3 3 0 0 1 6 0"
                        }
                      />
                      <path d="M10 12v2" />
                    </svg>
                  </button>
                </div>
              );
            }}
          </Show>
        )}
      </For>
      <Show when={rows().length === 0}>
        <p>
          {query().trim()
            ? allPages()
              ? "No matching layers in this document."
              : "No matching layers on this page."
            : "No layers"}
        </p>
      </Show>
      <div class="diagra-layer-actions">
        <button
          type="button"
          onClick={() => props.editor.reorderSelection("front")}
          disabled={readOnly()}
        >
          Bring to front
        </button>
        <button
          type="button"
          onClick={() => props.editor.reorderSelection("back")}
          disabled={readOnly()}
        >
          Send to back
        </button>
      </div>
    </nav>
  );
}
