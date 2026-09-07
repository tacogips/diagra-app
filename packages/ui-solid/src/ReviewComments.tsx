import {
  createReviewComment,
  focusReviewComment,
  type ViewportSize,
  type Editor,
  layerName,
  ReviewCommentPinDrag,
  type ReviewCommentPinPreview,
  replyToReviewComment,
  reviewComments,
  setReviewCommentResolved,
} from "@diagra/core";
import type { ElementId, ReviewCommentSemantic } from "@diagra/ir";
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

interface CommentProps {
  readonly editor: Editor;
  readonly viewport?: ViewportSize;
  readonly author?: string;
  readonly commentPlacementActive?: boolean;
  readonly onPlaceComment?: (
    input: {
      readonly author: string;
      readonly body: string;
    },
    onPlaced: () => void,
  ) => void;
  readonly onCancelCommentPlacement?: () => void;
}

function authorName(author: string | undefined): string {
  return author?.trim() || "Anonymous";
}

function messageTime(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function threadTarget(editor: Editor, semantic: ReviewCommentSemantic): string {
  const target = semantic.target
    ? editor.store.get(semantic.target)
    : undefined;
  return target ? layerName(target) : "Canvas";
}

export function ReviewComments(props: CommentProps): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const [body, setBody] = createSignal("");
  const [replies, setReplies] = createSignal<Readonly<Record<string, string>>>(
    {},
  );
  const [showResolved, setShowResolved] = createSignal(false);
  const [allPages, setAllPages] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const threads = createMemo(() => {
    signals.rev();
    const list = allPages()
      ? props.editor.store
          .listPages()
          .flatMap((page) => reviewComments(props.editor, page.id))
      : reviewComments(props.editor);
    const needle = query().trim().toLocaleLowerCase();
    return list.filter(
      ({ element }) =>
        (showResolved() || !element.semantic.resolved) &&
        (!needle ||
          [
            threadTarget(props.editor, element.semantic),
            props.editor.store.getPage(element.page)?.name ?? "",
            ...element.semantic.messages.flatMap((message) => [
              message.author,
              message.body,
            ]),
          ].some((text) => text.toLocaleLowerCase().includes(needle))),
    );
  });
  const add = (): void => {
    if (props.editor.readOnly) return;
    const bounds = props.editor.getSelectionBounds();
    const point = bounds
      ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      : props.editor.camera.screenToPage({ x: 320, y: 240 });
    const [selected] = props.editor.selection.ids();
    const target = props.editor.selection.size === 1 ? selected : undefined;
    if (
      createReviewComment(
        props.editor,
        point,
        { author: authorName(props.author), body: body() },
        target,
      )
    )
      setBody("");
  };
  const place = (): void => {
    if (props.editor.readOnly) return;
    const draft = { author: authorName(props.author), body: body().trim() };
    if (!draft.body || !props.onPlaceComment) return;
    props.onPlaceComment(draft, () => setBody(""));
  };
  return (
    <section class="diagra-review-comments" aria-label="Review comments">
      <h2>Comments</h2>
      <input
        type="search"
        aria-label="Search comments"
        placeholder="Search feedback, authors or pages"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        on:keydown={(event) => event.stopPropagation()}
        on:keyup={(event) => event.stopPropagation()}
      />
      <label>
        <input
          type="checkbox"
          checked={allPages()}
          onChange={(event) => setAllPages(event.currentTarget.checked)}
        />
        All pages
      </label>
      <p>Anchor feedback to the selection, or to the visible canvas.</p>
      <textarea
        aria-label="New comment"
        placeholder="Leave design feedback…"
        value={body()}
        disabled={readOnly() || props.commentPlacementActive}
        onInput={(event) => setBody(event.currentTarget.value)}
        on:keydown={(event) => event.stopPropagation()}
        on:keyup={(event) => event.stopPropagation()}
      />
      <div class="diagra-comment-actions">
        <button
          type="button"
          disabled={
            readOnly() || !body().trim() || props.commentPlacementActive
          }
          onClick={add}
        >
          Add comment
        </button>
        <Show when={props.onPlaceComment}>
          <button
            type="button"
            disabled={
              readOnly() || !body().trim() || props.commentPlacementActive
            }
            onClick={place}
          >
            Place on canvas
          </button>
        </Show>
        <label>
          <input
            type="checkbox"
            checked={showResolved()}
            onChange={(event) => setShowResolved(event.currentTarget.checked)}
          />
          Resolved
        </label>
      </div>
      <Show when={props.commentPlacementActive}>
        <div class="diagra-comment-placement" role="status">
          <span>Click the canvas to place the comment.</span>
          <button type="button" onClick={props.onCancelCommentPlacement}>
            Cancel
          </button>
        </div>
      </Show>
      <For each={threads()}>
        {(thread) => {
          const semantic = () => thread.element.semantic;
          const reply = () => replies()[thread.element.id] ?? "";
          return (
            <article
              class="diagra-comment-thread"
              classList={{ "is-resolved": semantic().resolved === true }}
            >
              <header>
                <strong>#{thread.number}</strong>
                <Show when={allPages()}>
                  <span>
                    {props.editor.store.getPage(thread.element.page)?.name}
                  </span>
                </Show>
                <span>{threadTarget(props.editor, semantic())}</span>
                <button
                  type="button"
                  disabled={readOnly()}
                  onClick={() =>
                    setReviewCommentResolved(
                      props.editor,
                      thread.element.id,
                      !semantic().resolved,
                    )
                  }
                >
                  {semantic().resolved ? "Reopen" : "Resolve"}
                </button>
              </header>
              <For each={semantic().messages}>
                {(message) => (
                  <div class="diagra-comment-message">
                    <strong>{message.author}</strong>
                    <time dateTime={message.createdAt}>
                      {messageTime(message.createdAt)}
                    </time>
                    <p>{message.body}</p>
                  </div>
                )}
              </For>
              <textarea
                aria-label={`Reply to comment ${thread.number} on ${props.editor.store.getPage(thread.element.page)?.name ?? "page"}`}
                placeholder="Reply…"
                value={reply()}
                disabled={readOnly()}
                onInput={(event) =>
                  setReplies({
                    ...replies(),
                    [thread.element.id]: event.currentTarget.value,
                  })
                }
                on:keydown={(event) => event.stopPropagation()}
                on:keyup={(event) => event.stopPropagation()}
              />
              <div class="diagra-comment-actions">
                <Show when={props.viewport}>
                  <button
                    type="button"
                    onClick={() => {
                      if (props.viewport)
                        focusReviewComment(
                          props.editor,
                          thread.element.id,
                          props.viewport,
                        );
                    }}
                  >
                    Show on canvas
                  </button>
                </Show>
                <button
                  type="button"
                  disabled={readOnly() || !reply().trim()}
                  onClick={() => {
                    if (
                      replyToReviewComment(props.editor, thread.element.id, {
                        author: authorName(props.author),
                        body: reply(),
                      })
                    )
                      setReplies({ ...replies(), [thread.element.id]: "" });
                  }}
                >
                  Reply
                </button>
                <button
                  type="button"
                  disabled={readOnly()}
                  onClick={() =>
                    props.editor.deleteElements([thread.element.id])
                  }
                >
                  Delete
                </button>
              </div>
            </article>
          );
        }}
      </For>
      <Show when={threads().length === 0}>
        <p>
          No matching {showResolved() ? "comments" : "open comments"}{" "}
          {allPages() ? "in this document" : "on this page"}.
        </p>
      </Show>
    </section>
  );
}

