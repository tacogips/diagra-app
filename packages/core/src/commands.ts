// Commands: the only way to mutate the document.
//
// A command batch is atomic. Everything is validated against a private
// working copy first; if any check fails the store is never touched and a
// {@link CommandError} carries the issues out. On success the store sees one
// commit and subscribers see one {@link StoreDiff}.
//
// Deletes are expanded here, not by callers: the `@diagra/ir` registry says
// whether an element that points at a deleted element dies with it
// (`cascade`, e.g. a relation without its table) or merely loses the
// reference (`detach`, e.g. a group losing a member). The expansion is
// transitive, so cascades of cascades resolve in one pass.

import {
  type Element,
  type ElementId,
  type ElementReference,
  error,
  type FractionalIndex,
  getElementTypeDefinition,
  hasErrors,
  isPlainObject,
  type ValidationIssue,
  type Visual,
} from "@diagra/ir";
import type { Store } from "./store.ts";

export type Command =
  | { readonly type: "createElement"; readonly element: Element }
  | { readonly type: "deleteElements"; readonly ids: readonly ElementId[] }
  | {
      readonly type: "updateVisual";
      readonly id: ElementId;
      readonly visual: Partial<Visual>;
    }
  /**
   * Full replacement of the visual payload. This exists so `updateVisual`
   * can be inverted exactly: a merge that *introduces* a key (resizing a
   * shape that had no explicit width) cannot be undone by another merge.
   */
  | {
      readonly type: "replaceVisual";
      readonly id: ElementId;
      readonly visual: Visual;
    }
  | {
      readonly type: "updateSemantic";
      readonly id: ElementId;
      readonly semantic: unknown;
    }
  | {
      readonly type: "reorder";
      readonly id: ElementId;
      readonly index: FractionalIndex;
    };

export class CommandError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], message: string) {
    super(message);
    this.name = "CommandError";
    this.issues = issues;
  }
}

/** Inverse and replay command lists for one applied batch. */
export interface CommandResult {
  readonly undo: readonly Command[];
  readonly redo: readonly Command[];
}

const ARRAY_SEGMENT = /^(.+)\[(\d+)\]$/;

function referencesOf(element: Element): readonly ElementReference[] {
  const definition = getElementTypeDefinition(element.type);
  return definition ? definition.references(element.semantic) : [];
}

