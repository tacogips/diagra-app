import { expect, test } from "bun:test";
import { swiftString, kotlinString } from "./native-string.ts";

test("Swift literals encode Unicode scalars and keep interpolation text literal", () => {
  expect(swiftString("日本語\u2028\u2029\n\t\b\f\0")).toBe(
    '"日本語\\u{2028}\\u{2029}\\u{a}\\u{9}\\u{8}\\u{c}\\u{0}"',
  );
  expect(swiftString('" \\(value) \\u2028 $value')).toBe(
    '"\\" \\\\(value) \\\\u2028 $value"',
  );
  expect(swiftString("\ud800")).toBe('"\\u{fffd}"');
});

test("Kotlin literals escape interpolation and control characters without altering literal escapes", () => {
  expect(kotlinString("日本語\u2028\u2029\n\t\b\f\0")).toBe(
    '"日本語\\u2028\\u2029\\u000a\\u0009\\u0008\\u000c\\u0000"',
  );
  expect(kotlinString('" \\u2028 $value ${call()}')).toBe(
    '"\\" \\\\u2028 \\$value \\${call()}"',
  );
  expect(kotlinString("\ud800")).toBe('"\\ud800"');
});
