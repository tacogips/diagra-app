// Fractional index keys: jittered lexicographic ordering keys.
//
// A key is a base62 fraction written without the leading "0.", so plain
// code-unit string comparison is value comparison. Inserting between two
// neighbours never renumbers anything else, which is what makes concurrent
// reordering safe for the collab layer later on.
//
// Jitter: when there is room between two digits the midpoint digit is
// picked at random rather than exactly halfway. Two peers inserting at the
// same slot then produce different keys instead of colliding.

import type { FractionalIndex } from "@diagra/ir";

/** Ordered so that string comparison matches digit value. */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/** Injection seam: tests pass a deterministic generator. */
export type Rng = () => number;

/**
 * True for a string this module can compute midpoints against: non-empty,
 * base62 only, and with no trailing "0" (which would make two spellings of
 * the same value, breaking the midpoint recursion).
 */
export function isFractionalKey(value: string): boolean {
  if (value.length === 0 || value.endsWith("0")) {
    return false;
  }
  for (const character of value) {
    if (!DIGITS.includes(character)) {
      return false;
    }
  }
  return true;
}

/** Code-unit comparison; ordering keys are never locale-sensitive. */
export function compareFractional(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** A digit index strictly between `low` and `high`; needs a gap of 2. */
function randomDigitBetween(low: number, high: number, rng: Rng): number {
  const span = high - low - 1;
  const raw = Math.floor(rng() * span);
  const offset = Math.max(0, Math.min(raw, span - 1));
  return low + 1 + offset;
}

function digitValue(key: string, at: number): number {
  const character = key[at];
  return character === undefined ? 0 : DIGITS.indexOf(character);
}

/**
 * A key strictly between `lower` (exclusive; "" means "before everything")
 * and `upper` (exclusive; `null` means "after everything").
 */
function midpoint(lower: string, upper: string | null, rng: Rng): string {
  if (upper !== null && lower >= upper) {
    throw new RangeError(
      `fractional keys out of order: "${lower}" is not below "${upper}"`,
    );
  }
  if (upper !== null) {
    // Shared prefix carries over verbatim; only the tail needs a midpoint.
    let shared = 0;
    while ((lower[shared] ?? "0") === upper[shared]) {
      shared += 1;
    }
    if (shared > 0) {
      const tail = midpoint(lower.slice(shared), upper.slice(shared), rng);
      return upper.slice(0, shared) + tail;
    }
  }

  const low = lower.length > 0 ? digitValue(lower, 0) : 0;
  const high = upper !== null ? digitValue(upper, 0) : BASE;
  if (high - low > 1) {
    return DIGITS[randomDigitBetween(low, high, rng)] as string;
  }
  if (upper !== null && upper.length > 1) {
    // The digits are adjacent but `upper` has a fractional tail, so
    // truncating it lands strictly between the two.
    return upper.slice(0, 1);
  }
  // No room at this digit: keep `lower`'s digit and descend one place.
  return (DIGITS[low] as string) + midpoint(lower.slice(1), null, rng);
}

/**
 * A key ordered strictly between `before` and `after`.
 *
 * `null` stands for "no neighbour on that side". Throws {@link RangeError}
 * when a bound is not a well-formed key or when the bounds are inverted.
 */
export function keyBetween(
  before: string | null,
  after: string | null,
  rng: Rng = Math.random,
): FractionalIndex {
  if (before !== null && !isFractionalKey(before)) {
    throw new RangeError(`not a fractional key: "${before}"`);
  }
  if (after !== null && !isFractionalKey(after)) {
    throw new RangeError(`not a fractional key: "${after}"`);
  }
  return midpoint(before ?? "", after, rng);
}

/**
 * A key ordered strictly after `last`, which is how new elements land on top
 * of the z-order.
 *
 * Unlike {@link keyBetween} this tolerates keys it cannot do arithmetic on:
 * a document written by another tool may use any non-empty string as an
 * index, and appending a digit is greater than the original under plain
 * string comparison whatever the original was.
 */
export function keyAfter(
  last: string | null,
  rng: Rng = Math.random,
): FractionalIndex {
  if (last === null) {
    return midpoint("", null, rng);
  }
  if (isFractionalKey(last)) {
    return midpoint(last, null, rng);
  }
  return last + (DIGITS[randomDigitBetween(0, BASE, rng)] as string);
}
