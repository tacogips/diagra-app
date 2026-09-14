import { expect, test } from "bun:test";
import { placeAbove } from "./SelectionToolbar.tsx";

test("placeAbove clamps a compact selection toolbar inside its host", () => {
  expect(
    placeAbove(
      180,
      220,
      8,
      { width: 140, height: 32 },
      { width: 400, height: 300 },
    ),
  ).toEqual({ x: 130, y: 4 });
  expect(
    placeAbove(
      390,
      410,
      100,
      { width: 140, height: 32 },
      { width: 400, height: 300 },
    ),
  ).toEqual({ x: 256, y: 58 });
});
