// Reference-graph helpers shared by deletes, clipboard and export.
//
// The `@diagra/ir` registry is the only thing that knows which fields of a
// semantic payload point at other elements, and it reports them as dotted
// paths (`from.table`, `memberIds[2]`). Everything that has to *edit* those
// paths lives here: the delete expansion rewrites them to drop a reference,
// paste rewrites them to point at a copy, and a copied fragment is trimmed
// until every reference it still carries lands inside the fragment itself.

import {
  type Element,
  type ElementId,
  type ElementReference,
  getElementTypeDefinition,
  isPlainObject,
} from "@diagra/ir";

const ARRAY_SEGMENT = /^(.+)\[(\d+)\]$/;

/** Element ids this element points at, or `[]` for an unmodelled type. */
export function referencesOf(element: Element): readonly ElementReference[] {
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
export function removeAtPath(
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
    if (match) {
      const list = value[key];
      const at = Number.parseInt(match[2] as string, 10);
      if (!Array.isArray(list) || at >= list.length) return value;
      const next = [...list];
      next[at] = removeAtPath(list[at], rest, targetId);
      return { ...value, [key]: next };
    }
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

export function detachReference(
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
export function isEmptyGroup(element: Element): boolean {
  if (element.type !== "group" || !isPlainObject(element.semantic)) {
    return false;
  }
  const members = element.semantic["memberIds"];
  return Array.isArray(members) && members.length === 0;
}

/** Drop group modes that became invalid after one of their members detached. */
export function normalizeDetachedReferences(element: Element): Element {
  if (element.type !== "group" || !isPlainObject(element.semantic))
    return element;
  let semantic = element.semantic;
  if (semantic["maskId"] === undefined && semantic["maskMode"] !== undefined) {
    const { maskMode: _maskMode, ...rest } = semantic;
    semantic = rest;
  }
  const members = semantic["memberIds"];
  if (
    Array.isArray(members) &&
    members.length < 2 &&
    semantic["booleanOperation"] !== undefined
  ) {
    const { booleanOperation: _operation, ...rest } = semantic;
    semantic = rest;
  }
  return semantic === element.semantic ? element : { ...element, semantic };
}

/**
 * Replace the id at one declared path, leaving everything else alone.
 * Mirrors {@link removeAtPath}: an array slot keeps its position, a scalar
 * field keeps its key.
 */
function setAtPath(
  value: unknown,
  segments: readonly string[],
  id: ElementId,
): unknown {
  const [head, ...rest] = segments;
  if (head === undefined || !isPlainObject(value)) {
    return value;
  }
  const match = ARRAY_SEGMENT.exec(head);
  const key = match ? (match[1] as string) : head;
  if (rest.length > 0) {
    if (match) {
      const list = value[key];
      const at = Number.parseInt(match[2] as string, 10);
      if (!Array.isArray(list) || at >= list.length) return value;
      const next = [...list];
      next[at] = setAtPath(list[at], rest, id);
      return { ...value, [key]: next };
    }
    const child = setAtPath(value[key], rest, id);
    return child === value[key] ? value : { ...value, [key]: child };
  }
  if (match) {
    const list = value[key];
    if (!Array.isArray(list)) {
      return value;
    }
    const at = Number.parseInt(match[2] as string, 10);
    if (at < 0 || at >= list.length) {
      return value;
    }
    const next = [...list];
    next[at] = id;
    return { ...value, [key]: next };
  }
  return { ...value, [key]: id };
}

/**
 * Point every reference in `semantic` at its replacement in `mapping`.
 *
 * Ids the mapping says nothing about are left exactly as they were, and a
 * payload with nothing to rewrite comes back with the same identity — a
 * paste that copied only one end of an edge must not silently rewrite the
 * other end to something that is not there.
 */
export function remapReferences(
  type: string,
  semantic: unknown,
  mapping: ReadonlyMap<ElementId, ElementId>,
): unknown {
  const definition = getElementTypeDefinition(type);
  if (!definition || mapping.size === 0) {
    return semantic;
  }
  let out = semantic;
  for (const reference of definition.references(semantic)) {
    const replacement = mapping.get(reference.id);
    if (replacement === undefined || replacement === reference.id) {
      continue;
    }
    out = setAtPath(out, reference.field.split("."), replacement);
  }
  return out;
}

function detachOutside(element: Element, ids: ReadonlySet<ElementId>): Element {
  const definition = getElementTypeDefinition(element.type);
  if (!definition || definition.onReferenceDeleted === "cascade") {
    return element;
  }
  let semantic = element.semantic;
  for (const reference of definition.references(element.semantic)) {
    if (!ids.has(reference.id)) {
      semantic = detachReference(semantic, reference, reference.id);
    }
  }
  return semantic === element.semantic
    ? element
    : normalizeDetachedReferences({ ...element, semantic });
}

/** Whether `element` can stand on its own given the surviving `ids`. */
function survives(element: Element, ids: ReadonlySet<ElementId>): boolean {
  const definition = getElementTypeDefinition(element.type);
  if (!definition) {
    return true;
  }
  const dangling = definition
    .references(element.semantic)
    .some((reference) => !ids.has(reference.id));
  if (!dangling) {
    return true;
  }
  if (definition.onReferenceDeleted === "cascade") {
    return false;
  }
  return !isEmptyGroup(detachOutside(element, ids));
}

/**
 * The largest sub-fragment of `elements` that references nothing outside
 * itself, in input order.
 *
 * Same policy as a delete, run the other way round: a cascade-policy element
 * whose target was not copied dies with it (a relation without both tables),
 * a detach-policy one loses the reference and stays. Removals feed back into
 * the surviving set until it stops shrinking, so a group whose last member
 * was left behind goes too.
 */
export function selfContained(elements: readonly Element[]): Element[] {
  const ids = new Set(elements.map((element) => element.id));
  let shrinking = true;
  while (shrinking) {
    shrinking = false;
    for (const element of elements) {
      if (ids.has(element.id) && !survives(element, ids)) {
        ids.delete(element.id);
        shrinking = true;
      }
    }
  }
  const out: Element[] = [];
  for (const element of elements) {
    if (ids.has(element.id)) {
      out.push(detachOutside(element, ids));
    }
  }
  return out;
}
