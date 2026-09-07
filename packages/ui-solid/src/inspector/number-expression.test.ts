import { expect, test } from "bun:test";
import { parseNumberExpression } from "./number-expression.ts";

test("layout arithmetic supports precedence, parentheses and signed scientific literals", () => {
  expect(parseNumberExpression("390 - 16 * 2")).toBe(358);
  expect(parseNumberExpression("(24 + 8) * 2")).toBe(64);
  expect(parseNumberExpression(" 1.2e2 / -(.5 + .5) ")).toBe(-120);
  expect(parseNumberExpression("10 / 2 / 5")).toBe(1);
  expect(parseNumberExpression("-20 + +5")).toBe(-15);
});

test("malformed, nonfinite, executable and ambiguous numeric input is rejected", () => {
  for (const input of [
    "",
    " ",
    "1+",
    "(2+3",
    "2 3",
    "2(3)",
    "1/0",
    "0/0",
    "1e999",
    "1/1e999",
    "1/(1e308*10)",
    "Infinity",
    "NaN",
    "0x10",
    "10px",
    "50%",
    "2**3",
    "Math.random()",
    "globalThis.x=1",
    "1;2",
    "1e",
    "1..2",
    "1".repeat(257),
  ]) {
    expect(parseNumberExpression(input)).toBeNull();
  }
});
