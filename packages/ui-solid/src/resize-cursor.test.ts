import { expect, test } from "bun:test";
import { resizeCursor } from "./resize-cursor.ts";

test("resize cursors follow cardinal and diagonal rotated axes", () => {
  expect(resizeCursor("e")).toBe("ew-resize");
  expect(resizeCursor("n")).toBe("ns-resize");
  expect(resizeCursor("nw")).toBe("nwse-resize");
  expect(resizeCursor("ne")).toBe("nesw-resize");
  expect(resizeCursor("e", 90)).toBe("ns-resize");
  expect(resizeCursor("n", 90)).toBe("ew-resize");
  expect(resizeCursor("se", 45)).toBe("ns-resize");
  expect(resizeCursor("ne", 45)).toBe("ew-resize");
});

test("cursor direction wraps and quantizes arbitrary angles", () => {
  for (const angle of [-450, -90, 90, 450])
    expect(resizeCursor("e", angle)).toBe("ns-resize");
  expect(resizeCursor("e", 22)).toBe("ew-resize");
  expect(resizeCursor("e", 23)).toBe("nwse-resize");
  expect(resizeCursor("e", -23)).toBe("nesw-resize");
  expect(resizeCursor("n", Number.NaN)).toBe("ns-resize");
});