function omitKey(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(source)) {
    if (name !== key) {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Remove one reference to `targetId` at the registry-declared dotted path.
 * Array slots (`memberIds[2]`) drop the matching entry; scalar fields drop
 * the key entirely.
 */
function removeAtPath(
  value: unknown,
  segments: readonly string[],
  targetId: ElementId,
): unknown {
  const [head, ...rest] = segments;
  if (head === undefined || !isPlainObject(value)) {
    return value;
  }
  const match = ARRAY_SEGMENT.exec(head);
  const key = match ? (match[1] as string) : head;
  if (rest.length > 0) {
    const child = removeAtPath(value[key], rest, targetId);
    return { ...value, [key]: child };
  }
  if (match) {
    const list = value[key];
    if (!Array.isArray(list)) {
      return value;
    }
    return { ...value, [key]: list.filter((entry) => entry !== targetId) };
  }
  return omitKey(value, key);
}

function detachReference(
  semantic: unknown,
  reference: ElementReference,
  targetId: ElementId,
): unknown {
  if (!isPlainObject(semantic)) {
    return semantic;
  }
  return removeAtPath(semantic, reference.field.split("."), targetId);
}

/** True once a group has lost every member and has nothing left to hold. */
function isEmptyGroup(element: Element): boolean {
  if (element.type !== "group" || !isPlainObject(element.semantic)) {
    return false;
  }
  const members = element.semantic["memberIds"];
  return Array.isArray(members) && members.length === 0;
}

interface DeleteExpansion {
  readonly removed: ReadonlySet<ElementId>;
  /** Elements that survived but had a reference rewritten. */
  readonly detached: ReadonlyMap<ElementId, Element>;
}

/**
 * Transitive closure of a delete over the reference graph in `working`.
 * Mutates `working` for detached survivors; removals are reported, not
 * applied, so the caller decides how they map onto the store.
 */
function expandDeletes(
  working: Map<ElementId, Element>,
  seeds: readonly ElementId[],
): DeleteExpansion {
  const referrers = new Map<ElementId, Set<ElementId>>();
  for (const element of working.values()) {
    for (const reference of referencesOf(element)) {
      const bucket = referrers.get(reference.id);
      if (bucket) {
        bucket.add(element.id);
      } else {
        referrers.set(reference.id, new Set([element.id]));
      }
    }
  }

  const removed = new Set<ElementId>();
  const detached = new Map<ElementId, Element>();
  const queue = seeds.filter((id) => working.has(id));

  while (queue.length > 0) {
    const id = queue.shift() as ElementId;
    if (removed.has(id)) {
      continue;
    }
    removed.add(id);

    for (const referrerId of referrers.get(id) ?? []) {
      if (removed.has(referrerId)) {
        continue;
      }
      const referrer = working.get(referrerId);
      if (!referrer) {
        continue;
      }
      const definition = getElementTypeDefinition(referrer.type);
      if (!definition) {
        continue;
      }
      if (definition.onReferenceDeleted === "cascade") {
        queue.push(referrerId);
        continue;
      }
      let semantic = referrer.semantic;
      for (const reference of definition.references(semantic)) {
        if (reference.id === id) {
          semantic = detachReference(semantic, reference, id);
        }
      }
      const rewritten: Element = { ...referrer, semantic };
      working.set(referrerId, rewritten);
      detached.set(referrerId, rewritten);
      if (isEmptyGroup(rewritten)) {
        queue.push(referrerId);
      }
    }
  }

  for (const id of removed) {
    detached.delete(id);
  }
  return { removed, detached };
}

function validateSemanticPayload(
  type: string,
  semantic: unknown,
  path: string,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!isPlainObject(semantic)) {
    out.push(error("type.object", path, "expected a JSON object"));
    return out;
  }
  const definition = getElementTypeDefinition(type);
  if (definition) {
    out.push(...definition.validateSemantic(semantic, path));
  }
  return out;
}

function validateNewElement(
  working: ReadonlyMap<ElementId, Element>,
  store: Store,
  element: Element,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (typeof element.id !== "string" || element.id.length === 0) {
    out.push(error("value.empty", "element.id", "must not be empty"));
    return out;
  }
  if (working.has(element.id)) {
    out.push(
      error(
        "id.duplicate",
        "element.id",
        `element "${element.id}" already exists`,
      ),
    );
  }
  if (typeof element.type !== "string" || element.type.length === 0) {
    out.push(error("value.empty", "element.type", "must not be empty"));
  }
  if (typeof element.index !== "string" || element.index.length === 0) {
    out.push(error("value.empty", "element.index", "must not be empty"));
  }
  if (!store.getPage(element.page)) {
    out.push(
      error(
        "reference.missingPage",
        "element.page",
        `unknown page "${element.page}"`,
      ),
    );
  }
  if (!isPlainObject(element.visual)) {
    out.push(error("type.object", "element.visual", "expected a JSON object"));
  }
  out.push(
    ...validateSemanticPayload(
      element.type,
      element.semantic,
      "element.semantic",
    ),
  );
  return out;
}

function mergeVisual(previous: Visual, patch: Partial<Visual>): Visual {
  const merged: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as Visual;
}

function sortedIds(ids: Iterable<ElementId>): ElementId[] {
  return [...ids].sort();
}

/**
 * Apply `commands` in order, atomically.
 *
 * @throws {CommandError} when any command is invalid. The store is not
 * modified and no diff is emitted in that case.
 */
export function applyCommands(
  store: Store,
  commands: readonly Command[],
): CommandResult {
  const working = new Map<ElementId, Element>();
  for (const element of store.listElements()) {
    working.set(element.id, element);
  }

  const created = new Set<ElementId>();
  const updated = new Set<ElementId>();
  const removed = new Set<ElementId>();
  const undo: Command[] = [];

  const markCreate = (id: ElementId): void => {
    created.add(id);
    removed.delete(id);
  };
  const markUpdate = (id: ElementId): void => {
    if (!created.has(id)) {
      updated.add(id);
    }
  };
  const markRemove = (id: ElementId): void => {
    updated.delete(id);
    if (created.delete(id)) {
      return;
    }
    removed.add(id);
  };
  const fail = (issues: readonly ValidationIssue[], message: string): never => {
    throw new CommandError(issues, message);
  };
  const mustGet = (id: ElementId, what: string): Element => {
    const element = working.get(id);
    if (!element) {
      fail(
        [error("reference.missing", `${what}.id`, `unknown element "${id}"`)],
        `${what}: unknown element "${id}"`,
      );
    }
    return element as Element;
  };

  for (const command of commands) {
    switch (command.type) {
      case "createElement": {
        const issues = validateNewElement(working, store, command.element);
        if (hasErrors(issues)) {
          fail(
            issues,
            `createElement: invalid element "${command.element.id}"`,
          );
        }
        working.set(command.element.id, command.element);
        markCreate(command.element.id);
        undo.unshift({
          type: "deleteElements",
          ids: [command.element.id],
        });
        break;
      }
      case "deleteElements": {
        const before = new Map(working);
        const expansion = expandDeletes(working, command.ids);
        if (expansion.removed.size === 0 && expansion.detached.size === 0) {
          break;
        }
        const restores: Command[] = [];
        for (const id of sortedIds(expansion.removed)) {
          const element = before.get(id);
          if (element) {
            restores.push({ type: "createElement", element });
          }
          working.delete(id);
          markRemove(id);
        }
        for (const id of sortedIds(expansion.detached.keys())) {
          const element = before.get(id);
          if (element) {
            restores.push({
              type: "updateSemantic",
              id,
              semantic: element.semantic,
            });
          }
          markUpdate(id);
        }
        undo.unshift(...restores);
        break;
      }
      case "updateVisual": {
        const previous = mustGet(command.id, "updateVisual");
        if (!isPlainObject(command.visual)) {
          fail(
            [error("type.object", "visual", "expected a JSON object")],
            "updateVisual: expected a JSON object",
          );
        }
        working.set(command.id, {
          ...previous,
          visual: mergeVisual(previous.visual, command.visual),
        });
        markUpdate(command.id);
        undo.unshift({
          type: "replaceVisual",
          id: command.id,
          visual: previous.visual,
        });
        break;
      }
      case "replaceVisual": {
        const previous = mustGet(command.id, "replaceVisual");
        if (!isPlainObject(command.visual)) {
          fail(
            [error("type.object", "visual", "expected a JSON object")],
            "replaceVisual: expected a JSON object",
          );
        }
        working.set(command.id, { ...previous, visual: command.visual });
        markUpdate(command.id);
        undo.unshift({
          type: "replaceVisual",
          id: command.id,
          visual: previous.visual,
        });
        break;
      }
      case "updateSemantic": {
        const previous = mustGet(command.id, "updateSemantic");
        const issues = validateSemanticPayload(
          previous.type,
          command.semantic,
          "semantic",
        );
        if (hasErrors(issues)) {
          fail(issues, `updateSemantic: invalid payload for "${command.id}"`);
        }
        working.set(command.id, { ...previous, semantic: command.semantic });
        markUpdate(command.id);
        undo.unshift({
          type: "updateSemantic",
          id: command.id,
          semantic: previous.semantic,
        });
        break;
      }
      case "reorder": {
        const previous = mustGet(command.id, "reorder");
        if (typeof command.index !== "string" || command.index.length === 0) {
          fail(
            [error("value.empty", "index", "must not be empty")],
            "reorder: index must not be empty",
          );
        }
        working.set(command.id, { ...previous, index: command.index });
        markUpdate(command.id);
        undo.unshift({
          type: "reorder",
          id: command.id,
          index: previous.index,
        });
        break;
      }
    }
  }

  const insert: Element[] = [];
  for (const id of created) {
    const element = working.get(id);
    if (element) {
      insert.push(element);
    }
  }
  const update: Element[] = [];
  for (const id of updated) {
    const element = working.get(id);
    if (element) {
      update.push(element);
    }
  }

  store.commit({ insert, update, remove: [...removed] });
  return { undo, redo: [...commands] };
}
