import { expect, test } from "bun:test";
import { measureTextNote, wrapTextLines } from "./text-layout.ts";
import { element } from "./test-helpers.ts";
import { makeEditor } from "./test-helpers.ts";

test("wrapping preserves indentation, repeated spaces and trailing spaces", () => {
  for (const text of ["  indented", "a   b  ", "     ", "e\u0301  e\u0301"]) {
    for (const width of [1, 11, 22, 200]) {
      expect(wrapTextLines(text, width, 10).join("")).toBe(text);
    }
  }
  expect(wrapTextLines("  label  ", 200, 10)).toEqual(["  label  "]);
});

test("SVG notes retain authored spaces and request whitespace-preserving rendering", () => {
  const editor = makeEditor();
  editor.createElement("text.note", {
    semantic: { text: "  key:  value  " },
    visual: { x: 0, y: 0, width: 300, height: 60 },
  });
  const svg = editor.exportPageSvg();
  expect(svg).toContain('xml:space="preserve"');
  expect(svg).toContain("white-space: pre;");
  expect(svg).toContain(">  key:  value  </text>");
});

test("wrapping preserves surrogate pairs, combining accents and joined graphemes", () => {
  for (const cluster of [
    "\u{1f680}",
    "e\u0301",
    "\u{1f469}\u200d\u{1f4bb}",
    "\u{1f1ef}\u{1f1f5}",
    "\u{1f44d}\u{1f3fd}",
    "\u304b\u3099",
  ]) {
    expect(wrapTextLines(cluster.repeat(3), 5.5, 10)).toEqual([
      cluster,
      cluster,
      cluster,
    ]);
    expect(wrapTextLines(`${cluster} ${cluster}`, 16.5, 10)).toEqual([
      `${cluster} ${cluster}`,
    ]);
  }
});

test("auto-width counts graphemes consistently with wrapping while retaining explicit lines", () => {
  const note = (text: string) =>
    element({
      id: "text",
      type: "text.note",
      semantic: { text },
      visual: { style: { fontSize: 10 } },
    });
  expect(measureTextNote(note("e\u0301e\u0301"), "auto-width")).toEqual(
    measureTextNote(note("ee"), "auto-width"),
  );
  expect(measureTextNote(note("\u{1f680}\r\n\u{1f680}"), "auto-width")).toEqual(
    measureTextNote(note("a\r\na"), "auto-width"),
  );
  expect(wrapTextLines("\u{1f680}\n\ne\u0301", 1, 10)).toEqual([
    "\u{1f680}",
    "",
    "e\u0301",
  ]);
});
