import type {
  Element,
  ElementId,
  GuideAxis,
  PageGuideSemantic,
  PageId,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { newElementId } from "./ids.ts";

export const DEFAULT_GUIDE_COLOR = "#ec4899";

export interface PageGuide {
  readonly id: ElementId;
  readonly page: PageId;
  readonly axis: GuideAxis;
  readonly position: number;
  readonly color: string;
  readonly hidden: boolean;
  readonly locked: boolean;
}

export function readPageGuide(element: Element): PageGuide | null {
  if (element.type !== "design.guide") return null;
  const semantic = element.semantic as Partial<PageGuideSemantic> | null;
  if (
    (semantic?.axis !== "x" && semantic?.axis !== "y") ||
    !Number.isFinite(semantic.position)
  )
    return null;
  return {
    id: element.id,
    page: element.page,
    axis: semantic.axis,
    position: semantic.position as number,
    color:
      typeof semantic.color === "string" &&
      /^#[\da-f]{6}$/i.test(semantic.color)
        ? semantic.color
        : DEFAULT_GUIDE_COLOR,
    hidden: semantic.hidden === true,
    locked: semantic.locked === true,
  };
}

export function pageGuides(
  editor: Editor,
  pageId: PageId,
): readonly PageGuide[] {
  return editor.store.getPageElements(pageId).flatMap((element) => {
    const guide = readPageGuide(element);
    return guide ? [guide] : [];
  });
}

export function addPageGuide(
  editor: Editor,
  pageId: PageId,
  axis: GuideAxis,
  position: number,
  id: ElementId = newElementId(),
): ElementId | null {
  if (
    !editor.store.getPage(pageId) ||
    (axis !== "x" && axis !== "y") ||
    !Number.isFinite(position)
  )
    return null;
  const element = editor.buildElement("design.guide", {
    id,
    page: pageId,
    semantic: { axis, position },
  });
  editor.apply([{ type: "createElement", element }]);
  return element.id;
}

export type PageGuidePatch = Partial<
  Pick<PageGuideSemantic, "axis" | "position" | "color" | "hidden" | "locked">
>;

export function updatePageGuide(
  editor: Editor,
  id: ElementId,
  patch: PageGuidePatch,
): boolean {
  if (
    (patch.axis !== undefined && patch.axis !== "x" && patch.axis !== "y") ||
    (patch.position !== undefined && !Number.isFinite(patch.position)) ||
    (patch.color !== undefined && !/^#[\da-f]{6}$/i.test(patch.color))
  )
    return false;
  const element = editor.store.get(id);
  const current = element ? readPageGuide(element) : null;
  if (!element || !current || (current.locked && patch.locked !== false))
    return false;
  const semantic = element.semantic as PageGuideSemantic;
  let next: PageGuideSemantic = {
    ...semantic,
    ...(patch.axis === undefined ? {} : { axis: patch.axis }),
    ...(patch.position === undefined ? {} : { position: patch.position }),
    ...(patch.color === undefined ? {} : { color: patch.color }),
    ...(patch.hidden ? { hidden: true } : {}),
    ...(patch.locked ? { locked: true } : {}),
  };
  if (patch.hidden === false) {
    const { hidden: _hidden, ...rest } = next;
    next = rest;
  }
  if (patch.locked === false) {
    const { locked: _locked, ...rest } = next;
    next = rest;
  }
  if (JSON.stringify(semantic) === JSON.stringify(next)) return false;
  editor.apply([{ type: "updateSemantic", id, semantic: next }]);
  return true;
}

export function removePageGuide(editor: Editor, id: ElementId): boolean {
  const element = editor.store.get(id);
  const guide = element ? readPageGuide(element) : null;
  if (!guide || guide.locked) return false;
  editor.apply([{ type: "deleteElements", ids: [id] }]);
  return true;
}
