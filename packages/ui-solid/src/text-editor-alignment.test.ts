import { expect, test } from "bun:test";
import { alignedTextPadding } from "./text-editor-alignment.ts";

test("inline text padding positions measured content vertically", () => {
  expect(alignedTextPadding(100, 20, "top")).toBe(6);
  expect(alignedTextPadding(100, 20, "middle")).toBe(40);
  expect(alignedTextPadding(100, 20, "bottom")).toBe(74);
  expect(alignedTextPadding(100, 40, "middle")).toBe(30);
  expect(alignedTextPadding(100, 40, "bottom")).toBe(54);
  expect(alignedTextPadding(100, 40, undefined)).toBe(6);
});

test("overflow and tiny boxes keep the first line at the top", () => {
  expect(alignedTextPadding(30, 60, "bottom")).toBe(6);
  expect(alignedTextPadding(0, 20, "middle")).toBe(6);
  expect(alignedTextPadding(100, 88, "bottom")).toBe(6);
});
