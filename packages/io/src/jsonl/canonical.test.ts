import { describe, expect, test } from "bun:test";
import type { KeyOrder } from "@diagra/ir";
import {
  compareStrings,
  roundCoordinate,
  stringifyCanonical,
} from "./canonical.ts";

describe("roundCoordinate", () => {
  test("rounds to 0.01", () => {
    expect(roundCoordinate(10.123456)).toBe(10.12);
    expect(roundCoordinate(10.126)).toBe(10.13);
    expect(roundCoordinate(280)).toBe(280);
  });

  test("is symmetric about zero", () => {
    expect(roundCoordinate(-10.126)).toBe(-10.13);
    expect(roundCoordinate(-1.005)).toBe(-roundCoordinate(1.005));
  });

  test("normalizes negative zero", () => {
    expect(Object.is(roundCoordinate(-0.001), 0)).toBe(true);
    expect(Object.is(roundCoordinate(-0), 0)).toBe(true);
  });

  test("absorbs float multiplication noise", () => {
    expect(roundCoordinate(8.2)).toBe(8.2);
    expect(roundCoordinate(1.1)).toBe(1.1);
    expect(roundCoordinate(0.1 + 0.2)).toBe(0.3);
  });

  test("passes non-finite values through untouched", () => {
    expect(roundCoordinate(Number.NaN)).toBeNaN();
    expect(roundCoordinate(Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(roundCoordinate(Number.NEGATIVE_INFINITY)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  test("is total over the finite doubles", () => {
    // Scaling by 100 overflows above MAX_VALUE / 100, which used to turn a
    // finite coordinate into Infinity — and the writer's only spelling for
    // that is `null`, which then fails validation on reload. A finite input
    // must always give a finite output.
    const huge = [
      1.798e306,
      1e307,
      1e308,
      Number.MAX_VALUE,
      Number.MAX_VALUE / 100,
    ];
    for (const value of [...huge, ...huge.map((v) => -v)]) {
      expect({ value, rounded: roundCoordinate(value) }).toEqual({
        value,
        rounded: value,
      });
      expect(Number.isFinite(roundCoordinate(value))).toBe(true);
    }
  });

  test("stays finite across the whole double range", () => {
    // Sweep magnitudes rather than spot-check, so the invariant is pinned
    // rather than the two thresholds that happened to break.
    for (let exponent = -320; exponent <= 308; exponent += 1) {
      const value = Number(`1e${exponent}`);
      if (!Number.isFinite(value)) {
        continue;
      }
      for (const signed of [value, -value]) {
        expect({
          signed,
          finite: Number.isFinite(roundCoordinate(signed)),
        }).toEqual({ signed, finite: true });
      }
    }
  });

  test("is idempotent", () => {
    for (const value of [0.005, 1.005, -1.005, 12.345, -99.999]) {
      expect(roundCoordinate(roundCoordinate(value))).toBe(
        roundCoordinate(value),
      );
    }
  });
});

describe("compareStrings", () => {
  test("orders by code unit, not locale", () => {
    expect(compareStrings("a", "b")).toBe(-1);
    expect(compareStrings("b", "a")).toBe(1);
    expect(compareStrings("a", "a")).toBe(0);
    // Locale collation would sort "a" before "B"; code units do not.
    expect(compareStrings("B", "a")).toBe(-1);
  });
});

describe("stringifyCanonical", () => {
  test("sorts unspecified object keys", () => {
    expect(stringifyCanonical({ b: 1, a: 2, C: 3 })).toBe(
      '{"C":3,"a":2,"b":1}',
    );
  });

  test("does not let integer-like keys jump the queue", () => {
    // `JSON.stringify` would emit "1" and "2" first because JS objects
    // order integer-like keys ahead of string keys. The declared order wins.
    const order: KeyOrder = { keys: ["z", "2", "a"] };
    const value = { a: 1, "2": 2, z: 3, "1": 4 };
    expect(stringifyCanonical(value, order)).toBe('{"z":3,"2":2,"a":1,"1":4}');
    expect(JSON.stringify(value)).toBe('{"1":4,"2":2,"a":1,"z":3}');
  });

  test("puts declared keys first and sorts the rest after them", () => {
    const order: KeyOrder = { keys: ["kind", "id"] };
    expect(
      stringifyCanonical({ zzz: 1, id: "x", aaa: 2, kind: "k" }, order),
    ).toBe('{"kind":"k","id":"x","aaa":2,"zzz":1}');
  });

  test("applies a child order to every item of an array", () => {
    const order: KeyOrder = {
      keys: ["items"],
      children: { items: { keys: ["id", "name"] } },
    };
    expect(
      stringifyCanonical(
        {
          items: [
            { name: "b", id: "2" },
            { name: "a", id: "1" },
          ],
        },
        order,
      ),
    ).toBe('{"items":[{"id":"2","name":"b"},{"id":"1","name":"a"}]}');
  });

  test("rounds only declared coordinate keys", () => {
    const order: KeyOrder = {
      keys: ["x", "pressure"],
      coordinates: ["x"],
    };
    expect(stringifyCanonical({ x: 1.23456, pressure: 1.23456 }, order)).toBe(
      '{"x":1.23,"pressure":1.23456}',
    );
  });

  test("does not read a nested key order off the prototype chain", () => {
    // `children["constructor"]` would be the global `Object`, whose `.keys`
    // is a function; the writer would then call `new Set(fn)` and throw.
    const order: KeyOrder = {
      keys: ["a"],
      children: { a: { keys: ["z"] } },
    };
    expect(
      stringifyCanonical({ a: { z: 1 }, constructor: { b: 2 } }, order),
    ).toBe('{"a":{"z":1},"constructor":{"b":2}}');
    expect(stringifyCanonical({ constructor: [{ b: 2 }] }, order)).toBe(
      '{"constructor":[{"b":2}]}',
    );
  });

  test("a declared key absent from the value is not taken from the prototype", () => {
    const order: KeyOrder = { keys: ["toString", "valueOf", "x"] };
    expect(stringifyCanonical({ x: 1 }, order)).toBe('{"x":1}');
    expect(stringifyCanonical({ toString: { a: 1 }, x: 1 }, order)).toBe(
      '{"toString":{"a":1},"x":1}',
    );
  });

  test("drops undefined fields the way JSON.stringify does", () => {
    expect(stringifyCanonical({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  test("keeps nulls, and writes undefined array holes as null", () => {
    expect(stringifyCanonical({ a: null })).toBe('{"a":null}');
    expect(stringifyCanonical([1, undefined, 3])).toBe("[1,null,3]");
  });

  test("writes non-finite numbers as null, like JSON.stringify", () => {
    expect(stringifyCanonical({ a: Number.NaN })).toBe('{"a":null}');
    expect(stringifyCanonical({ a: Number.POSITIVE_INFINITY })).toBe(
      '{"a":null}',
    );
  });

  test("escapes control characters so a record is always one line", () => {
    const text = stringifyCanonical({ a: 'line1\nline2\t"q"' });
    expect(text).not.toContain("\n");
    expect(JSON.parse(text)).toEqual({ a: 'line1\nline2\t"q"' });
  });

  test("round-trips through JSON.parse unchanged", () => {
    const value = { b: [1, { d: 2, c: [true, null] }], a: "x" };
    expect(JSON.parse(stringifyCanonical(value))).toEqual(value);
  });
});
