import { describe, expect, test } from "bun:test";
import {
  compareFractional,
  isFractionalKey,
  keyAfter,
  keyBetween,
} from "./fractional.ts";
import { seededRng } from "./test-helpers.ts";

describe("isFractionalKey", () => {
  test("accepts base62 keys without a trailing zero", () => {
    expect(isFractionalKey("a1")).toBe(true);
    expect(isFractionalKey("Z")).toBe(true);
  });

  test("rejects empty, trailing-zero and out-of-alphabet keys", () => {
    expect(isFractionalKey("")).toBe(false);
    expect(isFractionalKey("a0")).toBe(false);
    expect(isFractionalKey("a-1")).toBe(false);
    expect(isFractionalKey("héllo")).toBe(false);
  });
});

describe("keyBetween", () => {
  test("produces a valid key when both bounds are open", () => {
    const key = keyBetween(null, null, seededRng(1));
    expect(isFractionalKey(key)).toBe(true);
  });

  test("lands strictly between its bounds", () => {
    const rng = seededRng(3);
    const pairs: readonly [string, string][] = [
      ["a", "b"],
      ["a1", "a2"],
      ["1", "z"],
      ["A", "a"],
      ["a1", "a11"],
    ];
    for (const [low, high] of pairs) {
      const middle = keyBetween(low, high, rng);
      expect(compareFractional(low, middle)).toBe(-1);
      expect(compareFractional(middle, high)).toBe(-1);
      expect(isFractionalKey(middle)).toBe(true);
    }
  });

  test("extends the key length when the digits are adjacent", () => {
    const middle = keyBetween("1", "2", seededRng(5));
    expect(middle.startsWith("1")).toBe(true);
    expect(middle.length).toBeGreaterThan(1);
    expect(middle < "2").toBe(true);
  });

  test("stays ordered when repeatedly bisecting the same gap", () => {
    const rng = seededRng(11);
    let low = "a";
    const high = "b";
    for (let i = 0; i < 64; i += 1) {
      const middle = keyBetween(low, high, rng);
      expect(compareFractional(low, middle)).toBe(-1);
      expect(compareFractional(middle, high)).toBe(-1);
      low = middle;
    }
  });

  test("an open lower bound orders before its upper bound", () => {
    const key = keyBetween(null, "a1", seededRng(2));
    expect(compareFractional(key, "a1")).toBe(-1);
  });

  test("jitters, so two generators disagree on the same gap", () => {
    const first = keyBetween("1", "z", seededRng(1));
    const second = keyBetween("1", "z", seededRng(999));
    expect(first).not.toBe(second);
  });

  test("rejects inverted or malformed bounds", () => {
    expect(() => keyBetween("b", "a")).toThrow(RangeError);
    expect(() => keyBetween("a", "a")).toThrow(RangeError);
    expect(() => keyBetween("a-", "b")).toThrow(RangeError);
    expect(() => keyBetween("a", "b0")).toThrow(RangeError);
  });
});

describe("keyAfter", () => {
  test("builds a strictly increasing chain", () => {
    const rng = seededRng(13);
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 200; i += 1) {
      last = keyAfter(last, rng);
      keys.push(last);
    }
    for (let i = 1; i < keys.length; i += 1) {
      expect(compareFractional(keys[i - 1] as string, keys[i] as string)).toBe(
        -1,
      );
    }
    expect([...keys].sort()).toEqual(keys);
  });

  test("tolerates an index this module cannot do arithmetic on", () => {
    const key = keyAfter("index-from-another-tool", seededRng(4));
    expect(compareFractional("index-from-another-tool", key)).toBe(-1);
  });

  test("tolerates a trailing-zero index", () => {
    const key = keyAfter("a0", seededRng(4));
    expect(compareFractional("a0", key)).toBe(-1);
  });
});