export function ReviewCommentPins(
  props: CommentProps & { readonly onOpen?: (id: ElementId) => void },
): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const [open, setOpen] = createSignal<ElementId | null>(null);
  const [preview, setPreview] = createSignal<ReviewCommentPinPreview | null>(
    null,
  );
  let suppressOpen = false;
  const drag = new ReviewCommentPinDrag(props.editor, setPreview);
  const cancel = (): void => drag.cancel();
  createEffect(() => {
    if (readOnly()) cancel();
  });
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") cancel();
  };
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
  onCleanup(() => {
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    drag.dispose();
  });
  const threads = createMemo(() => {
    signals.rev();
    return reviewComments(props.editor).filter(
      ({ element }) => !element.semantic.resolved,
    );
  });
  return (
    <div class="diagra-comment-pins" aria-label="Open comment pins">
      <For each={threads()}>
        {(thread) => {
          const point = () =>
            preview()?.id === thread.element.id
              ? preview()?.point
              : {
                  x: thread.element.visual.x ?? 0,
                  y: thread.element.visual.y ?? 0,
                };
          return (
            <div
              class="diagra-comment-pin-wrap"
              style={{
                left: `${point()?.x ?? 0}px`,
                top: `${point()?.y ?? 0}px`,
              }}
            >
              <button
                type="button"
                class="diagra-comment-pin"
                classList={{
                  "is-dragging": preview()?.id === thread.element.id,
                }}
                title={`${readOnly() ? "" : "Drag to reposition. "}${thread.element.semantic.messages[0]?.author ?? "Comment"}: ${thread.element.semantic.messages[0]?.body ?? ""}`}
                aria-label={`Comment ${thread.number}`}
                aria-expanded={open() === thread.element.id}
                onPointerDown={(event) => {
                  if (props.editor.readOnly) {
                    event.stopPropagation();
                    return;
                  }
                  if (
                    event.button !== 0 ||
                    !drag.start(
                      event.pointerId,
                      thread.element.id,
                      { x: event.clientX, y: event.clientY },
                      props.editor.camera.get().z,
                    )
                  )
                    return;
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  event.stopPropagation();
                  drag.move(event.pointerId, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  suppressOpen = drag.finish(event.pointerId, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onPointerCancel={(event) => {
                  event.stopPropagation();
                  drag.cancel(event.pointerId);
                }}
                onLostPointerCapture={(event) => drag.cancel(event.pointerId)}
                onClick={() => {
                  if (suppressOpen) {
                    suppressOpen = false;
                    return;
                  }
                  setOpen(
                    open() === thread.element.id ? null : thread.element.id,
                  );
                  props.onOpen?.(thread.element.id);
                }}
              >
                {thread.number}
              </button>
              <Show when={open() === thread.element.id}>
                <aside class="diagra-comment-popover">
                  <strong>Comment #{thread.number}</strong>
                  <span>
                    {threadTarget(props.editor, thread.element.semantic)}
                  </span>
                  <For each={thread.element.semantic.messages}>
                    {(message) => (
                      <p>
                        <strong>{message.author}:</strong> {message.body}
                      </p>
                    )}
                  </For>
                  <button
                    type="button"
                    disabled={readOnly()}
                    onClick={() => {
                      setReviewCommentResolved(
                        props.editor,
                        thread.element.id,
                        true,
                      );
                      setOpen(null);
                    }}
                  >
                    Resolve
                  </button>
                </aside>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
