// Copy, cut, paste and duplicate, as data.
//
// A copied fragment is a detached snapshot: structurally cloned, so nothing
// the user does to the document afterwards can reach into it, and trimmed by
// `selfContained` so it never carries a reference to an element that was
// left behind. Pasting it is a pure function of the fragment plus an id
// source, an index source and an offset — the editor supplies those three
// and applies the resulting commands as one batch.
//
// Ids are minted before any payload is rewritten, so an edge and both of its
// endpoints see the same mapping however they are ordered in the fragment.

import type {
  Element,
  ElementId,
  FractionalIndex,
  FrameSemantic,
  PageId,
  Visual,
} from "@diagra/ir";
import type { Command } from "./commands.ts";
import { compareFractional } from "./fractional.ts";
import type { Vec } from "./geometry.ts";
import type { IdSource } from "./ids.ts";
import { remapReferences, selfContained } from "./references.ts";
import type { Store } from "./store.ts";

/** Page units a pasted or duplicated fragment is nudged by, per paste. */
export const PASTE_OFFSET = 16;

export interface ClipboardPayload {
  readonly elements: readonly Element[];
}

/**
 * Snapshot `ids` out of the store, bottom to top, with every reference that
 * pointed outside the set resolved the way a delete would resolve it.
 */
export function copyElements(
  store: Store,
  ids: Iterable<ElementId>,
  options: {
    readonly preserveColorTokens?: boolean;
    readonly preserveNumberTokens?: boolean;
    readonly preserveTextStyles?: boolean;
  } = {},
): ClipboardPayload {
  const seen = new Set<ElementId>();
  const present: Element[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const element = store.get(id);
    if (element) {
      present.push(element);
    }
  }
  present.sort(
    (left, right) =>
      compareFractional(left.index, right.index) ||
      compareFractional(left.id, right.id),
  );
  return {
    elements: structuredClone(
      selfContained(present).map((element) => {
        const { colorTokens, numberTokens, textStyle, ...rest } =
          element.visual;
        if (!colorTokens && !numberTokens && !textStyle) return element;
        const colors = Object.fromEntries(
          Object.entries(colorTokens ?? {}).filter(
            ([, id]) => seen.has(id) || options.preserveColorTokens === true,
          ),
        );
        const numbers = Object.fromEntries(
          Object.entries(numberTokens ?? {}).filter(
            ([, id]) => seen.has(id) || options.preserveNumberTokens === true,
          ),
        );
        const typography =
          textStyle &&
          (seen.has(textStyle) || options.preserveTextStyles === true)
            ? textStyle
            : undefined;
        return {
          ...element,
          visual: {
            ...rest,
            ...(Object.keys(colors).length ? { colorTokens: colors } : {}),
            ...(Object.keys(numbers).length ? { numberTokens: numbers } : {}),
            ...(typography ? { textStyle: typography } : {}),
          },
        };
      }),
    ),
  };
}

/** Same-document copies retain valid shared resources and component sources. */
export function copyElementsInDocument(
  store: Store,
  ids: Iterable<ElementId>,
): ClipboardPayload {
  const copied = copyElements(store, ids, {
    preserveColorTokens: true,
    preserveNumberTokens: true,
    preserveTextStyles: true,
  });
  const copiedIds = new Set(copied.elements.map((element) => element.id));
  return {
    elements: copied.elements.map((element) => {
      if (element.type !== "frame") return element;
      const original = store.get(element.id)?.semantic as FrameSemantic;
      const sourceId = original.instanceOf ?? original.responsiveSource;
      const source = sourceId ? store.get(sourceId) : undefined;
      if (
        source?.type !== "frame" ||
        (original.instanceOf && !(source.semantic as FrameSemantic).component)
      )
        return element;
      return {
        ...element,
        semantic: {
          ...(element.semantic as FrameSemantic),
          ...(original.instanceOf
            ? { instanceOf: original.instanceOf }
            : { responsiveSource: original.responsiveSource }),
          ...(original.instanceBindings
            ? {
                instanceBindings: structuredClone(
                  original.instanceBindings.filter(
                    (binding) =>
                      binding.target !== undefined &&
                      binding.source !== undefined &&
                      copiedIds.has(binding.target) &&
                      store.get(binding.source) !== undefined,
                  ),
                ),
              }
            : {}),
        },
      };
    }),
  };
}

export interface PasteOptions {
  readonly page: PageId;
  readonly idSource: IdSource;
  /** Called once per element, in payload order, for the new z-order key. */
  readonly nextIndex: () => FractionalIndex;
  readonly offset: Vec;
}

export interface PastePlan {
  readonly commands: readonly Command[];
  /** New ids, in payload order; the caller selects them. */
  readonly ids: readonly ElementId[];
  readonly mapping: ReadonlyMap<ElementId, ElementId>;
}

/** Positioned elements move; derived-layout ones have nothing to offset. */
function offsetVisual(visual: Visual, offset: Vec): Visual {
  if (visual.x === undefined || visual.y === undefined) {
    return visual;
  }
  return { ...visual, x: visual.x + offset.x, y: visual.y + offset.y };
}

export function planPaste(
  payload: ClipboardPayload,
  options: PasteOptions,
): PastePlan {
  const mapping = new Map<ElementId, ElementId>();
  for (const element of payload.elements) {
    mapping.set(element.id, options.idSource());
  }

  const commands: Command[] = [];
  const ids: ElementId[] = [];
  for (const element of payload.elements) {
    const id = mapping.get(element.id) as ElementId;
    // A second paste of the same payload must not share structure with the
    // first, so the source is cloned before anything is rewritten.
    const source = structuredClone(element) as Element;
    const created: Element = {
      ...source,
      id,
      page: options.page,
      index: options.nextIndex(),
      semantic: remapReferences(source.type, source.semantic, mapping),
      visual: offsetVisual(
        {
          ...source.visual,
          ...(source.visual.colorTokens
            ? {
                colorTokens: Object.fromEntries(
                  Object.entries(source.visual.colorTokens).map(
                    ([field, target]) => [field, mapping.get(target) ?? target],
                  ),
                ),
              }
            : {}),
          ...(source.visual.numberTokens
            ? {
                numberTokens: Object.fromEntries(
                  Object.entries(source.visual.numberTokens).map(
                    ([field, target]) => [field, mapping.get(target) ?? target],
                  ),
                ),
              }
            : {}),
          ...(source.visual.textStyle
            ? {
                textStyle:
                  mapping.get(source.visual.textStyle) ??
                  source.visual.textStyle,
              }
            : {}),
        },
        options.offset,
      ),
    };
    commands.push({ type: "createElement", element: created });
    ids.push(id);
  }
  return { commands, ids, mapping };
}

/**
 * The in-memory clipboard. Deliberately not the system clipboard: the OS one
 * is asynchronous and permission-gated, and phase 1 only has to move a
 * fragment within the running editor.
 */
export class Clipboard {
  private payload: ClipboardPayload | null = null;
  /**
   * How many times the current payload has been pasted. Each paste lands one
   * offset further out, so pasting three times leaves three visible copies
   * instead of one stack.
   */
  pasteGeneration = 0;

  set(payload: ClipboardPayload): void {
    this.payload = payload;
    this.pasteGeneration = 0;
  }

  get(): ClipboardPayload | null {
    return this.payload;
  }

  get isEmpty(): boolean {
    return this.payload === null || this.payload.elements.length === 0;
  }
}
