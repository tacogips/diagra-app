import type {
  Element,
  ElementId,
  ReviewCommentMessage,
  ReviewCommentSemantic,
} from "@diagra/ir";
import { getElementTypeDefinition } from "@diagra/ir";
import type { Vec } from "./geometry.ts";
import { newElementId } from "./ids.ts";
import type { Editor } from "./editor.ts";
import type { ViewportSize } from "./camera.ts";

export interface ReviewCommentThread {
  readonly element: Element<ReviewCommentSemantic>;
  readonly number: number;
}

export interface NewReviewMessage {
  readonly author: string;
  readonly body: string;
  readonly createdAt?: string;
  readonly id?: string;
}

function message(input: NewReviewMessage): ReviewCommentMessage | null {
  const author = input.author.trim();
  const body = input.body.trim();
  if (!author || !body) return null;
  return {
    id: input.id ?? newElementId(),
    author,
    body,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function isReviewComment(
  element: Element | undefined,
): element is Element<ReviewCommentSemantic> {
  return element?.type === "review.comment";
}

/** Threads on the current page, numbered by their stable document order. */
export function reviewComments(
  editor: Editor,
  pageId = editor.currentPageId,
): readonly ReviewCommentThread[] {
  return editor.store
    .getPageElements(pageId)
    .filter(isReviewComment)
    .map((element, index) => ({ element, number: index + 1 }));
}

/** Navigate locally to a thread; no document commands or shared selection. */
export function focusReviewComment(
  editor: Editor,
  id: ElementId,
  viewport: ViewportSize,
): boolean {
  const element = editor.store.get(id);
  if (
    !isReviewComment(element) ||
    !editor.store.getPage(element.page) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return false;
  editor.setCurrentPage(element.page);
  const { z } = editor.camera.get();
  editor.camera.set({
    x: viewport.width / (2 * z) - (element.visual.x ?? 0),
    y: viewport.height / (2 * z) - (element.visual.y ?? 0),
    z,
  });
  return true;
}

export function createReviewComment(
  editor: Editor,
  at: Vec,
  input: NewReviewMessage,
  target?: ElementId,
): ElementId | null {
  const first = message(input);
  if (!first || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const linked = target ? editor.store.get(target) : undefined;
  const contextualTarget =
    linked?.page === editor.currentPageId &&
    getElementTypeDefinition(linked.type)?.category !== "resource"
      ? linked.id
      : undefined;
  return editor.createElement("review.comment", {
    semantic: {
      ...(contextualTarget ? { target: contextualTarget } : {}),
      messages: [first],
    },
    visual: { x: at.x, y: at.y },
  });
}

export function moveReviewComment(
  editor: Editor,
  id: ElementId,
  point: Vec,
): boolean {
  const element = editor.store.get(id);
  if (
    !isReviewComment(element) ||
    element.semantic.resolved ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    editor.createShapeContext().isLocked?.(id) ||
    ((element.visual.x ?? 0) === point.x && (element.visual.y ?? 0) === point.y)
  )
    return false;
  editor.apply([
    {
      type: "updateVisual",
      id,
      visual: { x: point.x, y: point.y },
    },
  ]);
  return true;
}

export function replyToReviewComment(
  editor: Editor,
  id: ElementId,
  input: NewReviewMessage,
): boolean {
  const element = editor.store.get(id);
  const reply = message(input);
  if (!isReviewComment(element) || !reply) return false;
  const semantic = element.semantic;
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: { ...semantic, messages: [...semantic.messages, reply] },
    },
  ]);
  return true;
}

export function setReviewCommentResolved(
  editor: Editor,
  id: ElementId,
  resolved: boolean,
): boolean {
  const element = editor.store.get(id);
  if (
    !isReviewComment(element) ||
    Boolean(element.semantic.resolved) === resolved
  )
    return false;
  const { resolved: _resolved, ...rest } = element.semantic;
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: resolved ? { ...rest, resolved: true } : rest,
    },
  ]);
  return true;
}
