// Safe field access for plain objects indexed by file-controlled keys.
//
// ONE INVARIANT: a key that came out of a JSONL file must never index a plain
// object directly, for reads or for writes. `Object.prototype` supplies both
// an accessor (`__proto__`) and a pile of data properties (`constructor`,
// `toString`, `valueOf`, `hasOwnProperty`, ...) under names a file is free to
// use, so bare `obj[key]` silently reaches something that was never in the
// file. Both directions have already bitten this module:
//
//   Write side: `target[key] = value` for `key === "__proto__"` invokes
//   `Object.prototype`'s setter rather than creating an own property. The
//   field vanishes and the accumulator's prototype becomes file-controlled
//   data. (`JSON.parse` does the right thing and makes `__proto__` an
//   ordinary own property, so a file may legitimately carry that key.)
//
//   Read side: looking a nested key order up as `children[key]` for
//   `key === "constructor"` returns the global `Object` instead of
//   `undefined`, so the writer then treats `Object.keys` - a function - as a
//   declared key list and throws.
//
// Use `setField` and `getField` at every such site. Object spread, object
// literals, `Object.keys`, `Map` and `Set` are all already safe and need no
// wrapper.

/**
 * Define `key` as an own, enumerable, writable, configurable property of
 * `target`, exactly as an object literal would. Unlike `target[key] = value`
 * this is inert for `__proto__` and any other inherited setter.
 */
export function setField(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Read `key` from `source`, yielding `undefined` unless it is an own
 * property. Unlike `source[key]` this never returns something inherited from
 * `Object.prototype` for a key the file merely happens to have named after
 * one.
 */
export function getField(
  source: Readonly<Record<string, unknown>> | undefined,
  key: string,
): unknown {
  if (source === undefined || !Object.hasOwn(source, key)) {
    return undefined;
  }
  return source[key];
}
