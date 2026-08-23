// Canonical JSON writer.
//
// `JSON.stringify` cannot be used directly for two reasons:
//   1. It emits object keys in JS property order, which silently promotes
//      integer-like keys ("2" before "a") and would make output depend on
//      how the object was built rather than on a declared order.
//   2. Coordinate rounding has to happen per declared field, not globally.
//
// So records are written key by key against a `KeyOrder` from `@diagra/ir`:
// declared keys first in declared order, every other key (including fields
// this build does not model) after them sorted by code unit. That keeps the
// output deterministic and unknown fields lossless.

import { COORDINATE_PRECISION, type KeyOrder } from "@diagra/ir";
import { getField } from "./objects.ts";

/** Code-unit ordering; deliberately locale-independent. */
export function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Round to {@link COORDINATE_PRECISION}, half away from zero, normalizing
 * `-0` to `0` so it never shows up as `-0` in a diff.
 *
 * ONE INVARIANT: rounding is TOTAL over the finite doubles. A finite input
 * always yields a finite output. This matters because the only JSON spelling
 * of a non-finite number is `null`, and `null` fails validation on reload —
 * so any finite-to-non-finite transition here would hand the user a file
 * this build had just certified and can no longer open. The guard below is
 * on the rounded *result*, not on the intermediate, so it holds no matter
 * which step of the arithmetic overflows.
 *
 * `Math.round` alone rounds halves towards +Infinity, which would make
 * `-1.005` and `1.005` disagree; taking the magnitude first keeps rounding
 * symmetric about zero. Exact .005 inputs are unrepresentable in binary
 * anyway, so which way they land is decided by the stored double — the
 * guarantee here is determinism, not decimal half-up semantics.
 */
export function roundCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const scale = 1 / COORDINATE_PRECISION;
  const magnitude = Math.round(Math.abs(value) * scale) / scale;
  if (!Number.isFinite(magnitude)) {
    // |value| > MAX_VALUE / scale, so scaling overflowed. Nothing is lost by
    // skipping the rounding: at this magnitude the gap between adjacent
    // doubles is vastly larger than 0.01, so the value is already an exact
    // multiple of the precision we round to.
    return value;
  }
  const result = value < 0 ? -magnitude : magnitude;
  return result === 0 ? 0 : result;
}

/**
 * `null` is JSON's only spelling for a non-finite number. Reaching that
 * branch means the document already held Infinity or NaN before the writer
 * ran — `JSON.parse("1e400")` yields Infinity, for instance. It is never the
 * writer's own doing: `roundCoordinate` is total over the finite doubles, so
 * nothing finite in the document can arrive here non-finite.
 */
function writeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "null";
  }
  return JSON.stringify(value);
}

function writePrimitive(value: unknown): string | undefined {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return writeNumber(value);
    case "boolean":
      return value ? "true" : "false";
    default:
      return undefined;
  }
}

function writeArray(value: readonly unknown[], order?: KeyOrder): string {
  const items = value.map((item) => writeValue(item, order) ?? "null");
  return `[${items.join(",")}]`;
}

/**
 * The nested order for `key`, or `undefined` when none is declared.
 *
 * Goes through `getField` because `key` comes from the file: a record with a
 * field named `constructor` would otherwise read the global `Object` off
 * `children`'s prototype and hand the writer a function as its key list. See
 * ./objects.ts for the invariant this is one half of.
 */
function childOrder(
  order: KeyOrder | undefined,
  key: string,
): KeyOrder | undefined {
  return getField(order?.children, key) as KeyOrder | undefined;
}

function writeObject(value: Record<string, unknown>, order?: KeyOrder): string {
  const declared = order?.keys ?? [];
  const declaredSet = new Set(declared);
  const rest = Object.keys(value)
    .filter((key) => !declaredSet.has(key))
    .sort(compareStrings);

  const coordinates = new Set(order?.coordinates ?? []);
  const parts: string[] = [];
  for (const key of [...declared, ...rest]) {
    // getField, not `value[key]`: a declared key that is absent from this
    // record must not fall through to `Object.prototype`.
    let child = getField(value, key);
    if (child === undefined) {
      continue;
    }
    if (typeof child === "number" && coordinates.has(key)) {
      child = roundCoordinate(child);
    }
    const written = writeValue(child, childOrder(order, key));
    if (written === undefined) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${written}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Serialize a JSON value deterministically. Returns `undefined` for values
 * JSON has no representation for (`undefined`, functions), so object writers
 * can drop the key the way `JSON.stringify` does.
 */
export function writeValue(
  value: unknown,
  order?: KeyOrder,
): string | undefined {
  const primitive = writePrimitive(value);
  if (primitive !== undefined) {
    return primitive;
  }
  if (Array.isArray(value)) {
    return writeArray(value, order);
  }
  if (typeof value === "object") {
    // `null` already returned above, so this is a plain object.
    return writeObject(value as Record<string, unknown>, order);
  }
  return undefined;
}

/** Canonical JSON text for one record. Never contains a newline. */
export function stringifyCanonical(value: unknown, order?: KeyOrder): string {
  return writeValue(value, order) ?? "null";
}
